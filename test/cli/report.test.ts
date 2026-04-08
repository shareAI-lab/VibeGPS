import { describe, expect, it, vi } from 'vitest';
import { runReportCommand } from '../../src/cli/report.js';

describe('report command', () => {
  it('generates report for latest session and auto opens', async () => {
    const orchestrate = vi.fn().mockResolvedValue({
      sessionId: 'abc123',
      output: 'VibeGPS Report - Session abc123',
      reportPath: '/tmp/report.html'
    });
    const open = vi.fn().mockResolvedValue(undefined);

    const result = await runReportCommand({ sessionId: undefined }, { orchestrate, open });

    expect(orchestrate).toHaveBeenCalledWith(undefined);
    expect(open).toHaveBeenCalledWith('/tmp/report.html');
    expect(result).toContain('abc123');
  });
});
