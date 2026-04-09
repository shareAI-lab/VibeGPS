import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntime } from '../../src/wrapper/runtime.js';
import { getTurns, getSession } from '../../src/store/snapshot-store.js';

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

describe('runtime hook handling', () => {
  const paths: string[] = [];

  afterEach(async () => {
    await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
    paths.length = 0;
  });

  it('processes SessionStart/Stop and writes session data with auto report', async () => {
    const base = await mkdtemp(join(tmpdir(), 'vibegps-runtime-'));
    paths.push(base);

    const repo = join(base, 'repo');
    const home = join(base, '.vibegps');
    const reports = join(home, 'reports');

    await execa('mkdir', ['-p', repo]);
    await execa('git', ['init'], { cwd: repo });
    await writeFile(join(repo, 'app.ts'), 'console.log("init");\n', 'utf8');
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-m', 'init'], {
      cwd: repo,
      env: {
        GIT_AUTHOR_NAME: 'Bill Billion',
        GIT_AUTHOR_EMAIL: 'bill@example.com',
        GIT_COMMITTER_NAME: 'Bill Billion',
        GIT_COMMITTER_EMAIL: 'bill@example.com'
      }
    });

    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, 'config.json'),
      JSON.stringify({
        report: {
          threshold: 1,
          minTurnsBetween: 1,
          autoOpen: false
        },
        analyzer: {
          prefer: 'claude',
          timeout: 30000,
          enabled: false
        }
      }),
      'utf8'
    );

    const db = createTestDb();
    const runtime = await createRuntime({
      db,
      vibegpsHome: home,
      reportsDir: reports
    });

    await runtime.handleHook({
      event: 'SessionStart',
      payload: {
        session_id: 's1',
        cwd: repo
      }
    });

    await writeFile(join(repo, 'app.ts'), 'console.log("init");\nconsole.log("next");\n', 'utf8');

    await runtime.handleHook({
      event: 'Stop',
      payload: {
        session_id: 's1',
        cwd: repo,
        last_assistant_message: 'done'
      }
    });

    const session = getSession(db, 's1');
    expect(session).not.toBeNull();
    expect(session!.id).toBe('s1');

    const turns = getTurns(db, 's1');
    expect(turns.length).toBe(1);
    expect(turns[0].lastAssistantMessage).toBe('done');
    expect(turns[0].deltaAdded).toBeGreaterThan(0);

    const reportDir = join(reports, 's1');
    const latestHtml = await readFile(join(reportDir, 'latest.html'), 'utf8');
    expect(latestHtml.length).toBeGreaterThan(10);
    expect(latestHtml).toContain('变更概览');
    expect(latestHtml).toContain('Turn 时间线');
    db.close();
  });

  it('auto opens report and emits summary when autoOpen is true', async () => {
    const base = await mkdtemp(join(tmpdir(), 'vibegps-runtime-'));
    paths.push(base);

    const repo = join(base, 'repo');
    const home = join(base, '.vibegps');
    const reports = join(home, 'reports');

    await execa('mkdir', ['-p', repo]);
    await execa('git', ['init'], { cwd: repo });
    await writeFile(join(repo, 'app.ts'), 'console.log("init");\n', 'utf8');
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-m', 'init'], {
      cwd: repo,
      env: {
        GIT_AUTHOR_NAME: 'Bill Billion',
        GIT_AUTHOR_EMAIL: 'bill@example.com',
        GIT_COMMITTER_NAME: 'Bill Billion',
        GIT_COMMITTER_EMAIL: 'bill@example.com'
      }
    });

    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, 'config.json'),
      JSON.stringify({
        report: {
          threshold: 1,
          minTurnsBetween: 1,
          autoOpen: true
        },
        analyzer: {
          prefer: 'claude',
          timeout: 30000,
          enabled: false
        }
      }),
      'utf8'
    );

    const openReport = vi.fn().mockResolvedValue(undefined);
    const messages: string[] = [];
    const db = createTestDb();
    const runtime = await createRuntime({
      db,
      vibegpsHome: home,
      reportsDir: reports,
      openReport,
      notify: (message) => messages.push(message)
    });

    await runtime.handleHook({
      event: 'SessionStart',
      payload: {
        session_id: 's2',
        cwd: repo
      }
    });

    await writeFile(join(repo, 'app.ts'), 'console.log("init");\nconsole.log("next");\n', 'utf8');

    await runtime.handleHook({
      event: 'Stop',
      payload: {
        session_id: 's2',
        cwd: repo,
        last_assistant_message: 'done'
      }
    });

    expect(openReport).toHaveBeenCalledTimes(1);
    expect(openReport).toHaveBeenCalledWith(
      expect.stringContaining('/reports/s2/report-')
    );
    expect(messages.join('\n')).toContain('[VibeGPS]');
    expect(messages.join('\n')).toContain('[VibeGPS] 已自动打开报告页面');
    db.close();
  });

  it('generates report when user explicitly requests report in prompt', async () => {
    const base = await mkdtemp(join(tmpdir(), 'vibegps-runtime-'));
    paths.push(base);

    const repo = join(base, 'repo');
    const home = join(base, '.vibegps');
    const reports = join(home, 'reports');

    await execa('mkdir', ['-p', repo]);
    await execa('git', ['init'], { cwd: repo });
    await writeFile(join(repo, 'app.ts'), 'console.log("init");\n', 'utf8');
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-m', 'init'], {
      cwd: repo,
      env: {
        GIT_AUTHOR_NAME: 'Bill Billion',
        GIT_AUTHOR_EMAIL: 'bill@example.com',
        GIT_COMMITTER_NAME: 'Bill Billion',
        GIT_COMMITTER_EMAIL: 'bill@example.com'
      }
    });

    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, 'config.json'),
      JSON.stringify({
        report: {
          threshold: 9999,
          minTurnsBetween: 1,
          autoOpen: false
        },
        analyzer: {
          prefer: 'claude',
          timeout: 30000,
          enabled: false
        }
      }),
      'utf8'
    );

    const messages: string[] = [];
    const db = createTestDb();
    const runtime = await createRuntime({
      db,
      vibegpsHome: home,
      reportsDir: reports,
      notify: (message) => messages.push(message)
    });

    await runtime.handleHook({
      event: 'SessionStart',
      payload: {
        session_id: 's4',
        cwd: repo
      }
    });

    await runtime.handleHook({
      event: 'UserPromptSubmit',
      payload: {
        session_id: 's4',
        cwd: repo,
        prompt: '请在这一轮结束后生成 report'
      }
    });

    await writeFile(join(repo, 'app.ts'), 'console.log("init");\nconsole.log("next");\n', 'utf8');

    await runtime.handleHook({
      event: 'Stop',
      payload: {
        session_id: 's4',
        cwd: repo,
        last_assistant_message: 'done'
      }
    });

    const latestHtml = await readFile(join(reports, 's4', 'latest.html'), 'utf8');
    expect(latestHtml.length).toBeGreaterThan(10);
    expect(messages.join('\n')).toContain('[VibeGPS] 检测到用户请求报告，将在本轮结束后生成');
    expect(messages.join('\n')).toContain('[VibeGPS] 已按用户请求生成报告');
    expect(messages.some((m) => m.includes('[VibeGPS]') && m.includes('file://'))).toBe(true);
    db.close();
  });

  it('synthesizes missing stop when next prompt starts', async () => {
    const base = await mkdtemp(join(tmpdir(), 'vibegps-runtime-'));
    paths.push(base);

    const repo = join(base, 'repo');
    const home = join(base, '.vibegps');
    const reports = join(home, 'reports');

    await execa('mkdir', ['-p', repo]);
    await execa('git', ['init'], { cwd: repo });
    await writeFile(join(repo, 'app.ts'), 'console.log("init");\n', 'utf8');
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-m', 'init'], {
      cwd: repo,
      env: {
        GIT_AUTHOR_NAME: 'Bill Billion',
        GIT_AUTHOR_EMAIL: 'bill@example.com',
        GIT_COMMITTER_NAME: 'Bill Billion',
        GIT_COMMITTER_EMAIL: 'bill@example.com'
      }
    });

    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, 'config.json'),
      JSON.stringify({
        report: {
          threshold: 9999,
          minTurnsBetween: 1,
          autoOpen: false
        },
        analyzer: {
          prefer: 'claude',
          timeout: 30000,
          enabled: false
        }
      }),
      'utf8'
    );

    const messages: string[] = [];
    const db = createTestDb();
    const runtime = await createRuntime({
      db,
      vibegpsHome: home,
      reportsDir: reports,
      notify: (message) => messages.push(message)
    });

    await runtime.handleHook({
      event: 'SessionStart',
      payload: {
        session_id: 's3',
        cwd: repo
      }
    });

    await runtime.handleHook({
      event: 'UserPromptSubmit',
      payload: {
        session_id: 's3',
        cwd: repo
      }
    });

    await writeFile(
      join(repo, 'app.ts'),
      'console.log("init");\nconsole.log("turn1");\n',
      'utf8'
    );

    await runtime.handleHook({
      event: 'UserPromptSubmit',
      payload: {
        session_id: 's3',
        cwd: repo
      }
    });

    await writeFile(
      join(repo, 'app.ts'),
      'console.log("init");\nconsole.log("turn1");\nconsole.log("turn2");\n',
      'utf8'
    );

    await runtime.handleHook({
      event: 'Stop',
      payload: {
        session_id: 's3',
        cwd: repo,
        last_assistant_message: 'done'
      }
    });

    const turns = getTurns(db, 's3');
    expect(turns.length).toBe(2);

    expect(turns[0].deltaAdded).toBeGreaterThan(0);
    expect(turns[1].deltaAdded).toBeGreaterThan(0);
    expect(messages.join('\n')).toContain('检测到缺失 Stop Hook');
    db.close();
  });

  it('deduplicates duplicate stop events for the same turn', async () => {
    const base = await mkdtemp(join(tmpdir(), 'vibegps-runtime-'));
    paths.push(base);

    const repo = join(base, 'repo');
    const home = join(base, '.vibegps');
    const reports = join(home, 'reports');

    await execa('mkdir', ['-p', repo]);
    await execa('git', ['init'], { cwd: repo });
    await writeFile(join(repo, 'app.ts'), 'console.log("init");\n', 'utf8');
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-m', 'init'], {
      cwd: repo,
      env: {
        GIT_AUTHOR_NAME: 'Bill Billion',
        GIT_AUTHOR_EMAIL: 'bill@example.com',
        GIT_COMMITTER_NAME: 'Bill Billion',
        GIT_COMMITTER_EMAIL: 'bill@example.com'
      }
    });

    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, 'config.json'),
      JSON.stringify({
        report: {
          threshold: 1,
          minTurnsBetween: 1,
          autoOpen: false
        },
        analyzer: {
          prefer: 'claude',
          timeout: 30000,
          enabled: false
        }
      }),
      'utf8'
    );

    const db = createTestDb();
    const runtime = await createRuntime({
      db,
      vibegpsHome: home,
      reportsDir: reports
    });

    await runtime.handleHook({
      event: 'SessionStart',
      payload: {
        session_id: 's6',
        cwd: repo
      }
    });

    await runtime.handleHook({
      event: 'UserPromptSubmit',
      payload: {
        session_id: 's6',
        cwd: repo,
        turn_id: 'turn-1',
        prompt: '请处理'
      }
    });

    await writeFile(join(repo, 'app.ts'), 'console.log("init");\nconsole.log("next");\n', 'utf8');

    await runtime.handleHook({
      event: 'Stop',
      payload: {
        session_id: 's6',
        cwd: repo,
        turn_id: 'turn-1',
        last_assistant_message: 'done'
      }
    });

    await runtime.handleHook({
      event: 'Stop',
      payload: {
        session_id: 's6',
        cwd: repo,
        turn_id: 'turn-1',
        last_assistant_message: 'done again'
      }
    });

    const turns = getTurns(db, 's6');
    expect(turns.length).toBe(1);
    const reportCountRow = db
      .prepare('SELECT COUNT(1) as c FROM reports WHERE session_id = ?')
      .get('s6') as { c: number };
    expect(reportCountRow.c).toBe(1);
    db.close();
  });
});
