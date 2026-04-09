import { describe, expect, it, vi } from 'vitest';
import { createSessionTracker } from '../../src/wrapper/session-tracker.js';

describe('session tracker', () => {
  it('computes delta from previous cumulative', async () => {
    const collectGitSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 0, removed: 0 },
        filesChanged: [],
        newFiles: [],
        diffContent: ''
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 80, removed: 20 },
        filesChanged: ['a.ts'],
        newFiles: [],
        diffContent: 'd1'
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 130, removed: 35 },
        filesChanged: ['a.ts'],
        newFiles: [],
        diffContent: 'd2'
      });

    const tracker = createSessionTracker({
      collectGitSnapshot,
      threshold: 200,
      minTurnsBetween: 3,
      onAutoReport: vi.fn()
    });

    await tracker.onSessionStart({ session_id: 's1', cwd: '/tmp/app' });
    const turn1 = await tracker.onStop({
      session_id: 's1',
      cwd: '/tmp/app',
      last_assistant_message: 'm1'
    });
    const turn2 = await tracker.onStop({
      session_id: 's1',
      cwd: '/tmp/app',
      last_assistant_message: 'm2'
    });

    expect(turn1.delta).toEqual({ added: 80, removed: 20 });
    expect(turn2.delta).toEqual({ added: 50, removed: 15 });
  });

  it('marks commitDetected and resets baseline when head changes', async () => {
    const collectGitSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 0, removed: 0 },
        filesChanged: [],
        newFiles: [],
        diffContent: ''
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 80, removed: 20 },
        filesChanged: ['a.ts'],
        newFiles: [],
        diffContent: 'd1'
      })
      .mockResolvedValueOnce({
        headHash: 'def',
        cumulative: { added: 30, removed: 5 },
        filesChanged: ['b.ts'],
        newFiles: [],
        diffContent: 'd2'
      });

    const tracker = createSessionTracker({
      collectGitSnapshot,
      threshold: 200,
      minTurnsBetween: 3,
      onAutoReport: vi.fn()
    });

    await tracker.onSessionStart({ session_id: 's2', cwd: '/tmp/app' });
    await tracker.onStop({
      session_id: 's2',
      cwd: '/tmp/app',
      last_assistant_message: 'm1'
    });
    const turn2 = await tracker.onStop({
      session_id: 's2',
      cwd: '/tmp/app',
      last_assistant_message: 'm2'
    });

    expect(turn2.commitDetected).toBe(true);
    expect(turn2.delta).toEqual({ added: 30, removed: 5 });
  });

  it('triggers auto report when threshold and interval are satisfied', async () => {
    const collectGitSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 0, removed: 0 },
        filesChanged: [],
        newFiles: [],
        diffContent: ''
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 110, removed: 30 },
        filesChanged: ['a.ts'],
        newFiles: [],
        diffContent: 'd1'
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 150, removed: 70 },
        filesChanged: ['b.ts'],
        newFiles: [],
        diffContent: 'd2'
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 190, removed: 90 },
        filesChanged: ['c.ts'],
        newFiles: [],
        diffContent: 'd3'
      });

    const onAutoReport = vi.fn().mockResolvedValue(undefined);
    const tracker = createSessionTracker({
      collectGitSnapshot,
      threshold: 200,
      minTurnsBetween: 2,
      onAutoReport
    });

    await tracker.onSessionStart({ session_id: 's3', cwd: '/tmp/app' });
    await tracker.onStop({ session_id: 's3', cwd: '/tmp/app' });
    await tracker.onStop({ session_id: 's3', cwd: '/tmp/app' });
    await tracker.onStop({ session_id: 's3', cwd: '/tmp/app' });

    expect(onAutoReport).toHaveBeenCalledTimes(1);
    expect(onAutoReport).toHaveBeenCalledWith('s3');
  });

  it('triggers auto report on first stop when threshold is already reached', async () => {
    const collectGitSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 0, removed: 0 },
        filesChanged: [],
        newFiles: [],
        diffContent: ''
      })
      .mockResolvedValueOnce({
        headHash: 'abc',
        cumulative: { added: 210, removed: 20 },
        filesChanged: ['a.ts'],
        newFiles: [],
        diffContent: 'd1'
      });

    const onAutoReport = vi.fn().mockResolvedValue(undefined);
    const tracker = createSessionTracker({
      collectGitSnapshot,
      threshold: 200,
      minTurnsBetween: 3,
      onAutoReport
    });

    await tracker.onSessionStart({ session_id: 's4', cwd: '/tmp/app' });
    await tracker.onStop({ session_id: 's4', cwd: '/tmp/app' });

    expect(onAutoReport).toHaveBeenCalledTimes(1);
    expect(onAutoReport).toHaveBeenCalledWith('s4');
  });
});
