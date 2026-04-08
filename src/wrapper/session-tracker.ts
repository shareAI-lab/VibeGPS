import type { GitSnapshot } from '../utils/git.js';

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
}

export function createSessionTracker(deps: {
  collectGitSnapshot: (cwd: string) => Promise<GitSnapshot>;
  threshold: number;
  minTurnsBetween: number;
  onAutoReport: (sessionId: string) => Promise<void>;
}) {
  const sessions = new Map<string, SessionState>();

  async function onSessionStart(payload: StartPayload): Promise<GitSnapshot> {
    const snapshot = await deps.collectGitSnapshot(payload.cwd);
    sessions.set(payload.session_id, {
      turn: 0,
      prevHead: snapshot.headHash,
      prevCumulative: snapshot.cumulative,
      sessionTotal: { added: 0, removed: 0 },
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
    state.prevHead = snapshot.headHash;
    state.prevCumulative = snapshot.cumulative;
    state.sessionTotal.added += Math.max(0, delta.added);
    state.sessionTotal.removed += Math.max(0, delta.removed);

    const total = state.sessionTotal.added + state.sessionTotal.removed;
    if (total >= deps.threshold && state.turn - state.lastReportTurn >= deps.minTurnsBetween) {
      state.lastReportTurn = state.turn;
      await deps.onAutoReport(payload.session_id);
    }

    return {
      turn: state.turn,
      timestamp: Date.now(),
      headHash: snapshot.headHash,
      commitDetected,
      delta,
      cumulative: snapshot.cumulative,
      filesChanged: snapshot.filesChanged,
      newFiles: snapshot.newFiles,
      diffContent: snapshot.diffContent,
      lastAssistantMessage: payload.last_assistant_message ?? ''
    };
  }

  return {
    onSessionStart,
    onStop
  };
}
