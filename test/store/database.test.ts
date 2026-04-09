import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/store/database.js';
import {
  createSession,
  sessionExists,
  insertSnapshot,
  insertFileChanges,
  insertTurn,
  insertReport,
  getSession,
  getLatestSnapshot,
  getTurns,
  getFileHeatmap,
  getRecentSessions,
  getSessionTotalDelta,
  type FileChangeRecord,
  type TurnRecord
} from '../../src/store/snapshot-store.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, cwd TEXT NOT NULL, agent TEXT NOT NULL DEFAULT 'claude',
      started_at INTEGER NOT NULL, ended_at INTEGER, baseline_head TEXT NOT NULL
    );
    CREATE TABLE snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id),
      turn INTEGER, head_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
      total_added INTEGER DEFAULT 0, total_removed INTEGER DEFAULT 0,
      file_count INTEGER DEFAULT 0, diff_content TEXT
    );
    CREATE TABLE file_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id),
      turn INTEGER NOT NULL, file_path TEXT NOT NULL, operation TEXT NOT NULL,
      source TEXT NOT NULL, tool_name TEXT, lines_added INTEGER DEFAULT 0,
      lines_removed INTEGER DEFAULT 0, old_snippet TEXT, new_snippet TEXT, timestamp INTEGER NOT NULL
    );
    CREATE TABLE turns (
      session_id TEXT NOT NULL REFERENCES sessions(id), turn INTEGER NOT NULL,
      start_snapshot_id INTEGER REFERENCES snapshots(id),
      end_snapshot_id INTEGER REFERENCES snapshots(id),
      timestamp INTEGER NOT NULL, head_hash TEXT NOT NULL,
      commit_detected INTEGER DEFAULT 0, delta_added INTEGER DEFAULT 0,
      delta_removed INTEGER DEFAULT 0, last_assistant_message TEXT,
      operations_json TEXT, PRIMARY KEY (session_id, turn)
    );
    CREATE TABLE reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id),
      generated_at INTEGER NOT NULL, html_path TEXT NOT NULL, trigger_type TEXT,
      totals_json TEXT, analysis_json TEXT
    );
    CREATE TABLE agent_outputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id),
      turn INTEGER, agent TEXT NOT NULL, raw_output TEXT, parsed_json TEXT, created_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe('database module', () => {
  it('creates database with correct schema', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vibegps-db-'));
    const dbPath = join(dir, 'test.db');
    const db = openDatabase(dbPath);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('sessions');
    expect(tableNames).toContain('snapshots');
    expect(tableNames).toContain('file_changes');
    expect(tableNames).toContain('turns');
    expect(tableNames).toContain('reports');
    expect(tableNames).toContain('agent_outputs');

    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('sets user_version pragma', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vibegps-db-'));
    const dbPath = join(dir, 'test.db');
    const db = openDatabase(dbPath);

    const version = db.pragma('user_version', { simple: true });
    expect(version).toBe(1);

    db.close();
    await rm(dir, { recursive: true, force: true });
  });
});

describe('snapshot-store CRUD', () => {
  it('creates session and checks existence', () => {
    const db = createTestDb();
    expect(sessionExists(db, 's1')).toBe(false);

    createSession(db, { id: 's1', cwd: '/tmp/repo', agent: 'claude', baselineHead: 'abc123' });
    expect(sessionExists(db, 's1')).toBe(true);

    const session = getSession(db, 's1');
    expect(session).not.toBeNull();
    expect(session!.id).toBe('s1');
    expect(session!.cwd).toBe('/tmp/repo');
    expect(session!.agent).toBe('claude');

    db.close();
  });

  it('inserts and retrieves snapshots', () => {
    const db = createTestDb();
    createSession(db, { id: 's1', cwd: '/tmp', agent: 'claude', baselineHead: 'h1' });

    const id1 = insertSnapshot(db, {
      sessionId: 's1', turn: null, headHash: 'h1',
      totalAdded: 0, totalRemoved: 0, fileCount: 0
    });
    const id2 = insertSnapshot(db, {
      sessionId: 's1', turn: 1, headHash: 'h2',
      totalAdded: 50, totalRemoved: 10, fileCount: 5,
      diffContent: 'diff content here'
    });

    expect(id1).toBeGreaterThan(0);
    expect(id2).toBeGreaterThan(id1);

    const latest = getLatestSnapshot(db, 's1')!;
    expect(latest.turn).toBe(1);
    expect(latest.totalAdded).toBe(50);
    expect(latest.diffContent).toBe('diff content here');

    db.close();
  });

  it('inserts file changes and queries heatmap', () => {
    const db = createTestDb();
    createSession(db, { id: 's1', cwd: '/tmp', agent: 'claude', baselineHead: 'h1' });

    const changes: FileChangeRecord[] = [
      { session_id: 's1', turn: 1, filePath: 'src/a.ts', operation: 'edit', source: 'post_tool_use', toolName: 'Edit', linesAdded: 10, linesRemoved: 3, timestamp: Date.now() },
      { session_id: 's1', turn: 1, filePath: 'src/b.ts', operation: 'write', source: 'post_tool_use', toolName: 'Write', linesAdded: 20, linesRemoved: 0, timestamp: Date.now() },
      { session_id: 's1', turn: 2, filePath: 'src/a.ts', operation: 'edit', source: 'post_tool_use', toolName: 'Edit', linesAdded: 5, linesRemoved: 2, timestamp: Date.now() }
    ];
    insertFileChanges(db, 's1', 1, changes.slice(0, 2));
    insertFileChanges(db, 's1', 2, changes.slice(2));

    const heatmap = getFileHeatmap(db, 's1');
    expect(heatmap.length).toBe(2);
    expect(heatmap[0].file).toBe('src/a.ts');
    expect(heatmap[0].totalChanges).toBe(2);
    expect(heatmap[1].isNew).toBe(true); // src/b.ts is write

    db.close();
  });

  it('inserts and retrieves turns', () => {
    const db = createTestDb();
    createSession(db, { id: 's1', cwd: '/tmp', agent: 'claude', baselineHead: 'h1' });

    const snap1 = insertSnapshot(db, { sessionId: 's1', turn: null, headHash: 'h1', totalAdded: 0, totalRemoved: 0, fileCount: 0 });
    const snap2 = insertSnapshot(db, { sessionId: 's1', turn: 1, headHash: 'h2', totalAdded: 30, totalRemoved: 5, fileCount: 3 });

    const turn: TurnRecord = {
      sessionId: 's1', turn: 1, startSnapshotId: snap1, endSnapshotId: snap2,
      timestamp: Date.now(), headHash: 'h2', commitDetected: false,
      deltaAdded: 30, deltaRemoved: 5, lastAssistantMessage: 'done',
      operationsJson: null
    };
    insertTurn(db, turn);

    const turns = getTurns(db, 's1');
    expect(turns.length).toBe(1);
    expect(turns[0].deltaAdded).toBe(30);
    expect(turns[0].commitDetected).toBe(false);
    expect(turns[0].lastAssistantMessage).toBe('done');

    db.close();
  });

  it('computes session total delta', () => {
    const db = createTestDb();
    createSession(db, { id: 's1', cwd: '/tmp', agent: 'claude', baselineHead: 'h1' });

    const snap1 = insertSnapshot(db, { sessionId: 's1', turn: null, headHash: 'h1', totalAdded: 0, totalRemoved: 0, fileCount: 0 });
    const snap2 = insertSnapshot(db, { sessionId: 's1', turn: 1, headHash: 'h1', totalAdded: 30, totalRemoved: 5, fileCount: 2 });
    const snap3 = insertSnapshot(db, { sessionId: 's1', turn: 2, headHash: 'h1', totalAdded: 50, totalRemoved: 15, fileCount: 3 });

    insertTurn(db, { sessionId: 's1', turn: 1, startSnapshotId: snap1, endSnapshotId: snap2, timestamp: Date.now(), headHash: 'h1', commitDetected: false, deltaAdded: 30, deltaRemoved: 5, lastAssistantMessage: null, operationsJson: null });
    insertTurn(db, { sessionId: 's1', turn: 2, startSnapshotId: snap2, endSnapshotId: snap3, timestamp: Date.now(), headHash: 'h1', commitDetected: false, deltaAdded: 20, deltaRemoved: 10, lastAssistantMessage: null, operationsJson: null });

    const delta = getSessionTotalDelta(db, 's1');
    expect(delta.added).toBe(50);
    expect(delta.removed).toBe(15);

    db.close();
  });

  it('inserts report records', () => {
    const db = createTestDb();
    createSession(db, { id: 's1', cwd: '/tmp', agent: 'claude', baselineHead: 'h1' });

    insertReport(db, {
      sessionId: 's1', generatedAt: Date.now(), htmlPath: '/tmp/report.html',
      triggerType: 'auto', totalsJson: '{"added":50}', analysisJson: '{"summary":"ok"}'
    });

    const reports = db.prepare('SELECT * FROM reports WHERE session_id = ?').all('s1') as Record<string, unknown>[];
    expect(reports.length).toBe(1);
    expect(reports[0].trigger_type).toBe('auto');

    db.close();
  });

  it('lists recent sessions', () => {
    const db = createTestDb();
    // Ensure different timestamps by ordering
    createSession(db, { id: 's1', cwd: '/a', agent: 'claude', baselineHead: 'h1' });
    // Manually update started_at to ensure ordering
    db.prepare("UPDATE sessions SET started_at = started_at + 1000 WHERE id = 's2'").run();
    createSession(db, { id: 's2', cwd: '/b', agent: 'codex', baselineHead: 'h2' });
    db.prepare("UPDATE sessions SET started_at = started_at + 2000 WHERE id = 's2'").run();

    const sessions = getRecentSessions(db);
    expect(sessions.length).toBe(2);
    expect(sessions[0].id).toBe('s2');

    db.close();
  });

  it('truncates snippets to 500 chars', () => {
    const db = createTestDb();
    createSession(db, { id: 's1', cwd: '/tmp', agent: 'claude', baselineHead: 'h1' });

    const longSnippet = 'x'.repeat(600);
    insertFileChanges(db, 's1', 1, [
      { session_id: 's1', turn: 1, filePath: 'a.ts', operation: 'edit', source: 'post_tool_use', linesAdded: 0, linesRemoved: 0, oldSnippet: longSnippet, timestamp: Date.now() }
    ]);

    const row = db.prepare('SELECT old_snippet FROM file_changes WHERE session_id = ?').get('s1') as { old_snippet: string };
    expect(row.old_snippet.length).toBe(500);

    db.close();
  });
});
