import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/store/config.js';

describe('config store', () => {
  let root = '';

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('creates default config when missing', async () => {
    root = await mkdtemp(join(tmpdir(), 'vibegps-config-'));
    const config = await loadConfig(root);

    expect(config.report.threshold).toBe(200);
    expect(config.analyzer.prefer).toBe('claude');
  });

  it('merges partial config with defaults', async () => {
    root = await mkdtemp(join(tmpdir(), 'vibegps-config-'));
    await writeFile(join(root, 'config.json'), JSON.stringify({ report: { threshold: 320 } }), 'utf8');

    const config = await loadConfig(root);

    expect(config.report.threshold).toBe(320);
    expect(config.report.minTurnsBetween).toBe(3);
    expect(config.analyzer.enabled).toBe(true);
  });

  it('writes normalized config to disk', async () => {
    root = await mkdtemp(join(tmpdir(), 'vibegps-config-'));
    await loadConfig(root);

    const raw = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
    expect(raw.report.autoOpen).toBe(true);
  });
});
