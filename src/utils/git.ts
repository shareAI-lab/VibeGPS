import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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

const TRANSIENT_EXCLUDED_FILES = new Set(['.codex/hooks.json']);
const TRANSIENT_EXCLUDED_GLOBS = ['**/__pycache__/**', '**/*.pyc'];

function normalizeGitPath(file: string): string {
  return file.replaceAll('\\', '/').replace(/^\.\/+/, '');
}

function shouldExcludeFile(file: string): boolean {
  const normalized = normalizeGitPath(file);
  if (TRANSIENT_EXCLUDED_FILES.has(normalized)) {
    return true;
  }
  if (normalized.includes('/__pycache__/') || normalized.endsWith('.pyc')) {
    return true;
  }
  return false;
}

function withExcludePathspec(args: string[]): string[] {
  const excludes = [
    ...[...TRANSIENT_EXCLUDED_FILES].map((file) => `:(exclude)${file}`),
    ...TRANSIENT_EXCLUDED_GLOBS.map((pattern) => `:(exclude,glob)${pattern}`)
  ];
  return [...args, '--', '.', ...excludes];
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
    if (!file || shouldExcludeFile(file)) {
      continue;
    }
    const parsedA = Number(a);
    const parsedR = Number(r);
    added += Number.isFinite(parsedA) ? parsedA : 0;
    removed += Number.isFinite(parsedR) ? parsedR : 0;
    filesChanged.push(file);
  }

  return {
    added,
    removed,
    filesChanged
  };
}

function splitContentLines(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function buildNewFileDiff(file: string, raw: string): string {
  const lines = splitContentLines(raw);
  const lineCount = lines.length;

  return [
    `diff --git a/${file} b/${file}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${file}`,
    `@@ -0,0 +1,${lineCount} @@`,
    ...lines.map((line) => `+${line}`)
  ].join('\n');
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.includes(0);
}

async function collectUntrackedStats(cwd: string, newFiles: string[]): Promise<{
  added: number;
  diffContent: string;
}> {
  let added = 0;
  const diffChunks: string[] = [];

  for (const file of newFiles) {
    try {
      const raw = await readFile(join(cwd, file));
      if (isBinaryBuffer(raw)) {
        continue;
      }
      const text = raw.toString('utf8');
      const lines = splitContentLines(text);
      added += lines.length;
      diffChunks.push(buildNewFileDiff(file, text));
    } catch {
      // 非文本文件或读取失败时跳过行数统计，不阻断主流程。
    }
  }

  return {
    added,
    diffContent: diffChunks.join('\n')
  };
}

export async function collectGitSnapshot(cwd: string): Promise<GitSnapshot> {
  const [{ stdout: headHash }, { stdout: numstat }, { stdout: diffContent }, { stdout: newFilesRaw }] = await Promise.all([
    execa('git', ['rev-parse', 'HEAD'], { cwd }),
    execa('git', withExcludePathspec(['diff', '--numstat', 'HEAD']), { cwd }),
    execa('git', withExcludePathspec(['diff', 'HEAD']), { cwd }),
    execa('git', ['ls-files', '--others', '--exclude-standard'], { cwd })
  ]);

  const parsed = parseNumstat(numstat);
  const newFiles = newFilesRaw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !shouldExcludeFile(line));
  const untracked = await collectUntrackedStats(cwd, newFiles);
  const mergedDiff = [diffContent, untracked.diffContent].filter(Boolean).join('\n');

  return {
    headHash: headHash.trim(),
    cumulative: {
      added: parsed.added + untracked.added,
      removed: parsed.removed
    },
    filesChanged: parsed.filesChanged,
    newFiles,
    diffContent: mergedDiff
  };
}
