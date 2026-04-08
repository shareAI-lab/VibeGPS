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
import { renderHtmlReport } from './html-renderer.js';
import { renderTerminalSummary } from './terminal-renderer.js';

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
}) {
  const raw = await runAnalyzer(input.analyzerConfig, {
    stat: `+${input.totals.added} -${input.totals.removed}`,
    files: input.files,
    lastAssistantMessage: input.lastAssistantMessage,
    diff: input.diff
  });

  const parsed = raw ? parseLLMResult(raw) : null;
  const analysis =
    parsed ?? {
      summary: '静态报告模式：LLM 分析不可用',
      intent: '基于变更统计生成',
      risks: ['请人工复核关键模块'],
      highlights: ['已输出完整变更明细']
    };

  const reportPath = await renderHtmlReport(input.reportRoot, {
    sessionId: input.sessionId,
    generatedAt: Date.now(),
    totals: input.totals,
    analysis,
    timeline: []
  });

  const output = renderTerminalSummary({
    sessionId: input.sessionId,
    totals: input.totals,
    analysis,
    reportPath
  });

  return {
    sessionId: input.sessionId,
    output,
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
): Promise<{ sessionId: string; output: string; reportPath: string }> {
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

  const uniqueFiles = Array.from(
    new Set(turns.flatMap((turn) => turn.filesChanged))
  ).slice(0, 100);
  const files = uniqueFiles.map((file) => `${file} (changed)`);
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
    lastAssistantMessage
  });

  await updateSessionMeta(sessionsDir, targetSessionId, {
    lastReportAt: Date.now(),
    lastReportTurn: meta.turnCount
  });

  return result;
}
