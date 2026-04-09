import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { collectGitSnapshot } from '../../src/utils/git.js';
import { Buffer } from 'node:buffer';

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
      expect(snapshot.cumulative.added).toBeGreaterThanOrEqual(2);
      expect(snapshot.diffContent).toContain('+world');
      expect(snapshot.diffContent).toContain('+++ b/new.txt');
      expect(snapshot.diffContent).toContain('+new');
      expect(snapshot.newFiles).toContain('new.txt');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores temporary .codex/hooks.json from snapshot stats and diff', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vibegps-git-ignore-'));

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
      await mkdir(join(dir, '.codex'), { recursive: true });
      await writeFile(join(dir, '.codex', 'hooks.json'), '{"hooks":{}}\n', 'utf8');

      const snapshot = await collectGitSnapshot(dir);

      expect(snapshot.diffContent).toContain('+++ b/new.txt');
      expect(snapshot.diffContent).not.toContain('+++ b/.codex/hooks.json');
      expect(snapshot.newFiles).toContain('new.txt');
      expect(snapshot.newFiles).not.toContain('.codex/hooks.json');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores __pycache__ and pyc binary files in snapshot diff', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vibegps-git-pyc-'));

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

      await mkdir(join(dir, 'calculator', '__pycache__'), { recursive: true });
      await writeFile(
        join(dir, 'calculator', '__pycache__', 'calculator.cpython-312.pyc'),
        Buffer.from([0, 1, 2, 3, 4, 5])
      );
      await writeFile(join(dir, 'new.txt'), 'new\n', 'utf8');

      const snapshot = await collectGitSnapshot(dir);

      expect(snapshot.newFiles).toContain('new.txt');
      expect(snapshot.newFiles.some((f) => f.endsWith('.pyc'))).toBe(false);
      expect(snapshot.diffContent).toContain('+++ b/new.txt');
      expect(snapshot.diffContent).not.toContain('__pycache__');
      expect(snapshot.diffContent.includes('\0')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('excludes staged pyc changes from git diff snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vibegps-git-pyc-staged-'));

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

      await mkdir(join(dir, 'calculator', '__pycache__'), { recursive: true });
      await writeFile(
        join(dir, 'calculator', '__pycache__', 'calculator.cpython-312.pyc'),
        Buffer.from([0, 1, 2, 3, 4, 5, 6])
      );
      await execa('git', ['add', '.'], { cwd: dir });

      const snapshot = await collectGitSnapshot(dir);
      expect(snapshot.diffContent).not.toContain('__pycache__');
      expect(snapshot.diffContent).not.toContain('.pyc');
      expect(snapshot.diffContent.includes('\0')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
