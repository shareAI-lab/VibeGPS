import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTempCodexHooksFile,
  createTempSettingsFile,
  launchWrappedAgent
} from '../../src/wrapper/launcher.js';

describe('launcher', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
      workspace = '';
    }
  });

  it('spawns agent with --settings and passthrough args', async () => {
    const spawn = vi.fn().mockResolvedValue({ exitCode: 0 });
    const createHookServer = vi.fn().mockResolvedValue({
      port: 3456,
      close: vi.fn().mockResolvedValue(undefined)
    });
    const createRuntime = vi.fn().mockResolvedValue({
      handleHook: vi.fn().mockResolvedValue(undefined)
    });
    const createTempSettings = vi.fn().mockResolvedValue('/tmp/session-1.json');
    const cleanupTempSettings = vi.fn().mockResolvedValue(undefined);
    const notifyMounted = vi.fn();

    const result = await launchWrappedAgent({
      agent: 'claude',
      userArgs: ['--resume', '--model', 'sonnet'],
      spawn,
      createHookServer,
      createRuntime,
      createTempSettings,
      cleanupTempSettings,
      notifyMounted,
      stopHookGraceMs: 0,
      bindSignals: () => () => undefined,
      reportThreshold: 200
    });

    expect(spawn).toHaveBeenCalledWith('claude', [
      '--settings',
      '/tmp/session-1.json',
      '--resume',
      '--model',
      'sonnet'
    ]);
    expect(result.exitCode).toBe(0);
    expect(notifyMounted).toHaveBeenCalledWith(
      expect.stringContaining('[VibeGPS] 🛰️ 导航已启动')
    );
    expect(notifyMounted).toHaveBeenCalledWith(
      expect.stringContaining('报告阈值: 200')
    );
    expect(notifyMounted).toHaveBeenCalledWith(
      expect.stringContaining('vibegps report')
    );
  });

  it('injects SessionStart and Stop hooks while preserving user hooks', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vibegps-launcher-'));
    const userSettingsPath = join(workspace, 'settings.json');
    await writeFile(
      userSettingsPath,
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo user-stop' }] }]
        },
        theme: 'dark'
      }),
      'utf8'
    );

    const tempSettingsPath = await createTempSettingsFile({
      hookPort: 5566,
      userSettingsPath,
      tmpDir: join(workspace, 'tmp-hooks'),
      pid: 1234
    });

    const merged = JSON.parse(await readFile(tempSettingsPath, 'utf8'));
    expect(merged.theme).toBe('dark');
    expect(merged.hooks.Stop).toHaveLength(2);
    expect(merged.hooks.SessionStart).toHaveLength(1);
    expect(merged.hooks.UserPromptSubmit).toHaveLength(1);
    expect(merged.hooks.SessionStart[0].hooks[0].command).toContain('SessionStart');
    expect(merged.hooks.Stop[1].hooks[0].command).toContain('Stop');
    expect(merged.hooks.UserPromptSubmit[0].hooks[0].command).toContain('UserPromptSubmit');
  });

  it('writes and restores codex hooks file for a session', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vibegps-codex-hooks-'));
    const codexDir = join(workspace, '.codex');
    await mkdir(codexDir, { recursive: true });
    const hooksPath = join(codexDir, 'hooks.json');
    const original = JSON.stringify(
      {
        hooks: {
          SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo startup' }] }]
        }
      },
      null,
      2
    );
    await writeFile(hooksPath, original, 'utf8');

    const prepared = await createTempCodexHooksFile({
      cwd: workspace,
      hookPort: 9042
    });

    expect(prepared.enabled).toBe(true);
    const merged = JSON.parse(await readFile(hooksPath, 'utf8'));
    expect(merged.hooks.SessionStart).toHaveLength(2);
    expect(merged.hooks.Stop[0].hooks[0].command).toContain('9042 Stop');

    await prepared.cleanup();
    const restored = await readFile(hooksPath, 'utf8');
    expect(restored).toBe(original);
  });

  it('runs codex with native hook injection and config override', async () => {
    const spawn = vi.fn().mockResolvedValue({ exitCode: 0 });
    const handleHook = vi.fn().mockResolvedValue(undefined);
    const createRuntime = vi.fn().mockResolvedValue({ handleHook });
    const createHookServer = vi.fn().mockResolvedValue({
      port: 3456,
      close: vi.fn().mockResolvedValue(undefined)
    });
    const createCodexHooksFile = vi
      .fn()
      .mockResolvedValue({ enabled: true, cleanup: vi.fn().mockResolvedValue(undefined) });
    const notifyMounted = vi.fn();

    const result = await launchWrappedAgent({
      agent: 'codex',
      userArgs: ['exec', 'write hello world'],
      spawn,
      createRuntime,
      createHookServer,
      createCodexHooksFile,
      notifyMounted,
      stopHookGraceMs: 0,
      bindSignals: () => () => undefined,
      reportThreshold: 200
    });

    expect(result.exitCode).toBe(0);
    expect(spawn).toHaveBeenCalledWith('codex', [
      '-c',
      'features.codex_hooks=true',
      'exec',
      'write hello world'
    ]);
    expect(createHookServer).toHaveBeenCalledTimes(1);
    expect(createCodexHooksFile).toHaveBeenCalledTimes(1);
    expect(handleHook).toHaveBeenCalledTimes(2);
    expect(handleHook.mock.calls[0][0]).toMatchObject({
      event: 'SessionStart'
    });
    expect(handleHook.mock.calls[1][0]).toMatchObject({
      event: 'Stop'
    });
    expect(notifyMounted).toHaveBeenCalledWith(
      expect.stringContaining('[VibeGPS] 🛰️ 导航已启动')
    );
  });

  it('emits codex stop during session when changes become idle', async () => {
    const spawn = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<{ exitCode: number }>((resolve) => {
            setTimeout(() => resolve({ exitCode: 0 }), 200);
          })
      );
    const handleHook = vi.fn().mockResolvedValue(undefined);
    const createRuntime = vi.fn().mockResolvedValue({ handleHook });
    const createHookServer = vi.fn().mockResolvedValue({
      port: 3456,
      close: vi.fn().mockResolvedValue(undefined)
    });
    const createCodexHooksFile = vi
      .fn()
      .mockResolvedValue({ enabled: false, cleanup: vi.fn().mockResolvedValue(undefined) });
    const collectSnapshot = vi
      .fn()
      .mockResolvedValueOnce({ cumulative: { added: 0, removed: 0 } })
      .mockResolvedValueOnce({ cumulative: { added: 5, removed: 0 } })
      .mockResolvedValue({ cumulative: { added: 5, removed: 0 } });

    const launchPromise = launchWrappedAgent({
      agent: 'codex',
      userArgs: ['exec', 'write hello world'],
      spawn,
      createRuntime,
      createHookServer,
      createCodexHooksFile,
      notifyMounted: vi.fn(),
      bindSignals: () => () => undefined,
      reportThreshold: 200,
      collectSnapshot,
      codexTurnPollMs: 20,
      codexTurnQuietMs: 20,
      codexNativeHookGraceMs: 0
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(
      handleHook.mock.calls.filter((call) => call[0]?.event === 'Stop').length
    ).toBeGreaterThanOrEqual(1);

    const result = await launchPromise;
    expect(result.exitCode).toBe(0);
  });

  it('emits codex polled stop on native session when native stop hook is missing', async () => {
    let onEvent:
      | ((
          event: {
            event: 'SessionStart' | 'Stop' | 'UserPromptSubmit';
            payload: Record<string, unknown>;
          }
        ) => Promise<void>)
      | null = null;

    const spawn = vi.fn().mockImplementation(async () => {
      if (onEvent) {
        await onEvent({
          event: 'SessionStart',
          payload: {
            session_id: 'native-s1',
            cwd: '/tmp/native-repo'
          }
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 220));
      return { exitCode: 0 };
    });
    const handleHook = vi.fn().mockResolvedValue(undefined);
    const createRuntime = vi.fn().mockResolvedValue({ handleHook });
    const createHookServer = vi.fn().mockImplementation(async (cb) => {
      onEvent = cb;
      return {
        port: 3902,
        close: vi.fn().mockResolvedValue(undefined)
      };
    });
    const createCodexHooksFile = vi
      .fn()
      .mockResolvedValue({ enabled: true, cleanup: vi.fn().mockResolvedValue(undefined) });
    const collectSnapshot = vi
      .fn()
      .mockResolvedValueOnce({ cumulative: { added: 0, removed: 0 } })
      .mockResolvedValueOnce({ cumulative: { added: 8, removed: 0 } })
      .mockResolvedValue({ cumulative: { added: 8, removed: 0 } });

    const result = await launchWrappedAgent({
      agent: 'codex',
      userArgs: ['exec', 'write hello world'],
      spawn,
      createRuntime,
      createHookServer,
      createCodexHooksFile,
      notifyMounted: vi.fn(),
      bindSignals: () => () => undefined,
      reportThreshold: 200,
      collectSnapshot,
      codexTurnPollMs: 20,
      codexTurnQuietMs: 20,
      codexNativeHookGraceMs: 0
    });

    expect(result.exitCode).toBe(0);
    const stopCalls = handleHook.mock.calls.filter((call) => call[0]?.event === 'Stop');
    expect(stopCalls.length).toBeGreaterThanOrEqual(1);
    expect(stopCalls[0]?.[0]).toMatchObject({
      payload: {
        session_id: 'native-s1',
        cwd: '/tmp/native-repo'
      }
    });
  });

  it('synthesizes claude stop event when stop hook is missing', async () => {
    let onEvent:
      | ((
          event: {
            event: 'SessionStart' | 'Stop' | 'UserPromptSubmit';
            payload: Record<string, unknown>;
          }
        ) => Promise<void>)
      | null = null;
    const spawn = vi.fn().mockImplementation(async () => {
      if (onEvent) {
        await onEvent({
          event: 'SessionStart',
          payload: {
            session_id: 's-fallback',
            cwd: '/tmp/repo'
          }
        });
      }
      return { exitCode: 0 };
    });
    const handleHook = vi.fn().mockResolvedValue(undefined);
    const createRuntime = vi.fn().mockResolvedValue({ handleHook });
    const createHookServer = vi.fn().mockImplementation(async (cb) => {
      onEvent = cb;
      return {
        port: 3901,
        close: vi.fn().mockResolvedValue(undefined)
      };
    });
    const notifyMounted = vi.fn();

    const result = await launchWrappedAgent({
      agent: 'claude',
      userArgs: ['-p', 'hello'],
      spawn,
      createRuntime,
      createHookServer,
      createTempSettings: vi.fn().mockResolvedValue('/tmp/session-2.json'),
      cleanupTempSettings: vi.fn().mockResolvedValue(undefined),
      notifyMounted,
      stopHookGraceMs: 0,
      bindSignals: () => () => undefined,
      reportThreshold: 200
    });

    expect(result.exitCode).toBe(0);
    expect(handleHook).toHaveBeenCalledTimes(2);
    expect(handleHook.mock.calls[0][0]).toMatchObject({
      event: 'SessionStart'
    });
    expect(handleHook.mock.calls[1][0]).toMatchObject({
      event: 'Stop',
      payload: {
        session_id: 's-fallback',
        cwd: '/tmp/repo'
      }
    });
    expect(notifyMounted).toHaveBeenCalledWith(
      expect.stringContaining('未收到 Stop Hook')
    );
  });
});
