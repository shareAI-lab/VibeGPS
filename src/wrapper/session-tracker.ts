import type Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GitSnapshot } from '../utils/git.js';
import type { FileOperation } from './file-change-collector.js';
import { insertTurn, insertFileChanges, type FileChangeRecord } from '../store/snapshot-store.js';

interface SessionState {
  turn: number;
  prevHead: string;
  prevCumulative: {
    added: number;
    removed: number;
  };
  sessionTotal: {
    added: number;
    removed: number;
  };
  absAddedTotal: number;
  lastReportTurn: number;
}

interface StartPayload {
  session_id: string;
  cwd: string;
}

interface StopPayload {
  session_id: string;
  cwd: string;
  last_assistant_message?: string;
  user_prompt?: string;
}

export interface TrackerTurnRecord {
  turn: number;
  timestamp: number;
  headHash: string;
  commitDetected: boolean;
  delta: {
    added: number;
    removed: number;
  };
  cumulative: {
    added: number;
    removed: number;
  };
  filesChanged: string[];
  newFiles: string[];
  diffContent: string;
  lastAssistantMessage: string;
  operations: FileOperation[];
  userPrompt: string;
  patchPath: string;
}

export function createSessionTracker(deps: {
  collectGitSnapshot: (cwd: string) => Promise<GitSnapshot>;
  db: Database.Database;
  patchesDir: string;
  threshold: number;
  minTurnsBetween: number;
  onAutoReport: (sessionId: string) => Promise<void>;
  drainOperations?: (sessionId: string) => FileOperation[];
}) {
  const sessions = new Map<string, SessionState>();

  async function onSessionStart(payload: StartPayload): Promise<GitSnapshot> {
    const snapshot = await deps.collectGitSnapshot(payload.cwd);
    sessions.set(payload.session_id, {
      turn: 0,
      prevHead: snapshot.headHash,
      prevCumulative: snapshot.cumulative,
      sessionTotal: { added: 0, removed: 0 },
      absAddedTotal: 0,
      lastReportTurn: 0
    });
    return snapshot;
  }

  async function onStop(payload: StopPayload): Promise<TrackerTurnRecord> {
    const state = sessions.get(payload.session_id);
    if (!state) {
      throw new Error(`unknown session: ${payload.session_id}`);
    }

    const snapshot = await deps.collectGitSnapshot(payload.cwd);
    const commitDetected = snapshot.headHash !== state.prevHead;

    const delta = commitDetected
      ? snapshot.cumulative
      : {
          added: snapshot.cumulative.added - state.prevCumulative.added,
          removed: snapshot.cumulative.removed - state.prevCumulative.removed
        };

    state.turn += 1;
    const currentTurn = state.turn;

    // Write .patch file
    const patchDir = join(deps.patchesDir, payload.session_id);
    mkdirSync(patchDir, { recursive: true });
    const patchFileName = `turn-${String(currentTurn).padStart(3, '0')}.patch`;
    const patchFilePath = join(patchDir, patchFileName);
    const patchContent = snapshot.diffContent || '# no changes detected\n';
    writeFileSync(patchFilePath, patchContent, 'utf8');

    // Drain PostToolUse operations and insert as file_changes
    const operations = deps.drainOperations?.(payload.session_id) ?? [];
    if (operations.length > 0) {
      const fileChanges: FileChangeRecord[] = operations.map(op => ({
        session_id: payload.session_id,
        turn: currentTurn,
        filePath: op.filePath,
        operation: op.tool === 'Write' ? 'write' : 'edit',
        source: 'post_tool_use',
        toolName: op.tool,
        linesAdded: 0,
        linesRemoved: 0,
        oldSnippet: op.oldString,
        newSnippet: op.newString ?? op.content,
        timestamp: op.timestamp
      }));
      insertFileChanges(deps.db, payload.session_id, currentTurn, fileChanges);
    }

    const userPrompt = payload.user_prompt ?? '';

    insertTurn(deps.db, {
      sessionId: payload.session_id,
      turn: currentTurn,
      startSnapshotId: null,
      endSnapshotId: null,
      timestamp: Date.now(),
      headHash: snapshot.headHash,
      commitDetected,
      deltaAdded: delta.added,
      deltaRemoved: delta.removed,
      lastAssistantMessage: payload.last_assistant_message ?? null,
      operationsJson: operations.length > 0 ? JSON.stringify(operations) : null,
      userPrompt: userPrompt || null,
      patchPath: patchFilePath
    });

    state.prevHead = snapshot.headHash;
    state.prevCumulative = snapshot.cumulative;
    state.sessionTotal.added += Math.max(0, delta.added);
    state.sessionTotal.removed += Math.max(0, delta.removed);
    state.absAddedTotal += Math.abs(delta.added);

    const total = state.absAddedTotal;
    const intervalSatisfied =
      state.lastReportTurn === 0 || state.turn - state.lastReportTurn >= deps.minTurnsBetween;
    if (total >= deps.threshold && intervalSatisfied) {
      state.lastReportTurn = state.turn;
      await deps.onAutoReport(payload.session_id);
    }

    return {
      turn: currentTurn,
      timestamp: Date.now(),
      headHash: snapshot.headHash,
      commitDetected,
      delta,
      cumulative: snapshot.cumulative,
      filesChanged: snapshot.filesChanged,
      newFiles: snapshot.newFiles,
      diffContent: snapshot.diffContent,
      lastAssistantMessage: payload.last_assistant_message ?? '',
      operations,
      userPrompt,
      patchPath: patchFilePath
    };
  }

  return {
    onSessionStart,
    onStop
  };
}
