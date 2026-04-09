import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { SESSIONS_DIR, TMP_HOOK_DIR, VIBEGPS_HOME } from '../constants.js';
import { openDatabase } from '../store/database.js';
import { loadConfig } from '../store/config.js';
import { collectGitSnapshot } from '../utils/git.js';
import {
  bindSignals as defaultBindSignals,
  cleanExpiredSessions,
  cleanStaleSettings
} from '../utils/process.js';
import { createHookServer as defaultCreateHookServer } from './hook-server.js';
import { createRuntime } from './runtime.js';
import { buildMergedCodexHooks, buildMergedSettings } from './settings-merger.js';

type SpawnFn = (
  command: string,
  args: string[]
) => Promise<{ exitCode: number; kill?: (signal: NodeJS.Signals) => void; exited?: Promise<void> }>;

type HookServerFactory = (
  onEvent: (event: {
    event: 'SessionStart' | 'Stop' | 'UserPromptSubmit' | 'PostToolUse';
    payload: Record<string, unknown>;
  }) => Promise<{ systemMessage?: string } | void>
) => Promise<{ port: number; close: () => Promise<void> }>;

type RuntimeFactory = (options?: {
  db?: import('better-sqlite3').Database;
  agent?: 'claude' | 'codex';
  vibegpsHome?: string;
  reportsDir?: string;
  openReport?: (path: string) => Promise<void>;
  notify?: (message: string) => void;
  notifyMode?: 'verbose' | 'quiet';
  onReportGenerated?: (reportPath: string) => void;
}) => Promise<{
  handleHook: (event: {
    event: 'SessionStart' | 'Stop' | 'UserPromptSubmit' | 'PostToolUse';
    payload: Record<string, unknown>;
  }) => Promise<{ systemMessage?: string } | void>;
}>;

type MountedNotifier = (message: string) => void;
type HookEvent = {
  event: 'SessionStart' | 'Stop' | 'UserPromptSubmit' | 'PostToolUse';
  payload: Record<string, unknown>;
};

type SnapshotCollector = (
  cwd: string
) => Promise<{ cumulative: { added: number; removed: number } }>;

type CodexHooksFileFactory = (
  input: { cwd: string; hookPort: number }
) => Promise<{ enabled: boolean; cleanup: () => Promise<void> }>;

function isSameCumulative(
  left: { added: number; removed: number } | null,
  right: { added: number; removed: number } | null
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.added === right.added && left.removed === right.removed;
}

function extractSessionRef(payload: Record<string, unknown>): {
  sessionId: string;
  cwd: string;
  turnId: string | null;
} | null {
  const sessionId = payload.session_id;
  const cwd = payload.cwd;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return null;
  }
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return null;
  }
  const turnId =
    typeof payload.turn_id === 'string' && payload.turn_id.length > 0 ? payload.turn_id : null;
  return { sessionId, cwd, turnId };
}

async function waitMs(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function safeRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function resolveAgentCwd(args: string[]): string {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === '--cd' || arg === '-C') && i + 1 < args.length) {
      return args[i + 1];
    }
  }
  return process.cwd();
}

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

export async function createTempCodexHooksFile(input: {
  cwd: string;
  hookPort: number;
}): Promise<{ enabled: boolean; cleanup: () => Promise<void> }> {
  const hooksDir = join(input.cwd, '.codex');
  const hooksPath = join(hooksDir, 'hooks.json');

  const originalRaw = await safeRead(hooksPath);
  let parsed: Record<string, unknown> = {};
  if (originalRaw) {
    try {
      parsed = JSON.parse(originalRaw) as Record<string, unknown>;
    } catch {
      throw new Error(
        `[VibeGPS] 检测到无效 hooks 文件: ${hooksPath}，请先修复 JSON 后再启用 Codex 原生 hooks`
      );
    }
  }

  const merged = buildMergedCodexHooks(parsed, input.hookPort);
  const mergedRaw = JSON.stringify(merged, null, 2);

  await mkdir(hooksDir, { recursive: true });
  await writeFile(hooksPath, mergedRaw, 'utf8');

  const cleanup = async (): Promise<void> => {
    const current = await safeRead(hooksPath);
    if (current !== mergedRaw) {
      return;
    }

    if (originalRaw === null) {
      await rm(hooksPath, { force: true });
      try {
        await rm(hooksDir);
      } catch {
        // 目录非空时不删除，避免误删用户文件。
      }
      return;
    }

    await writeFile(hooksPath, originalRaw, 'utf8');
  };

  return {
    enabled: true,
    cleanup
  };
}

export async function launchWrappedAgent(deps: {
  agent: 'claude' | 'codex';
  userArgs: string[];
  spawn?: SpawnFn;
  createHookServer?: HookServerFactory;
  createRuntime?: RuntimeFactory;
  createTempSettings?: (port: number) => Promise<string>;
  cleanupTempSettings?: (settingsPath: string) => Promise<void>;
  bindSignals?: (cleanup: () => Promise<void>) => () => void;
  notifyMounted?: MountedNotifier;
  stopHookGraceMs?: number;
  reportThreshold?: number;
  collectSnapshot?: SnapshotCollector;
  codexTurnPollMs?: number;
  codexTurnQuietMs?: number;
  codexNativeHookGraceMs?: number;
  createCodexHooksFile?: CodexHooksFileFactory;
}): Promise<{ exitCode: number }> {
  const spawn =
    deps.spawn ??
    (async (command, args) =>
      execa(command, args, {
        stdio: 'inherit',
        reject: false
      }));
  const createRuntimeFactory = deps.createRuntime ?? createRuntime;
  const createHookServer = deps.createHookServer ?? defaultCreateHookServer;
  const createTempSettings = deps.createTempSettings ?? ((port) => createTempSettingsFile({ hookPort: port }));
  const cleanupTempSettings = deps.cleanupTempSettings ?? cleanupTempSettingsFile;
  const bindSignals = deps.bindSignals ?? defaultBindSignals;
  const stopHookGraceMs = Math.max(0, deps.stopHookGraceMs ?? 1200);
  const collectSnapshot = deps.collectSnapshot ?? collectGitSnapshot;
  const codexTurnPollMs = Math.max(0, deps.codexTurnPollMs ?? 1500);
  const codexTurnQuietMs = Math.max(0, deps.codexTurnQuietMs ?? 2500);
  const codexNativeHookGraceMs = Math.max(0, deps.codexNativeHookGraceMs ?? 2000);
  const createCodexHooksFile = deps.createCodexHooksFile ?? createTempCodexHooksFile;
  const notifyMounted =
    deps.notifyMounted ??
    ((message) => {
      process.stderr.write(`${message}\n`);
    });

  // Open database
  const dbPath = join(VIBEGPS_HOME, 'vibegps.db');
  const db = openDatabase(dbPath);

  // Load config for banner threshold display
  let reportThreshold = deps.reportThreshold ?? 200;
  if (deps.reportThreshold === undefined) {
    try {
      const config = await loadConfig(VIBEGPS_HOME);
      reportThreshold = config.report.threshold;
    } catch {
      // use default
    }
  }

  // Fire-and-forget cleanup of stale temp files and expired sessions
  const isAlive = (pid: number): boolean => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  try { await cleanStaleSettings(TMP_HOOK_DIR, isAlive); } catch { /* ignore */ }
  try { await cleanExpiredSessions(SESSIONS_DIR, 30); } catch { /* ignore */ }

  if (deps.agent === 'codex') {
    const runtime = await createRuntimeFactory({
      db,
      agent: 'codex',
      notifyMode: 'quiet',
      onReportGenerated: (reportPath: string) => {
        notifyMounted(`[VibeGPS] 报告已生成: ${reportPath}`);
      }
    });
    const cwd = resolveAgentCwd(deps.userArgs);
    let nativeSessionRef: { sessionId: string; cwd: string; turnId: string | null } | null = null;
    let nativeStopCount = 0;
    let nativeEventSeen = false;

    const onHookEvent = async (event: HookEvent): Promise<{ systemMessage?: string } | void> => {
      nativeEventSeen = true;
      const ref = extractSessionRef(event.payload);
      if (ref) {
        nativeSessionRef = ref;
      }
      if (event.event === 'Stop') {
        nativeStopCount += 1;
      }
      return runtime.handleHook(event);
    };
    const hookServer = await createHookServer(onHookEvent);

    let codexHooksCleanup: (() => Promise<void>) | null = null;
    let nativeHooksEnabled = false;
    try {
      const codexHooks = await createCodexHooksFile({
        cwd,
        hookPort: hookServer.port
      });
      nativeHooksEnabled = codexHooks.enabled;
      codexHooksCleanup = codexHooks.cleanup;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notifyMounted(`${message}，已降级为轮询兜底模式`);
      nativeHooksEnabled = false;
    }

    notifyMounted(`[VibeGPS] 导航已启动 | 报告阈值: ${reportThreshold} 行 | 手动: vibegps report`);
    if (nativeHooksEnabled) {
      notifyMounted('[VibeGPS] Codex 原生 hooks 已启用');
    } else {
      notifyMounted('[VibeGPS] Codex 原生 hooks 不可用，已启用轮询兜底');
    }

    const fallbackSessionId = `codex-fallback-${Date.now()}-${process.pid}`;
    let fallbackStarted = false;
    let fallbackStopCount = 0;
    let fallbackMonitorBusy = false;
    let fallbackLastChangeAt = Date.now();
    let fallbackLastObserved: { added: number; removed: number } | null = null;
    let fallbackLastEmitted: { added: number; removed: number } | null = null;
    const launchAt = Date.now();

    const ensureFallbackSessionStart = async (): Promise<void> => {
      if (fallbackStarted) {
        return;
      }
      await runtime.handleHook({
        event: 'SessionStart',
        payload: {
          session_id: fallbackSessionId,
          cwd
        }
      });
      fallbackStarted = true;

      try {
        const snapshot = await collectSnapshot(cwd);
        fallbackLastObserved = snapshot.cumulative;
        fallbackLastEmitted = snapshot.cumulative;
      } catch {
        // 非 git 仓库或采集失败场景，按空快照继续，不阻断流程。
      }
    };

    const resolvePolledSessionRef = (): {
      sessionId: string;
      cwd: string;
      useFallbackSession: boolean;
    } => {
      // 设计意图：仅在“完全收不到原生会话上下文”时才启用 fallback 会话；
      // 如果已拿到 native session_id/cwd，则轮询 stop 直接回写到 native 会话，避免阈值和手动 report 状态分裂。
      if (!fallbackStarted && nativeSessionRef) {
        return {
          sessionId: nativeSessionRef.sessionId,
          cwd: nativeSessionRef.cwd,
          useFallbackSession: false
        };
      }
      return {
        sessionId: fallbackSessionId,
        cwd,
        useFallbackSession: true
      };
    };

    const emitFallbackStop = async (
      force: boolean,
      sessionRefInput?: { sessionId: string; cwd: string; useFallbackSession: boolean }
    ): Promise<void> => {
      const sessionRef = sessionRefInput ?? resolvePolledSessionRef();
      if (sessionRef.useFallbackSession) {
        await ensureFallbackSessionStart();
        if (!fallbackStarted) {
          return;
        }
      }

      try {
        const snapshot = await collectSnapshot(sessionRef.cwd);
        fallbackLastObserved = snapshot.cumulative;
      } catch {
        // 采集失败时不阻断 stop，沿用已有状态。
      }

      const hasUncaptured = !isSameCumulative(fallbackLastObserved, fallbackLastEmitted);
      if (!hasUncaptured) {
        if (!force) {
          return;
        }
        if (fallbackStopCount > 0) {
          return;
        }
      }

      await runtime.handleHook({
        event: 'Stop',
        payload: {
          session_id: sessionRef.sessionId,
          cwd: sessionRef.cwd,
          turn_id: nativeSessionRef?.turnId ?? undefined,
          last_assistant_message: ''
        }
      });
      fallbackStopCount += 1;
      fallbackLastEmitted = fallbackLastObserved;
    };

    let fallbackMonitor: NodeJS.Timeout | null = null;
    if (codexTurnPollMs > 0) {
      // 设计意图：原生 hooks 失效时，使用“代码变更 + 静默窗口”近似单轮收敛。
      fallbackMonitor = setInterval(() => {
        if (fallbackMonitorBusy) {
          return;
        }
        fallbackMonitorBusy = true;
        void (async () => {
          try {
            // 原生 Stop 一旦稳定到达，就不需要轮询兜底。
            if (nativeStopCount > 0 && !fallbackStarted) {
              return;
            }
            if (nativeHooksEnabled && Date.now() - launchAt < codexNativeHookGraceMs) {
              return;
            }

            const sessionRef = resolvePolledSessionRef();
            if (sessionRef.useFallbackSession) {
              await ensureFallbackSessionStart();
            }
            const snapshot = await collectSnapshot(sessionRef.cwd);
            const current = snapshot.cumulative;

            if (!isSameCumulative(current, fallbackLastObserved)) {
              fallbackLastObserved = current;
              fallbackLastChangeAt = Date.now();
              return;
            }

            const quietMs = Date.now() - fallbackLastChangeAt;
            if (!isSameCumulative(current, fallbackLastEmitted) && quietMs >= codexTurnQuietMs) {
              await emitFallbackStop(false, sessionRef);
            }
          } catch {
            // 兜底监控失败不阻断主流程。
          } finally {
            fallbackMonitorBusy = false;
          }
        })();
      }, codexTurnPollMs);
    }

    const cleanup = async (): Promise<void> => {
      if (fallbackMonitor) {
        clearInterval(fallbackMonitor);
        fallbackMonitor = null;
      }

      if (nativeStopCount === 0) {
        const stopCountBefore = fallbackStopCount;
        await emitFallbackStop(true);
        if (nativeEventSeen && fallbackStopCount > stopCountBefore) {
          notifyMounted('[VibeGPS] 未收到 Codex Stop Hook，已执行轮询兜底会话收敛');
        }
      }

      await hookServer.close();
      if (codexHooksCleanup) {
        await codexHooksCleanup();
      }
      db.close();
    };

    const unbind = bindSignals(cleanup) ?? (() => undefined);
    const codexArgs = nativeHooksEnabled
      ? ['-c', 'features.codex_hooks=true', ...deps.userArgs]
      : deps.userArgs;

    try {
      const result = await spawn(deps.agent, codexArgs);
      await cleanup();
      return {
        exitCode: typeof result.exitCode === 'number' ? result.exitCode : 0
      };
    } finally {
      unbind();
    }
  }

  const runtime = await createRuntimeFactory({ db, agent: 'claude', notifyMode: 'verbose' });
  let lastSessionRef: { sessionId: string; cwd: string; turnId: string | null } | null = null;
  let stopCount = 0;
  const onHookEvent = async (event: HookEvent): Promise<{ systemMessage?: string } | void> => {
    const ref = extractSessionRef(event.payload);
    if (ref) {
      lastSessionRef = ref;
    }
    if (event.event === 'Stop') {
      stopCount += 1;
    }
    return runtime.handleHook(event);
  };
  const hookServer = await createHookServer(onHookEvent);
  const settingsPath = await createTempSettings(hookServer.port);
  notifyMounted(`[VibeGPS] 导航已启动 | 报告阈值: ${reportThreshold} 行 | 手动: vibegps report`);

  const ensureStopHook = async (force: boolean): Promise<void> => {
    if (!force && stopCount === 0) {
      await waitMs(stopHookGraceMs);
    }

    if (stopCount > 0 || !lastSessionRef) {
      return;
    }

    await runtime.handleHook({
      event: 'Stop',
      payload: {
        session_id: lastSessionRef.sessionId,
        cwd: lastSessionRef.cwd,
        turn_id: lastSessionRef.turnId ?? undefined,
        last_assistant_message: ''
      }
    });
    stopCount = 1;
    notifyMounted('[VibeGPS] 未收到 Stop Hook，已执行兜底会话收敛');
  };

  const cleanup = async (): Promise<void> => {
    await ensureStopHook(true);
    await hookServer.close();
    await cleanupTempSettings(settingsPath);
    db.close();
  };

  const unbind = bindSignals(cleanup) ?? (() => undefined);

  try {
    const result = await spawn(deps.agent, ['--settings', settingsPath, ...deps.userArgs]);
    await ensureStopHook(false);
    await cleanup();
    return {
      exitCode: typeof result.exitCode === 'number' ? result.exitCode : 0
    };
  } finally {
    unbind();
  }
}
