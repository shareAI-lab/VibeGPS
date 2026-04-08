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
      timeline: []
    });

    const html = await readFile(path, 'utf8');
    expect(html).toContain('VibeGPS Report');
    expect(html).toContain('285');

    const latest = join(root, 's1', 'latest.html');
    expect((await lstat(latest)).isSymbolicLink()).toBe(true);
  });
});
