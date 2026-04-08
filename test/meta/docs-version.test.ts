import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('metadata and docs', () => {
  it('keeps author as Bill Billion', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    expect(pkg.author).toBe('Bill Billion');
  });

  it('contains changelog entry for current version', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    const changelog = await readFile('docs/CHANGELOG.md', 'utf8');
    expect(changelog).toContain(pkg.version);
  });
});
