import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { TMP_HOOK_DIR } from '../constants.js';
import { bindSignals as defaultBindSignals } from '../utils/process.js';
import { createHookServer as defaultCreateHookServer } from './hook-server.js';
import { buildMergedSettings } from './settings-merger.js';

type SpawnFn = (
  command: string,
  args: string[]
) => Promise<{ exitCode: number; kill?: (signal: NodeJS.Signals) => void; exited?: Promise<void> }>;

type HookServerFactory = (
  onEvent: (event: { event: 'SessionStart' | 'Stop'; payload: Record<string, unknown> }) => Promise<void>
) => Promise<{ port: number; close: () => Promise<void> }>;

export async function createTempSettingsFile(input: {
  hookPort: number;
  userSettingsPath?: string;
  tmpDir?: string;
  pid?: number;
}): Promise<string> {
  const userSettingsPath = input.userSettingsPath ?? join(homedir(), '.claude', 'settings.json');
  const tmpDir = input.tmpDir ?? TMP_HOOK_DIR;
  const pid = input.pid ?? process.pid;

  let userSettings: Record<string, unknown> = {};
  try {
    const raw = await readFile(userSettingsPath, 'utf8');
    userSettings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    userSettings = {};
  }

  const merged = buildMergedSettings(userSettings, input.hookPort);

  await mkdir(tmpDir, { recursive: true });
  const settingsPath = join(tmpDir, `session-${pid}.json`);
  await writeFile(settingsPath, JSON.stringify(merged, null, 2), 'utf8');

  return settingsPath;
}

export async function cleanupTempSettingsFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

export async function launchWrappedAgent(deps: {
  agent: 'claude' | 'codex';
  userArgs: string[];
  spawn?: SpawnFn;
  createHookServer?: HookServerFactory;
  createTempSettings?: (port: number) => Promise<string>;
  cleanupTempSettings?: (settingsPath: string) => Promise<void>;
  bindSignals?: (cleanup: () => Promise<void>) => () => void;
}): Promise<{ exitCode: number }> {
  const spawn =
    deps.spawn ??
    (async (command, args) =>
      execa(command, args, {
        stdio: 'inherit'
      }));
  const createHookServer = deps.createHookServer ?? defaultCreateHookServer;
  const createTempSettings = deps.createTempSettings ?? ((port) => createTempSettingsFile({ hookPort: port }));
  const cleanupTempSettings = deps.cleanupTempSettings ?? cleanupTempSettingsFile;
  const bindSignals = deps.bindSignals ?? defaultBindSignals;

  const hookServer = await createHookServer(async () => undefined);
  const settingsPath = await createTempSettings(hookServer.port);

  const cleanup = async (): Promise<void> => {
    await hookServer.close();
    await cleanupTempSettings(settingsPath);
  };

  const unbind = bindSignals(cleanup) ?? (() => undefined);

  try {
    const result = await spawn(deps.agent, ['--settings', settingsPath, ...deps.userArgs]);
    await cleanup();
    return {
      exitCode: typeof result.exitCode === 'number' ? result.exitCode : 0
    };
  } finally {
    unbind();
  }
}
