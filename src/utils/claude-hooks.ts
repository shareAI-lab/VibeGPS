import { existsSync } from "node:fs";
import { join } from "node:path";
import { MANAGED_HOOK_COMMAND } from "./codex-hooks";
import { readJson, writeJson } from "./json";
import type { WorkspacePaths } from "./workspace";

const STOP_EVENT = "Stop";

interface ClaudeHookCommand {
  type: "command";
  command: string;
}

interface ClaudeHookRule {
  matcher: string;
  hooks: ClaudeHookCommand[];
}

interface ClaudeHookEvents {
  Stop?: ClaudeHookRule[];
  [key: string]: ClaudeHookRule[] | undefined;
}

type ClaudeSettings = Record<string, unknown> & {
  hooks?: ClaudeHookEvents;
};

function isManagedHookRule(rule: ClaudeHookRule): boolean {
  return rule.hooks.some(
    (hook) => hook.type === "command" && hook.command.trim() === MANAGED_HOOK_COMMAND
  );
}

export function patchClaudeSettings(paths: WorkspacePaths): void {
  const settingsFile = join(paths.claudeDir, "settings.json");
  const existing: ClaudeSettings = existsSync(settingsFile)
    ? readJson<ClaudeSettings>(settingsFile)
    : {};

  const existingHooks: ClaudeHookEvents =
    existing.hooks && typeof existing.hooks === "object"
      ? existing.hooks
      : {};

  const stopRules: ClaudeHookRule[] = Array.isArray(existingHooks[STOP_EVENT])
    ? existingHooks[STOP_EVENT]
    : [];

  // Remove any existing managed VibeGPS rules to avoid duplicates
  const preservedRules = stopRules.filter((rule) => !isManagedHookRule(rule));

  const nextSettings: ClaudeSettings = {
    ...existing,
    hooks: {
      ...existingHooks,
      [STOP_EVENT]: [
        ...preservedRules,
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: MANAGED_HOOK_COMMAND,
            },
          ],
        },
      ],
    },
  };

  writeJson(settingsFile, nextSettings);
}

export function extractClaudeStopHookCommands(settings: unknown): string[] {
  if (!settings || typeof settings !== "object") {
    return [];
  }

  const hooks = (settings as ClaudeSettings).hooks;
  if (!hooks || typeof hooks !== "object") {
    return [];
  }

  const stopRules = hooks[STOP_EVENT];
  if (!Array.isArray(stopRules)) {
    return [];
  }

  return stopRules.flatMap((rule) => {
    if (!rule || typeof rule !== "object" || !Array.isArray(rule.hooks)) {
      return [];
    }
    return rule.hooks
      .filter(
        (hook) =>
          hook?.type === "command" && typeof hook.command === "string"
      )
      .map((hook) => hook.command);
  });
}

export function validateClaudeManagedHook(
  command: string | undefined
): boolean {
  return (
    typeof command === "string" &&
    command.trim() === MANAGED_HOOK_COMMAND
  );
}
