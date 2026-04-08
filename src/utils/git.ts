import { execa } from 'execa';

export interface GitSnapshot {
  headHash: string;
  cumulative: {
    added: number;
    removed: number;
  };
  filesChanged: string[];
  newFiles: string[];
  diffContent: string;
}

function parseNumstat(raw: string): {
  added: number;
  removed: number;
  filesChanged: string[];
} {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let added = 0;
  let removed = 0;
  const filesChanged: string[] = [];

  for (const line of lines) {
    const [a, r, file] = line.split('\t');
    const parsedA = Number(a);
    const parsedR = Number(r);
    added += Number.isFinite(parsedA) ? parsedA : 0;
    removed += Number.isFinite(parsedR) ? parsedR : 0;
    if (file) {
      filesChanged.push(file);
    }
  }

  return {
    added,
    removed,
    filesChanged
  };
}

export async function collectGitSnapshot(cwd: string): Promise<GitSnapshot> {
  const [{ stdout: headHash }, { stdout: numstat }, { stdout: diffContent }, { stdout: newFilesRaw }] = await Promise.all([
    execa('git', ['rev-parse', 'HEAD'], { cwd }),
    execa('git', ['diff', '--numstat', 'HEAD'], { cwd }),
    execa('git', ['diff', 'HEAD'], { cwd }),
    execa('git', ['ls-files', '--others', '--exclude-standard'], { cwd })
  ]);

  const parsed = parseNumstat(numstat);

  return {
    headHash: headHash.trim(),
    cumulative: {
      added: parsed.added,
      removed: parsed.removed
    },
    filesChanged: parsed.filesChanged,
    newFiles: newFilesRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    diffContent
  };
}
