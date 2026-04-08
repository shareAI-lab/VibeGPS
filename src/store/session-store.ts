import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SessionMeta {
  sessionId: string;
  cwd: string;
  startedAt: number;
  endedAt?: number;
  baselineHead: string;
  totalAdded: number;
  totalRemoved: number;
  turnCount: number;
  lastReportAt?: number;
  lastReportTurn?: number;
}

export interface TurnRecord {
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

export async function createSession(
  root: string,
  init: {
    sessionId: string;
    cwd: string;
    baselineHead: string;
  }
): Promise<void> {
  const base = join(root, init.sessionId);
  await mkdir(join(base, 'turns'), { recursive: true });
  await mkdir(join(base, 'diffs'), { recursive: true });

  const meta: SessionMeta = {
    sessionId: init.sessionId,
    cwd: init.cwd,
    startedAt: Date.now(),
    baselineHead: init.baselineHead,
    totalAdded: 0,
    totalRemoved: 0,
    turnCount: 0
  };

  await writeFile(join(base, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
}

export async function appendTurn(root: string, sessionId: string, turn: TurnRecord): Promise<void> {
  const base = join(root, sessionId);
  const turnName = `turn-${String(turn.turn).padStart(3, '0')}`;

  await writeFile(join(base, 'turns', `${turnName}.json`), JSON.stringify(turn, null, 2), 'utf8');
  await writeFile(join(base, 'diffs', `${turnName}.diff`), turn.diffContent, 'utf8');

  const metaPath = join(base, 'meta.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf8')) as SessionMeta;
  meta.turnCount += 1;
  meta.totalAdded += Math.max(turn.delta.added, 0);
  meta.totalRemoved += Math.max(turn.delta.removed, 0);

  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}
