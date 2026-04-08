import { describe, expect, it } from 'vitest';
import { renderTerminalSummary } from '../../src/reporter/terminal-renderer.js';

describe('terminal renderer', () => {
  it('renders compact summary without emoji', () => {
    const output = renderTerminalSummary({
      sessionId: 'abc123',
      totals: {
        added: 285,
        removed: 67,
        files: 12,
        turns: 8
      },
      analysis: {
        summary: '重构认证模块',
        intent: '职责分离',
        risks: ['auth.service.ts 体积偏大'],
        highlights: ['测试覆盖率提高']
      },
      reportPath: '/tmp/report.html'
    });

    expect(output).toContain('VibeGPS Report - Session abc123');
    expect(output).toContain('重构认证模块');
    expect(output).not.toContain('🛰️');
  });
});
