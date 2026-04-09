import type Database from 'better-sqlite3';
import type { GitSnapshot } from '../utils/git.js';
import type { FileOperation } from './file-change-collector.js';
import { insertSnapshot, insertTurn, insertFileChanges, type FileChangeRecord } from '../store/snapshot-store.js';

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
  lastReportTurn: number;
  prevSnapshotId: number;
}

interface StartPayload {
  session_id: string;
  cwd: string;
}

interface StopPayload {
  session_id: string;
  cwd: string;
  last_assistant_message?: string;
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
}

export function createSessionTracker(deps: {
  collectGitSnapshot: (cwd: string) => Promise<GitSnapshot>;
  db: Database.Database;
  threshold: number;
  minTurnsBetween: number;
  onAutoReport: (sessionId: string) => Promise<void>;
  drainOperations?: (sessionId: string) => FileOperation[];
}) {
  const sessions = new Map<string, SessionState>();

  async function onSessionStart(payload: StartPayload): Promise<GitSnapshot> {
    const snapshot = await deps.collectGitSnapshot(payload.cwd);
    const snapshotId = insertSnapshot(deps.db, {
      sessionId: payload.session_id,
      turn: null,
      headHash: snapshot.headHash,
      totalAdded: snapshot.cumulative.added,
      totalRemoved: snapshot.cumulative.removed,
      fileCount: snapshot.filesChanged.length + snapshot.newFiles.length,
      diffContent: snapshot.diffContent
    });
    sessions.set(payload.session_id, {
      turn: 0,
      prevHead: snapshot.headHash,
      prevCumulative: snapshot.cumulative,
      sessionTotal: { added: 0, removed: 0 },
      lastReportTurn: 0,
      prevSnapshotId: snapshotId
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

    const endSnapshotId = insertSnapshot(deps.db, {
      sessionId: payload.session_id,
      turn: currentTurn,
      headHash: snapshot.headHash,
      totalAdded: snapshot.cumulative.added,
      totalRemoved: snapshot.cumulative.removed,
      fileCount: snapshot.filesChanged.length + snapshot.newFiles.length,
      diffContent: snapshot.diffContent
    });

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

    insertTurn(deps.db, {
      sessionId: payload.session_id,
      turn: currentTurn,
      startSnapshotId: state.prevSnapshotId,
      endSnapshotId,
      timestamp: Date.now(),
      headHash: snapshot.headHash,
      commitDetected,
      deltaAdded: delta.added,
      deltaRemoved: delta.removed,
      lastAssistantMessage: payload.last_assistant_message ?? null,
      operationsJson: operations.length > 0 ? JSON.stringify(operations) : null
    });

    state.prevHead = snapshot.headHash;
    state.prevCumulative = snapshot.cumulative;
    state.prevSnapshotId = endSnapshotId;
    state.sessionTotal.added += Math.max(0, delta.added);
    state.sessionTotal.removed += Math.max(0, delta.removed);

    const total = state.sessionTotal.added + state.sessionTotal.removed;
    // 设计意图：首个达到阈值的回合应立即触发报告，后续再按最小回合间隔节流。
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
      operations
    };
  }

  return {
    onSessionStart,
    onStop
  };
}
