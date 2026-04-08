import { mkdtemp, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanExpiredSessions, cleanStaleSettings } from '../../src/utils/process.js';

describe('process cleanup', () => {
  it('removes stale temp settings for dead pid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vibegps-stale-'));
    const stale = join(dir, 'session-999999.json');

    await writeFile(stale, '{}', 'utf8');
    await cleanStaleSettings(dir, () => false);

    await expect(stat(stale)).rejects.toBeDefined();
  });

  it('removes expired sessions older than retention days', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegps-expired-'));
    const oldSession = join(root, 'session-old');
    const newSession = join(root, 'session-new');

    await writeFile(oldSession, 'old', 'utf8');
    await writeFile(newSession, 'new', 'utf8');

    const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await utimes(oldSession, oldTime, oldTime);

    await cleanExpiredSessions(root, 1);

    await expect(stat(oldSession)).rejects.toBeDefined();
    await expect(stat(newSession)).resolves.toBeDefined();
  });
});
