import type Database from 'better-sqlite3';
import { REPORTS_DIR, VIBEGPS_HOME } from '../constants.js';
import { loadConfig } from '../store/config.js';
import {
  createSession as dbCreateSession,
  sessionExists as dbSessionExists
} from '../store/snapshot-store.js';
import { collectGitSnapshot } from '../utils/git.js';
import { openInBrowser } from '../utils/open.js';
import { orchestrateReportFromStore, orchestrateReportFromDb } from '../reporter/orchestrator.js';
import { createSessionTracker } from './session-tracker.js';
import { createFileChangeCollector, type FileOperation } from './file-change-collector.js';

interface HookEvent {
  event: 'SessionStart' | 'Stop' | 'UserPromptSubmit' | 'PostToolUse';
  payload: Record<string, unknown>;
}

const REPORT_KEYWORDS = [
  /\breport\b/i,
  /报告/,
  /出报告/,
  /生成报告/,
  /总结一下/,
  /汇总一下/
];

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`hook payload missing ${key}`);
  }
  return value;
}

function extractPromptText(payload: Record<string, unknown>): string {
  const candidates = [
    payload.prompt,
    payload.user_prompt,
    payload.message,
    payload.text,
    payload.input,
    payload.query
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return '';
}

function isReportRequested(prompt: string): boolean {
  if (prompt.trim().length === 0) {
    return false;
  }
  return REPORT_KEYWORDS.some((pattern) => pattern.test(prompt));
}

export async function createRuntime(options?: {
  db?: Database.Database;
  agent?: 'claude' | 'codex';
  vibegpsHome?: string;
  reportsDir?: string;
  openReport?: (path: string) => Promise<void>;
  notify?: (message: string) => void;
}): Promise<{
  handleHook: (event: HookEvent) => Promise<void>;
}> {
  const vibegpsHome = options?.vibegpsHome ?? VIBEGPS_HOME;
  const db = options?.db;
  const agent = options?.agent ?? 'claude';
  const reportsDir = options?.reportsDir ?? REPORTS_DIR;
  const openReport = options?.openReport ?? openInBrowser;
  const notify =
    options?.notify ??
    ((message: string) => {
      process.stderr.write(`${message}\n`);
    });
  const config = await loadConfig(vibegpsHome);
  const fileChangeCollector = createFileChangeCollector();

  const pendingAutoReports = new Set<string>();
  const pendingForcedReports = new Set<string>();
  const stopPendingSessions = new Set<string>();
  const tracker = createSessionTracker({
    collectGitSnapshot,
    db: db!,
    threshold: config.report.threshold,
    minTurnsBetween: config.report.minTurnsBetween,
    onAutoReport: async (sessionId: string) => {
      pendingAutoReports.add(sessionId);
    },
    drainOperations: (sessionId: string) => fileChangeCollector.drainOperations(sessionId)
  });

  async function handleSessionStart(payload: Record<string, unknown>): Promise<void> {
    const sessionId = requireString(payload, 'session_id');
    const cwd = requireString(payload, 'cwd');

    if (db && dbSessionExists(db, sessionId)) {
      return;
    }

    // Create session record first so tracker can insert snapshots (FK constraint)
    if (db) {
      dbCreateSession(db, {
        id: sessionId,
        cwd,
        agent,
        baselineHead: ''  // Will be set from tracker snapshot
      });
    }

    const baseline = await tracker.onSessionStart({
      session_id: sessionId,
      cwd
    });

    // Update baseline head now that we have the actual hash
    if (db) {
      db.prepare('UPDATE sessions SET baseline_head = ? WHERE id = ?').run(baseline.headHash, sessionId);
    }
  }

  async function handleStop(payload: Record<string, unknown>): Promise<void> {
    const sessionId = requireString(payload, 'session_id');
    const cwd = requireString(payload, 'cwd');

    if (db && !dbSessionExists(db, sessionId)) {
      await handleSessionStart(payload);
    }

    const turn = await tracker.onStop({
      session_id: sessionId,
      cwd,
      last_assistant_message:
        typeof payload.last_assistant_message === 'string'
          ? payload.last_assistant_message
          : ''
    });
    stopPendingSessions.delete(sessionId);

    // Data is already written to DB inside tracker.onStop
    // No need to call appendTurn anymore

    const shouldAutoReport = pendingAutoReports.has(sessionId);
    const shouldForceReport = pendingForcedReports.has(sessionId);
    if (!shouldAutoReport && !shouldForceReport) {
      return;
    }

    pendingAutoReports.delete(sessionId);
    pendingForcedReports.delete(sessionId);

    try {
      let report: { sessionId: string; output: string; compactOutput: string; reportPath: string };
      if (db) {
        report = await orchestrateReportFromDb(db, sessionId, { reportsDir, vibegpsHome });
      } else {
        report = await orchestrateReportFromStore(sessionId, {
          vibegpsHome,
          reportsDir
        });
      }
      notify(report.compactOutput);
      if (shouldForceReport) {
        notify('[VibeGPS] 已按用户请求生成报告');
      }

      if (config.report.autoOpen) {
        try {
          await openReport(report.reportPath);
          notify('[VibeGPS] 已自动打开报告页面');
        } catch (error) {
          const openMessage = error instanceof Error ? error.message : String(error);
          notify(`[VibeGPS] 报告已生成，但自动打开失败: ${openMessage}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify(`[VibeGPS] Auto report skipped: ${message}`);
    }
  }

  async function handleUserPromptSubmit(payload: Record<string, unknown>): Promise<void> {
    const sessionId = requireString(payload, 'session_id');
    const cwd = requireString(payload, 'cwd');

    if (db && !dbSessionExists(db, sessionId)) {
      await handleSessionStart(payload);
    }

    if (stopPendingSessions.has(sessionId)) {
      await handleStop({
        session_id: sessionId,
        cwd,
        last_assistant_message: ''
      });
      notify('[VibeGPS] 检测到缺失 Stop Hook，已在新一轮对话前自动补齐');
    }

    const promptText = extractPromptText(payload);
    if (isReportRequested(promptText)) {
      pendingForcedReports.add(sessionId);
      notify('[VibeGPS] 检测到用户请求报告，将在本轮结束后生成');
    }

    stopPendingSessions.add(sessionId);
  }

  return {
    handleHook: async (event: HookEvent): Promise<void> => {
      if (event.event === 'SessionStart') {
        await handleSessionStart(event.payload);
        return;
      }

      if (event.event === 'Stop') {
        await handleStop(event.payload);
        return;
      }

      if (event.event === 'PostToolUse') {
        const sid = event.payload.session_id;
        if (typeof sid === 'string' && sid.length > 0) {
          const toolName = event.payload.tool_name;
          const toolInput = event.payload.tool_input as Record<string, unknown> | undefined;
          if (
            typeof toolName === 'string' &&
            ['Write', 'Edit', 'MultiEdit'].includes(toolName) &&
            toolInput &&
            typeof toolInput.file_path === 'string'
          ) {
            fileChangeCollector.recordOperation(sid, {
              tool: toolName as 'Write' | 'Edit' | 'MultiEdit',
              filePath: toolInput.file_path,
              timestamp: Date.now(),
              oldString: typeof toolInput.old_string === 'string' ? toolInput.old_string : undefined,
              newString: typeof toolInput.new_string === 'string' ? toolInput.new_string : undefined,
              content: typeof toolInput.content === 'string' ? toolInput.content : undefined,
            });
          }
        }
        return;
      }

      if (event.event === 'UserPromptSubmit') {
        await handleUserPromptSubmit(event.payload);
      }
    }
  };
}
