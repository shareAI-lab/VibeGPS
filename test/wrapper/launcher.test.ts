import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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
    const createTempSettings = vi.fn().mockResolvedValue('/tmp/session-1.json');
    const cleanupTempSettings = vi.fn().mockResolvedValue(undefined);

    const result = await launchWrappedAgent({
      agent: 'claude',
      userArgs: ['--resume', '--model', 'sonnet'],
      spawn,
      createHookServer,
      createTempSettings,
      cleanupTempSettings,
      bindSignals: () => () => undefined
    });

    expect(spawn).toHaveBeenCalledWith('claude', [
      '--settings',
      '/tmp/session-1.json',
      '--resume',
      '--model',
      'sonnet'
    ]);
    expect(result.exitCode).toBe(0);
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
    expect(merged.hooks.SessionStart[0].hooks[0].command).toContain('SessionStart');
    expect(merged.hooks.Stop[1].hooks[0].command).toContain('Stop');
  });
});
