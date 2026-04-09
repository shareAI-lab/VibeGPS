import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderHtmlReport } from '../../src/reporter/html-renderer.js';

describe('html renderer', () => {
  let root = '';

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = '';
    }
  });

  it('writes report and updates latest alias', async () => {
    root = await mkdtemp(join(tmpdir(), 'vibegps-report-'));
    const path = await renderHtmlReport(root, {
      sessionId: 's1',
      generatedAt: 1712569000,
      totals: { added: 285, removed: 67, files: 12, turns: 8 },
      analysis: {
        summary: '摘要',
        intent: '意图',
        risks: ['r1'],
        highlights: ['h1']
      },
      turnSummaries: [
        {
          turn: 1,
          timestamp: 1712568000,
          added: 120,
          removed: 30,
          filesChanged: 3,
          commitDetected: false,
          lastAssistantMessage: '重构了认证模块',
          diffContent: 'diff --git a/src/auth.ts b/src/auth.ts\n--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1,2 +1,3 @@\n import { jwt } from "./jwt"\n+export function login() {}\n',
          operations: [{ tool: 'Edit', filePath: 'src/auth.ts' }]
        },
        {
          turn: 2,
          timestamp: 1712568600,
          added: 165,
          removed: 37,
          filesChanged: 5,
          commitDetected: true,
          lastAssistantMessage: '添加了测试用例'
        }
      ],
      fileHeatmap: [
        { file: 'src/auth.ts', totalChanges: 2, isNew: false },
        { file: 'src/test.ts', totalChanges: 1, isNew: true }
      ]
    });

    const html = await readFile(path, 'utf8');
    expect(html).toContain('VibeGPS Report');
    expect(html).toContain('285');

    // Trend chart
    expect(html).toContain('变更概览');
    expect(html).toContain('+120');
    expect(html).toContain('-30');

    // Heatmap
    expect(html).toContain('文件变更热力图');
    expect(html).toContain('src/auth.ts');
    expect(html).toContain('src/test.ts');

    // Timeline
    expect(html).toContain('Turn 时间线');
    expect(html).toContain('重构了认证模块');
    expect(html).toContain('添加了测试用例');

    // Diff details (per-turn)
    expect(html).toContain('Diff 详情（按轮次）');
    expect(html).toContain('<details>');
    expect(html).toContain('diff-add');
    expect(html).toContain('Edit ×1');

    // Symlink
    const latest = join(root, 's1', 'latest.html');
    expect((await lstat(latest)).isSymbolicLink()).toBe(true);
  });

  it('renders gracefully with empty turn data', async () => {
    root = await mkdtemp(join(tmpdir(), 'vibegps-report-'));
    const path = await renderHtmlReport(root, {
      sessionId: 's-empty',
      generatedAt: 1712569000,
      totals: { added: 0, removed: 0, files: 0, turns: 0 },
      analysis: {
        summary: '无变更',
        intent: '无',
        risks: [],
        highlights: []
      },
      turnSummaries: [],
      fileHeatmap: []
    });

    const html = await readFile(path, 'utf8');
    expect(html).toContain('VibeGPS Report');
    expect(html).toContain('变更概览');
    // No heatmap/diff/timeline sections when data is empty
    expect(html).not.toContain('文件变更热力图');
    expect(html).not.toContain('Diff 详情（按轮次）');
    expect(html).not.toContain('Turn 时间线');
  });
});
