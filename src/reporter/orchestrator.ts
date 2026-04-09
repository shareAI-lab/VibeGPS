import type Database from 'better-sqlite3';
import { runAnalyzer } from '../analyzer/agent-runner.js';
import { parseLLMResult } from '../analyzer/parser.js';
import { REPORTS_DIR, SESSIONS_DIR, VIBEGPS_HOME } from '../constants.js';
import { loadConfig } from '../store/config.js';
import {
  listSessionMetas,
  readSessionMeta,
  readTurns,
  updateSessionMeta
} from '../store/session-store.js';
import type { TurnRecord } from '../store/session-store.js';
import {
  getSession as dbGetSession,
  getTurns as dbGetTurns,
  getSessionTotalDelta as dbGetSessionTotalDelta,
  getFileHeatmap as dbGetFileHeatmap,
  insertReport as dbInsertReport,
  type TurnRecord as DbTurnRecord
} from '../store/snapshot-store.js';
import type { FileOperation } from '../wrapper/file-change-collector.js';
import { renderHtmlReport } from './html-renderer.js';
import type { FileHeatmapEntry, TurnSummary } from './template.js';
import { renderCompactNotification, renderTerminalSummary } from './terminal-renderer.js';

function operationsToDiff(ops: FileOperation[]): string {
  const byFile = new Map<string, FileOperation[]>();
  for (const op of ops) {
    const existing = byFile.get(op.filePath) ?? [];
    existing.push(op);
    byFile.set(op.filePath, existing);
  }

  const chunks: string[] = [];
  for (const [file, fileOps] of byFile) {
    const isNew = fileOps.some((op) => op.tool === 'Write');
    chunks.push(`diff --git a/${file} b/${file}`);
    if (isNew) {
      chunks.push('new file mode 100644');
      chunks.push('--- /dev/null');
      chunks.push(`+++ b/${file}`);
    } else {
      chunks.push(`--- a/${file}`);
      chunks.push(`+++ b/${file}`);
    }

    for (const op of fileOps) {
      if (op.tool === 'Edit' && op.oldString && op.newString) {
        const oldLines = op.oldString.split('\n');
        const newLines = op.newString.split('\n');
        chunks.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`);
        for (const line of oldLines) chunks.push(`-${line}`);
        for (const line of newLines) chunks.push(`+${line}`);
      } else if (op.tool === 'Write' && op.content) {
        const lines = op.content.split('\n');
        chunks.push(`@@ -0,0 +1,${lines.length} @@`);
        for (const line of lines) chunks.push(`+${line}`);
      }
    }
  }

  return chunks.join('\n');
}

function buildTurnSummaries(turns: TurnRecord[]): TurnSummary[] {
  return turns.map((t) => {
    const hasOperations = t.operations && t.operations.length > 0;
    const diffContent = hasOperations
      ? operationsToDiff(t.operations!)
      : t.diffContent;

    return {
      turn: t.turn,
      timestamp: t.timestamp,
      added: Math.max(0, t.delta.added),
      removed: Math.max(0, t.delta.removed),
      filesChanged: t.filesChanged.length + t.newFiles.length,
      commitDetected: t.commitDetected,
      lastAssistantMessage: t.lastAssistantMessage,
      diffContent,
      operations: t.operations ?? []
    };
  });
}

function buildFileHeatmap(turns: TurnRecord[]): FileHeatmapEntry[] {
  const fileChangeCount = new Map<string, number>();
  const newFileSet = new Set<string>();
  for (const t of turns) {
    for (const f of t.filesChanged) {
      fileChangeCount.set(f, (fileChangeCount.get(f) ?? 0) + 1);
    }
    for (const f of t.newFiles) {
      fileChangeCount.set(f, (fileChangeCount.get(f) ?? 0) + 1);
      newFileSet.add(f);
    }
  }
  return Array.from(fileChangeCount.entries())
    .map(([file, count]) => ({ file, totalChanges: count, isNew: newFileSet.has(file) }))
    .sort((a, b) => b.totalChanges - a.totalChanges);
}

export async function generateReport(input: {
  sessionId: string;
  reportRoot: string;
  analyzerConfig: {
    prefer: 'claude' | 'codex';
    timeout: number;
    enabled: boolean;
  };
  totals: {
    added: number;
    removed: number;
    files: number;
    turns: number;
  };
  files: string[];
  diff: string;
  lastAssistantMessage: string;
  turns: TurnRecord[];
}, deps?: {
  runAnalyzerFn?: typeof runAnalyzer;
}) {
  const runAnalyzerFn = deps?.runAnalyzerFn ?? runAnalyzer;
  let raw: string | null = null;
  try {
    raw = await runAnalyzerFn(input.analyzerConfig, {
      stat: `+${input.totals.added} -${input.totals.removed}`,
      files: input.files,
      lastAssistantMessage: input.lastAssistantMessage,
      diff: input.diff
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[VibeGPS] LLM 分析失败: ${msg}\n`);
    raw = null;
  }

  const parsed = raw ? parseLLMResult(raw) : null;
  const analysis =
    parsed ?? {
      summary: '静态报告模式：LLM 分析不可用',
      intent: '基于变更统计生成',
      risks: ['请人工复核关键模块'],
      highlights: ['已输出完整变更明细']
    };

  const turnSummaries = buildTurnSummaries(input.turns);
  const fileHeatmap = buildFileHeatmap(input.turns);

  const reportPath = await renderHtmlReport(input.reportRoot, {
    sessionId: input.sessionId,
    generatedAt: Date.now(),
    totals: input.totals,
    analysis,
    turnSummaries,
    fileHeatmap
  });

  const output = renderTerminalSummary({
    sessionId: input.sessionId,
    totals: input.totals,
    analysis,
    reportPath
  });

  const compactOutput = renderCompactNotification({
    sessionId: input.sessionId,
    totals: input.totals,
    analysis,
    reportPath
  });

  return {
    sessionId: input.sessionId,
    output,
    compactOutput,
    reportPath
  };
}

export async function orchestrateReportFromStore(
  sessionId?: string,
  options?: {
    vibegpsHome?: string;
    sessionsDir?: string;
    reportsDir?: string;
  }
): Promise<{ sessionId: string; output: string; compactOutput: string; reportPath: string }> {
  const vibegpsHome = options?.vibegpsHome ?? VIBEGPS_HOME;
  const sessionsDir = options?.sessionsDir ?? SESSIONS_DIR;
  const reportsDir = options?.reportsDir ?? REPORTS_DIR;
  const config = await loadConfig(vibegpsHome);

  let targetSessionId = sessionId;
  if (!targetSessionId) {
    const sessions = await listSessionMetas(sessionsDir);
    if (sessions.length === 0) {
      throw new Error('no session data found');
    }
    targetSessionId = sessions[0].sessionId;
  }

  const meta = await readSessionMeta(sessionsDir, targetSessionId);
  const turns = await readTurns(sessionsDir, targetSessionId);
  if (turns.length === 0) {
    throw new Error(`session ${targetSessionId} has no turns`);
  }

  const changedFiles = turns.flatMap((turn) => turn.filesChanged);
  const newFiles = turns.flatMap((turn) => turn.newFiles);
  const uniqueFiles = Array.from(new Set([...changedFiles, ...newFiles])).slice(0, 100);
  const files = uniqueFiles.map((file) =>
    newFiles.includes(file) ? `${file} (new)` : `${file} (changed)`
  );
  const diff = turns.map((turn) => turn.diffContent).join('\n');
  const lastAssistantMessage = turns[turns.length - 1].lastAssistantMessage;

  const result = await generateReport({
    sessionId: targetSessionId,
    reportRoot: reportsDir,
    analyzerConfig: config.analyzer,
    totals: {
      added: meta.totalAdded,
      removed: meta.totalRemoved,
      files: uniqueFiles.length,
      turns: meta.turnCount
    },
    files,
    diff,
    lastAssistantMessage,
    turns
  });

  await updateSessionMeta(sessionsDir, targetSessionId, {
    lastReportAt: Date.now(),
    lastReportTurn: meta.turnCount
  });

  return result;
}

export async function orchestrateReportFromDb(
  db: Database.Database,
  sessionId: string,
  options: {
    reportsDir: string;
    vibegpsHome?: string;
    triggerType?: string;
  }
): Promise<{ sessionId: string; output: string; compactOutput: string; reportPath: string }> {
  const session = dbGetSession(db, sessionId);
  if (!session) throw new Error(`session ${sessionId} not found`);

  const dbTurns = dbGetTurns(db, sessionId);
  if (dbTurns.length === 0) throw new Error(`session ${sessionId} has no turns`);

  // 获取文件热力图
  const heatmap = dbGetFileHeatmap(db, sessionId);
  const uniqueFiles = heatmap.map(h => h.file);
  const delta = dbGetSessionTotalDelta(db, sessionId);

  // 获取最新 turn 的 diff content
  const latestTurn = dbTurns[dbTurns.length - 1];
  const snapshotRow = db.prepare('SELECT diff_content FROM snapshots WHERE id = ?').get(latestTurn.endSnapshotId) as { diff_content: string | null } | undefined;
  const diff = snapshotRow?.diff_content ?? dbTurns.map(t => {
    if (t.operationsJson) {
      try {
        const ops = JSON.parse(t.operationsJson) as FileOperation[];
        return operationsToDiff(ops);
      } catch { /* fallback */ }
    }
    return '';
  }).filter(Boolean).join('\n');

  const vibegpsHome = options?.vibegpsHome ?? VIBEGPS_HOME;
  const config = await loadConfig(vibegpsHome);
  const lastAssistantMessage = latestTurn.lastAssistantMessage ?? '';

  // Convert DB turn records to session-store TurnRecord format for generateReport compatibility
  const turns: TurnRecord[] = dbTurns.map(t => ({
    turn: t.turn,
    timestamp: t.timestamp,
    headHash: t.headHash,
    commitDetected: t.commitDetected,
    delta: { added: t.deltaAdded, removed: t.deltaRemoved },
    cumulative: { added: 0, removed: 0 },
    filesChanged: [],
    newFiles: [],
    diffContent: t.operationsJson ? operationsToDiff(JSON.parse(t.operationsJson) as FileOperation[]) : '',
    lastAssistantMessage: t.lastAssistantMessage ?? '',
    operations: t.operationsJson ? JSON.parse(t.operationsJson) as FileOperation[] : []
  }));

  const result = await generateReport({
    sessionId,
    reportRoot: options.reportsDir,
    analyzerConfig: config.analyzer,
    totals: {
      added: delta.added,
      removed: delta.removed,
      files: uniqueFiles.length,
      turns: dbTurns.length
    },
    files: uniqueFiles.map(f => `${f} (changed)`),
    diff,
    lastAssistantMessage,
    turns
  });

  // 记录报告到数据库
  dbInsertReport(db, {
    sessionId,
    generatedAt: Date.now(),
    htmlPath: result.reportPath,
    triggerType: options.triggerType ?? null,
    totalsJson: JSON.stringify(result),
    analysisJson: null
  });

  return result;
}
