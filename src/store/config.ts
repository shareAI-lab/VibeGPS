import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../constants.js';
import type { VibegpsConfig } from '../types.js';

function mergeConfig(partial: Partial<VibegpsConfig>): VibegpsConfig {
  return {
    report: {
      ...DEFAULT_CONFIG.report,
      ...partial.report
    },
    analyzer: {
      ...DEFAULT_CONFIG.analyzer,
      ...partial.analyzer
    }
  };
}

export async function loadConfig(root: string): Promise<VibegpsConfig> {
  await mkdir(root, { recursive: true });
  const file = join(root, 'config.json');

  let partial: Partial<VibegpsConfig> = {};
  try {
    const raw = await readFile(file, 'utf8');
    partial = JSON.parse(raw) as Partial<VibegpsConfig>;
  } catch {
    partial = {};
  }

  const merged = mergeConfig(partial);
  await writeFile(file, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}
