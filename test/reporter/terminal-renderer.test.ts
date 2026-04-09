import { describe, expect, it } from 'vitest';
import { renderCompactNotification, renderTerminalSummary } from '../../src/reporter/terminal-renderer.js';

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

describe('compact notification', () => {
  it('renders single-line notification with key info', () => {
    const output = renderCompactNotification({
      sessionId: 'abc123',
      totals: { added: 285, removed: 67, files: 12, turns: 8 },
      analysis: { summary: '重构认证模块' },
      reportPath: '/tmp/report.html'
    });

    expect(output).not.toContain('\n');
    expect(output).toContain('+285');
    expect(output).toContain('-67');
    expect(output).toContain('12 files');
    expect(output).toContain('8 turns');
    expect(output).toContain('重构认证模块');
    expect(output).toContain('file:///tmp/report.html');
  });

  it('truncates long summary to 40 characters', () => {
    const longSummary = '这是一个非常长的摘要文本用来测试截断功能是否正常工作应该被截断';
    const output = renderCompactNotification({
      sessionId: 's1',
      totals: { added: 10, removed: 5, files: 2, turns: 1 },
      analysis: { summary: longSummary },
      reportPath: '/tmp/r.html'
    });

    const summaryInOutput = output.split(' | ')[3];
    expect(summaryInOutput.length).toBeLessThanOrEqual(40);
  });

  it('handles empty summary', () => {
    const output = renderCompactNotification({
      sessionId: 's2',
      totals: { added: 0, removed: 0, files: 0, turns: 0 },
      analysis: { summary: '' },
      reportPath: '/tmp/r.html'
    });

    expect(output).toContain('[VibeGPS]');
    expect(output).toContain('file://');
  });
});
