/**
 * @deprecated Use snapshot-store.ts + SQLite database instead.
 * This module is kept for backward compatibility with file-based sessions.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileOperation } from '../wrapper/file-change-collector.js';

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
  operations?: FileOperation[];
}

function sessionPath(root: string, sessionId: string): string {
  return join(root, sessionId);
}

export async function createSession(
  root: string,
  init: {
    sessionId: string;
    cwd: string;
    baselineHead: string;
  }
): Promise<void> {
  const base = sessionPath(root, init.sessionId);
  await mkdir(join(base, 'turns'), { recursive: true });

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
  const base = sessionPath(root, sessionId);
  const turnName = `turn-${String(turn.turn).padStart(3, '0')}`;

  await writeFile(join(base, 'turns', `${turnName}.json`), JSON.stringify(turn, null, 2), 'utf8');

  const metaPath = join(base, 'meta.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf8')) as SessionMeta;
  meta.turnCount += 1;
  meta.totalAdded += Math.max(turn.delta.added, 0);
  meta.totalRemoved += Math.max(turn.delta.removed, 0);

  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

export async function readSessionMeta(root: string, sessionId: string): Promise<SessionMeta> {
  const raw = await readFile(join(sessionPath(root, sessionId), 'meta.json'), 'utf8');
  return JSON.parse(raw) as SessionMeta;
}

export async function sessionExists(root: string, sessionId: string): Promise<boolean> {
  try {
    await readFile(join(sessionPath(root, sessionId), 'meta.json'), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export async function readTurns(root: string, sessionId: string): Promise<TurnRecord[]> {
  const turnsDir = join(sessionPath(root, sessionId), 'turns');
  const files = (await readdir(turnsDir))
    .filter((file) => file.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));

  const turns: TurnRecord[] = [];
  for (const file of files) {
    const raw = await readFile(join(turnsDir, file), 'utf8');
    turns.push(JSON.parse(raw) as TurnRecord);
  }

  return turns;
}

export async function listSessionMetas(root: string): Promise<SessionMeta[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const metas: SessionMeta[] = [];
  for (const entry of entries) {
    try {
      metas.push(await readSessionMeta(root, entry));
    } catch {
      // ignore broken session dirs
    }
  }

  metas.sort((a, b) => b.startedAt - a.startedAt);
  return metas;
}

export async function updateSessionMeta(
  root: string,
  sessionId: string,
  patch: Partial<SessionMeta>
): Promise<SessionMeta> {
  const current = await readSessionMeta(root, sessionId);
  const next = { ...current, ...patch };
  await writeFile(
    join(sessionPath(root, sessionId), 'meta.json'),
    JSON.stringify(next, null, 2),
    'utf8'
  );
  return next;
}
