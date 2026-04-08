import { describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, '../../bin/vibegps.ts');

describe('CLI bootstrap', () => {
  it('prints help with zero exit code', async () => {
    const { stdout, exitCode } = await execa('node', ['--import', 'tsx', entry, '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('vibegps');
    expect(stdout).toContain('claude');
    expect(stdout).toContain('codex');
    expect(stdout).toContain('report');
  });
});
