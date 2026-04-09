import type Database from 'better-sqlite3';
import { join } from 'node:path';
import { REPORTS_DIR, VIBEGPS_HOME } from '../constants.js';
import { orchestrateReportFromDb, orchestrateReportFromStore } from '../reporter/orchestrator.js';
import { openDatabase } from '../store/database.js';
import { getRecentSessions } from '../store/snapshot-store.js';
import { openInBrowser } from '../utils/open.js';

export async function runReportCommand(
  options: { sessionId?: string },
  deps: {
    orchestrate: (sessionId?: string) => Promise<{
      sessionId: string;
      output: string;
      compactOutput: string;
      reportPath: string;
    }>;
    open: (path: string) => Promise<void>;
  }
): Promise<string> {
  const result = await deps.orchestrate(options.sessionId);
  await deps.open(result.reportPath);
  return result.output;
}

async function orchestrateFromDbOrStore(sessionId?: string) {
  const dbPath = join(VIBEGPS_HOME, 'vibegps.db');
  let db: Database.Database | null = null;

  try {
    db = openDatabase(dbPath);

    let targetSessionId = sessionId;
    if (!targetSessionId) {
      const sessions = getRecentSessions(db);
      if (sessions.length === 0) {
        throw new Error('no sessions in db');
      }
      targetSessionId = sessions[0].id;
    }

    return await orchestrateReportFromDb(db, targetSessionId, { reportsDir: REPORTS_DIR });
  } catch {
    // Fall through to file-based
  } finally {
    db?.close();
  }

  return orchestrateReportFromStore(sessionId);
}

export const defaultReportDeps = {
  orchestrate: orchestrateFromDbOrStore,
  open: openInBrowser
};
