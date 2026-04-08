import { describe, expect, it, vi } from 'vitest';
import { runAnalyzer } from '../../src/analyzer/agent-runner.js';

describe('agent runner', () => {
  it('calls preferred cli with prompt and timeout', async () => {
    const exec = vi
      .fn()
      .mockResolvedValue({ stdout: '{"summary":"ok","intent":"x","risks":[],"highlights":[]}' });

    const raw = await runAnalyzer(
      { prefer: 'claude', timeout: 30000, enabled: true },
      {
        stat: '+100 -20',
        files: ['src/a.ts (+20-5)'],
        lastAssistantMessage: 'done',
        diff: 'diff text'
      },
      exec
    );

    expect(exec).toHaveBeenCalledWith(
      'claude',
      ['-p', expect.stringContaining('返回 JSON')],
      { timeout: 30000 }
    );
    expect(raw).toContain('summary');
  });

  it('returns null when analyzer disabled', async () => {
    const exec = vi.fn();
    const raw = await runAnalyzer(
      { prefer: 'claude', timeout: 30000, enabled: false },
      {
        stat: '+100 -20',
        files: ['src/a.ts (+20-5)'],
        lastAssistantMessage: 'done',
        diff: 'diff text'
      },
      exec
    );

    expect(raw).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });
});
