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

function createHookRule(port: number, event: 'SessionStart' | 'Stop'): HookRule {
  return {
    matcher: '*',
    hooks: [
      {
        type: 'command',
        command: `node scripts/vibegps-forwarder.cjs ${port} ${event}`
      }
    ]
  };
}

export function buildMergedSettings(userSettings: Settings, port: number): Settings {
  const hooks: Record<string, HookRule[]> = { ...(userSettings.hooks ?? {}) };
  hooks.SessionStart = [...(hooks.SessionStart ?? []), createHookRule(port, 'SessionStart')];
  hooks.Stop = [...(hooks.Stop ?? []), createHookRule(port, 'Stop')];

  return {
    ...userSettings,
    hooks
  };
}
