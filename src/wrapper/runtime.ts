import { REPORTS_DIR, SESSIONS_DIR, VIBEGPS_HOME } from '../constants.js';
import { loadConfig } from '../store/config.js';
import {
  appendTurn,
  createSession,
  sessionExists
} from '../store/session-store.js';
import { collectGitSnapshot } from '../utils/git.js';
import { orchestrateReportFromStore } from '../reporter/orchestrator.js';
import { createSessionTracker } from './session-tracker.js';

interface HookEvent {
  event: 'SessionStart' | 'Stop';
  payload: Record<string, unknown>;
}

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`hook payload missing ${key}`);
  }
  return value;
}

export async function createRuntime(options?: {
  vibegpsHome?: string;
  sessionsDir?: string;
  reportsDir?: string;
}): Promise<{
  handleHook: (event: HookEvent) => Promise<void>;
}> {
  const vibegpsHome = options?.vibegpsHome ?? VIBEGPS_HOME;
  const sessionsDir = options?.sessionsDir ?? SESSIONS_DIR;
  const reportsDir = options?.reportsDir ?? REPORTS_DIR;
  const config = await loadConfig(vibegpsHome);

  const pendingAutoReports = new Set<string>();
  const tracker = createSessionTracker({
    collectGitSnapshot,
    threshold: config.report.threshold,
    minTurnsBetween: config.report.minTurnsBetween,
    onAutoReport: async (sessionId: string) => {
      pendingAutoReports.add(sessionId);
    }
  });

  async function handleSessionStart(payload: Record<string, unknown>): Promise<void> {
    const sessionId = requireString(payload, 'session_id');
    const cwd = requireString(payload, 'cwd');

    const exists = await sessionExists(sessionsDir, sessionId);
    if (exists) {
      return;
    }

    const baseline = await tracker.onSessionStart({
      session_id: sessionId,
      cwd
    });

    await createSession(sessionsDir, {
      sessionId,
      cwd,
      baselineHead: baseline.headHash
    });
  }

  async function handleStop(payload: Record<string, unknown>): Promise<void> {
    const sessionId = requireString(payload, 'session_id');
    const cwd = requireString(payload, 'cwd');

    const exists = await sessionExists(sessionsDir, sessionId);
    if (!exists) {
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

    await appendTurn(sessionsDir, sessionId, turn);

    if (!pendingAutoReports.has(sessionId)) {
      return;
    }

    pendingAutoReports.delete(sessionId);

    try {
      const report = await orchestrateReportFromStore(sessionId, {
        vibegpsHome,
        sessionsDir,
        reportsDir
      });
      process.stderr.write(`\n[VibeGPS] Auto report: file://${report.reportPath}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`\n[VibeGPS] Auto report skipped: ${message}\n`);
    }
  }

  return {
    handleHook: async (event: HookEvent): Promise<void> => {
      if (event.event === 'SessionStart') {
        await handleSessionStart(event.payload);
        return;
      }

      if (event.event === 'Stop') {
        await handleStop(event.payload);
      }
    }
  };
}
