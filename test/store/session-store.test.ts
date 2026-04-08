import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendTurn, createSession } from '../../src/store/session-store.js';

describe('session store', () => {
  it('writes meta and turn files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegps-store-'));

    try {
      await createSession(root, {
        sessionId: 's1',
        cwd: '/tmp/app',
        baselineHead: 'abc'
      });

      await appendTurn(root, 's1', {
        turn: 1,
        timestamp: 1712568000,
        headHash: 'abc',
        commitDetected: false,
        delta: { added: 10, removed: 2 },
        cumulative: { added: 10, removed: 2 },
        filesChanged: ['src/a.ts'],
        newFiles: [],
        diffContent: 'diff --git ...',
        lastAssistantMessage: 'ok'
      });

      const meta = JSON.parse(await readFile(join(root, 's1', 'meta.json'), 'utf8'));
      expect(meta.turnCount).toBe(1);
      expect(meta.totalAdded).toBe(10);
      expect(meta.totalRemoved).toBe(2);

      const turnFile = JSON.parse(await readFile(join(root, 's1', 'turns', 'turn-001.json'), 'utf8'));
      expect(turnFile.turn).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
