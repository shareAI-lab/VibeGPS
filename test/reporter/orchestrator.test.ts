import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateReport } from '../../src/reporter/orchestrator.js';

describe('report orchestrator', () => {
  let root = '';

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = '';
    }
  });

  it('falls back to static analysis when analyzer fails', async () => {
    root = await mkdtemp(join(tmpdir(), 'vibegps-orchestrator-'));

    const result = await generateReport(
      {
        sessionId: 's1',
        reportRoot: root,
        analyzerConfig: { prefer: 'claude', timeout: 100, enabled: true },
        totals: { added: 4, removed: 0, files: 1, turns: 1 },
        files: ['README.md (changed)'],
        diff: 'diff --git a/README.md b/README.md\n+hello',
        lastAssistantMessage: '',
        turns: [
          {
            turn: 1,
            timestamp: Date.now(),
            headHash: 'abc123',
            commitDetected: false,
            delta: { added: 4, removed: 0 },
            cumulative: { added: 4, removed: 0 },
            filesChanged: ['README.md'],
            newFiles: [],
            diffContent: 'diff --git a/README.md b/README.md\n+hello',
            lastAssistantMessage: ''
          }
        ]
      },
      {
        runAnalyzerFn: vi.fn().mockRejectedValue(new Error('timeout'))
      }
    );

    const html = await readFile(result.reportPath, 'utf8');
    expect(result.output).toContain('静态报告模式');
    expect(result.compactOutput).toContain('+4');
    expect(result.compactOutput).toContain('[VibeGPS]');
    expect(result.compactOutput).not.toContain('\n');
    expect(html).toContain('静态报告模式');
    // Verify new sections are present
    expect(html).toContain('变更概览');
    expect(html).toContain('README.md');
  });

  it('passes multi-turn data through to HTML report', async () => {
    root = await mkdtemp(join(tmpdir(), 'vibegps-orchestrator-'));

    const result = await generateReport(
      {
        sessionId: 's-multi',
        reportRoot: root,
        analyzerConfig: { prefer: 'claude', timeout: 100, enabled: false },
        totals: { added: 30, removed: 5, files: 2, turns: 2 },
        files: ['src/a.ts (changed)', 'src/b.ts (new)'],
        diff: [
          'diff --git a/src/a.ts b/src/a.ts\n+line1',
          'diff --git a/src/b.ts b/src/b.ts\nnew file mode 100644\n+line2'
        ].join('\n'),
        lastAssistantMessage: '完成',
        turns: [
          {
            turn: 1,
            timestamp: 1712568000000,
            headHash: 'aaa',
            commitDetected: false,
            delta: { added: 20, removed: 5 },
            cumulative: { added: 20, removed: 5 },
            filesChanged: ['src/a.ts'],
            newFiles: [],
            diffContent: 'diff --git a/src/a.ts b/src/a.ts\n+line1',
            lastAssistantMessage: '第一轮修改'
          },
          {
            turn: 2,
            timestamp: 1712568600000,
            headHash: 'bbb',
            commitDetected: true,
            delta: { added: 10, removed: 0 },
            cumulative: { added: 10, removed: 0 },
            filesChanged: [],
            newFiles: ['src/b.ts'],
            diffContent: 'diff --git a/src/b.ts b/src/b.ts\nnew file mode 100644\n+line2',
            lastAssistantMessage: '完成'
          }
        ]
      },
      {
        runAnalyzerFn: vi.fn().mockResolvedValue(null)
      }
    );

    const html = await readFile(result.reportPath, 'utf8');
    // Trend chart with per-turn data
    expect(html).toContain('+20');
    expect(html).toContain('+10');
    // Heatmap
    expect(html).toContain('src/a.ts');
    expect(html).toContain('src/b.ts');
    // Timeline
    expect(html).toContain('Turn 时间线');
    expect(html).toContain('第一轮修改');
    // Diff details
    expect(html).toContain('<details>');
  });
});
