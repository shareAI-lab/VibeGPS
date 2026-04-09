import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSessionTracker } from '../../src/wrapper/session-tracker.js';

function testPatchesDir(): string {
  return join(tmpdir(), `vibegps-patches-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, agent TEXT NOT NULL DEFAULT 'claude', started_at INTEGER NOT NULL, ended_at INTEGER, baseline_head TEXT NOT NULL);
    CREATE TABLE snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id), turn INTEGER, head_hash TEXT NOT NULL, timestamp INTEGER NOT NULL, total_added INTEGER DEFAULT 0, total_removed INTEGER DEFAULT 0, file_count INTEGER DEFAULT 0, diff_content TEXT);
    CREATE TABLE file_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id), turn INTEGER NOT NULL, file_path TEXT NOT NULL, operation TEXT NOT NULL, source TEXT NOT NULL, tool_name TEXT, lines_added INTEGER DEFAULT 0, lines_removed INTEGER DEFAULT 0, old_snippet TEXT, new_snippet TEXT, timestamp INTEGER NOT NULL);
    CREATE TABLE turns (session_id TEXT NOT NULL REFERENCES sessions(id), turn INTEGER NOT NULL, start_snapshot_id INTEGER REFERENCES snapshots(id), end_snapshot_id INTEGER REFERENCES snapshots(id), timestamp INTEGER NOT NULL, head_hash TEXT NOT NULL, commit_detected INTEGER DEFAULT 0, delta_added INTEGER DEFAULT 0, delta_removed INTEGER DEFAULT 0, last_assistant_message TEXT, operations_json TEXT, user_prompt TEXT, patch_path TEXT, PRIMARY KEY (session_id, turn));
    CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id), generated_at INTEGER NOT NULL, html_path TEXT NOT NULL, trigger_turn INTEGER, trigger_type TEXT, totals_json TEXT, analysis_json TEXT);
    CREATE TABLE agent_outputs (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id), turn INTEGER, agent TEXT NOT NULL, raw_output TEXT, parsed_json TEXT, created_at INTEGER NOT NULL);
  `);
  return db;
}

function insertTestSession(db: Database.Database, sessionId: string): void {
  db.prepare(
    'INSERT INTO sessions (id, cwd, agent, started_at, baseline_head) VALUES (?, ?, ?, ?, ?)'
  ).run(sessionId, '/tmp/app', 'claude', Date.now(), '');
}

describe('session tracker', () => {
  it('computes delta from previous cumulative', async () => {
    const collectGitSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 0, removed: 0 },
        filesChanged: [],
        newFiles: [],
        diffContent: ''
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 80, removed: 20 },
        filesChanged: ['a.ts'],
        newFiles: [],
        diffContent: 'd1'
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 130, removed: 35 },
        filesChanged: ['a.ts'],
        newFiles: [],
        diffContent: 'd2'
      });

    const db = createTestDb();
    const tracker = createSessionTracker({
      collectGitSnapshot,
      db,
      patchesDir: testPatchesDir(),
      threshold: 200,
      minTurnsBetween: 3,
      onAutoReport: vi.fn()
    });

    insertTestSession(db, 's1');
    await tracker.onSessionStart({ session_id: 's1', cwd: '/tmp/app' });
    const turn1 = await tracker.onStop({
      session_id: 's1',
      cwd: '/tmp/app',
      last_assistant_message: 'm1'
    });
    const turn2 = await tracker.onStop({
      session_id: 's1',
      cwd: '/tmp/app',
      last_assistant_message: 'm2'
    });

    expect(turn1.delta).toEqual({ added: 80, removed: 20 });
    expect(turn2.delta).toEqual({ added: 50, removed: 15 });
    db.close();
  });

  it('marks commitDetected and resets baseline when head changes', async () => {
    const collectGitSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 0, removed: 0 },
        filesChanged: [],
        newFiles: [],
        diffContent: ''
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 80, removed: 20 },
        filesChanged: ['a.ts'],
        newFiles: [],
        diffContent: 'd1'
      })
      .mockResolvedValueOnce({
        headHash: 'def',
        cumulative: { added: 30, removed: 5 },
        filesChanged: ['b.ts'],
        newFiles: [],
        diffContent: 'd2'
      });

    const db = createTestDb();
    const tracker = createSessionTracker({
      collectGitSnapshot,
      db,
      patchesDir: testPatchesDir(),
      threshold: 200,
      minTurnsBetween: 3,
      onAutoReport: vi.fn()
    });

    insertTestSession(db, 's2');
    await tracker.onSessionStart({ session_id: 's2', cwd: '/tmp/app' });
    await tracker.onStop({
      session_id: 's2',
      cwd: '/tmp/app',
      last_assistant_message: 'm1'
    });
    const turn2 = await tracker.onStop({
      session_id: 's2',
      cwd: '/tmp/app',
      last_assistant_message: 'm2'
    });

    expect(turn2.commitDetected).toBe(true);
    expect(turn2.delta).toEqual({ added: 30, removed: 5 });
    db.close();
  });

  it('triggers auto report when threshold and interval are satisfied', async () => {
    const collectGitSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 0, removed: 0 },
        filesChanged: [],
        newFiles: [],
        diffContent: ''
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 110, removed: 30 },
        filesChanged: ['a.ts'],
        newFiles: [],
        diffContent: 'd1'
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 160, removed: 70 },
        filesChanged: ['b.ts'],
        newFiles: [],
        diffContent: 'd2'
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 210, removed: 90 },
        filesChanged: ['c.ts'],
        newFiles: [],
        diffContent: 'd3'
      });

    const db = createTestDb();
    const onAutoReport = vi.fn().mockResolvedValue(undefined);
    const tracker = createSessionTracker({
      collectGitSnapshot,
      db,
      patchesDir: testPatchesDir(),
      threshold: 200,
      minTurnsBetween: 2,
      onAutoReport
    });

    insertTestSession(db, 's3');
    await tracker.onSessionStart({ session_id: 's3', cwd: '/tmp/app' });
    await tracker.onStop({ session_id: 's3', cwd: '/tmp/app' });
    await tracker.onStop({ session_id: 's3', cwd: '/tmp/app' });
    await tracker.onStop({ session_id: 's3', cwd: '/tmp/app' });

    expect(onAutoReport).toHaveBeenCalledTimes(1);
    expect(onAutoReport).toHaveBeenCalledWith('s3');
    db.close();
  });

  it('triggers auto report on first stop when threshold is already reached', async () => {
    const collectGitSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 0, removed: 0 },
        filesChanged: [],
        newFiles: [],
        diffContent: ''
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 210, removed: 20 },
        filesChanged: ['a.ts'],
        newFiles: [],
        diffContent: 'd1'
      });

    const db = createTestDb();
    const onAutoReport = vi.fn().mockResolvedValue(undefined);
    const tracker = createSessionTracker({
      collectGitSnapshot,
      db,
      patchesDir: testPatchesDir(),
      threshold: 200,
      minTurnsBetween: 3,
      onAutoReport
    });

    insertTestSession(db, 's4');
    await tracker.onSessionStart({ session_id: 's4', cwd: '/tmp/app' });
    await tracker.onStop({ session_id: 's4', cwd: '/tmp/app' });

    expect(onAutoReport).toHaveBeenCalledTimes(1);
    expect(onAutoReport).toHaveBeenCalledWith('s4');
    db.close();
  });

  it('triggers auto report when delta_added is negative but abs value reaches threshold', async () => {
    const collectGitSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 1500, removed: 0 },
        filesChanged: ['a.ts'],
        newFiles: [],
        diffContent: 'base'
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 280, removed: 0 },
        filesChanged: ['a.ts'],
        newFiles: [],
        diffContent: 'd1'
      });

    const db = createTestDb();
    const onAutoReport = vi.fn().mockResolvedValue(undefined);
    const tracker = createSessionTracker({
      collectGitSnapshot,
      db,
      patchesDir: testPatchesDir(),
      threshold: 200,
      minTurnsBetween: 1,
      onAutoReport
    });

    insertTestSession(db, 's5');
    await tracker.onSessionStart({ session_id: 's5', cwd: '/tmp/app' });
    const turn = await tracker.onStop({ session_id: 's5', cwd: '/tmp/app' });

    expect(turn.delta.added).toBe(-1220);
    expect(onAutoReport).toHaveBeenCalledTimes(1);
    expect(onAutoReport).toHaveBeenCalledWith('s5');
    db.close();
  });
});
