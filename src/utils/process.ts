import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export function bindSignals(cleanup: () => Promise<void>): () => void {
  const handler = async (): Promise<void> => {
    await cleanup();
    process.exit(0);
  };

  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
  process.on('SIGHUP', handler);

  return () => {
    process.off('SIGINT', handler);
    process.off('SIGTERM', handler);
    process.off('SIGHUP', handler);
  };
}

export async function waitForExit(
  child: { kill: (signal: NodeJS.Signals) => void; exited: Promise<void> },
  timeoutMs: number
): Promise<void> {
  const timer = new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
  await Promise.race([child.exited, timer]);
}

export async function cleanStaleSettings(
  dir: string,
  isAlive: (pid: number) => boolean
): Promise<void> {
  let files: string[] = [];

  try {
    files = await readdir(dir);
  } catch {
    return;
  }

  for (const file of files) {
    const match = file.match(/^session-(\d+)\.json$/);
    if (!match) {
      continue;
    }

    const pid = Number(match[1]);
    if (!isAlive(pid)) {
      await rm(join(dir, file), { force: true });
    }
  }
}

export async function cleanExpiredSessions(root: string, retentionDays: number): Promise<void> {
  const threshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(root, entry);
    const info = await stat(path);
    if (info.mtimeMs < threshold) {
      await rm(path, { recursive: true, force: true });
    }
  }
}
