import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type HookCommand = {
  type: 'command';
  command: string;
};

type HookRule = {
  matcher: string;
  hooks: HookCommand[];
};

type Settings = {
  hooks?: Record<string, HookRule[]>;
  [key: string]: unknown;
};

type HooksConfig = {
  hooks?: Record<string, HookRule[]>;
  [key: string]: unknown;
};

function resolveForwarderScriptPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDir, '../../scripts/vibegps-forwarder.cjs'),
    resolve(moduleDir, '../scripts/vibegps-forwarder.cjs')
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return 'scripts/vibegps-forwarder.cjs';
}

const FORWARDER_SCRIPT = resolveForwarderScriptPath();

function createHookRule(
  port: number,
  event: 'SessionStart' | 'Stop' | 'UserPromptSubmit' | 'PostToolUse'
): HookRule {
  return {
    matcher: '*',
    hooks: [
      {
        type: 'command',
        // Use a resolved path so hooks still work when Claude runs from user project directories.
        command: `node ${JSON.stringify(FORWARDER_SCRIPT)} ${port} ${event}`
      }
    ]
  };
}

function buildBaseHooks(hooksConfig: HooksConfig, port: number): Record<string, HookRule[]> {
  const hooks: Record<string, HookRule[]> = { ...(hooksConfig.hooks ?? {}) };
  hooks.SessionStart = [...(hooks.SessionStart ?? []), createHookRule(port, 'SessionStart')];
  hooks.Stop = [...(hooks.Stop ?? []), createHookRule(port, 'Stop')];
  hooks.UserPromptSubmit = [
    ...(hooks.UserPromptSubmit ?? []),
    createHookRule(port, 'UserPromptSubmit')
  ];
  return hooks;
}

export function buildMergedSettings(userSettings: Settings, port: number): Settings {
  const hooks = buildBaseHooks(userSettings, port);
  // Claude Code 支持 PostToolUse
  hooks.PostToolUse = [
    ...(hooks.PostToolUse ?? []),
    createHookRule(port, 'PostToolUse')
  ];
  return {
    ...userSettings,
    hooks
  };
}

export function buildMergedCodexHooks(userHooksFile: HooksConfig, port: number): HooksConfig {
  const hooks = buildBaseHooks(userHooksFile, port);
  // Codex 原生 hooks 使用 PostToolUse。
  hooks.PostToolUse = [
    ...(hooks.PostToolUse ?? []),
    createHookRule(port, 'PostToolUse')
  ];
  return {
    ...userHooksFile,
    hooks
  };
}
