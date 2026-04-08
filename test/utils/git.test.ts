import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { collectGitSnapshot } from '../../src/utils/git.js';

describe('git collector', () => {
  it('collects stat, diff, new files and head', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vibegps-git-'));

    try {
      await execa('git', ['init'], { cwd: dir });
      await writeFile(join(dir, 'a.txt'), 'hello\n', 'utf8');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'init'], {
        cwd: dir,
        env: {
          GIT_AUTHOR_NAME: 'Bill Billion',
          GIT_AUTHOR_EMAIL: 'bill@example.com',
          GIT_COMMITTER_NAME: 'Bill Billion',
          GIT_COMMITTER_EMAIL: 'bill@example.com'
        }
      });
      await writeFile(join(dir, 'a.txt'), 'hello\nworld\n', 'utf8');
      await writeFile(join(dir, 'new.txt'), 'new\n', 'utf8');

      const snapshot = await collectGitSnapshot(dir);

      expect(snapshot.headHash.length).toBeGreaterThan(6);
      expect(snapshot.cumulative.added).toBeGreaterThan(0);
      expect(snapshot.diffContent).toContain('+world');
      expect(snapshot.newFiles).toContain('new.txt');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
