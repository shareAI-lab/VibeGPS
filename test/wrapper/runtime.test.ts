import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(latestHtml).toContain('变更概览');
    expect(latestHtml).toContain('Turn 时间线');
  });

  it('auto opens report and emits summary when autoOpen is true', async () => {
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
    const runtime = await createRuntime({
      vibegpsHome: home,
      sessionsDir: sessions,
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
  });

  it('generates report when user explicitly requests report in prompt', async () => {
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
    const runtime = await createRuntime({
      vibegpsHome: home,
      sessionsDir: sessions,
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
  });

  it('synthesizes missing stop when next prompt starts', async () => {
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
    const runtime = await createRuntime({
      vibegpsHome: home,
      sessionsDir: sessions,
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

    const meta = JSON.parse(await readFile(join(sessions, 's3', 'meta.json'), 'utf8'));
    expect(meta.turnCount).toBe(2);

    const turn1 = JSON.parse(
      await readFile(join(sessions, 's3', 'turns', 'turn-001.json'), 'utf8')
    );
    const turn2 = JSON.parse(
      await readFile(join(sessions, 's3', 'turns', 'turn-002.json'), 'utf8')
    );
    expect(turn1.delta.added).toBeGreaterThan(0);
    expect(turn2.delta.added).toBeGreaterThan(0);
    expect(messages.join('\n')).toContain('检测到缺失 Stop Hook');
  });
});
