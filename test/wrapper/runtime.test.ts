import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/wrapper/runtime.js';

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
    const sessions = join(home, 'sessions');
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

    const runtime = await createRuntime({
      vibegpsHome: home,
      sessionsDir: sessions,
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

    const meta = JSON.parse(await readFile(join(sessions, 's1', 'meta.json'), 'utf8'));
    expect(meta.turnCount).toBe(1);
    expect(meta.totalAdded).toBeGreaterThan(0);

    const turn = JSON.parse(
      await readFile(join(sessions, 's1', 'turns', 'turn-001.json'), 'utf8')
    );
    expect(turn.lastAssistantMessage).toBe('done');

    const reportDir = join(reports, 's1');
    const latestHtml = await readFile(join(reportDir, 'latest.html'), 'utf8');
    expect(latestHtml.length).toBeGreaterThan(10);
  });
});
