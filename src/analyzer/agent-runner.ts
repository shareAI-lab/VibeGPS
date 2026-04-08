import { execa } from 'execa';
import type { AnalyzerConfig } from '../types.js';

function truncateDiff(diff: string): string {
  if (diff.length <= 8000) {
    return diff;
  }
  return `${diff.slice(0, 8000)}\n...TRUNCATED...`;
}

function buildPrompt(input: {
  stat: string;
  files: string[];
  lastAssistantMessage: string;
  diff: string;
}): string {
  return [
    '分析以下代码变更，返回 JSON：',
    '{"summary":"一句话摘要","intent":"修改意图","risks":["风险点"],"highlights":["亮点"]}',
    `变更统计：${input.stat}`,
    `文件列表：${input.files.join(', ')}`,
    `最近 AI 回复：${input.lastAssistantMessage}`,
    'Diff 内容：',
    truncateDiff(input.diff)
  ].join('\n');
}

export async function runAnalyzer(
  config: AnalyzerConfig,
  input: {
    stat: string;
    files: string[];
    lastAssistantMessage: string;
    diff: string;
  },
  exec: (
    command: string,
    args: string[],
    options: { timeout: number }
  ) => Promise<{ stdout: string }> = (command, args, options) =>
    execa(command, args, options)
): Promise<string | null> {
  if (!config.enabled) {
    return null;
  }

  const command = config.prefer;
  const prompt = buildPrompt(input);
  const { stdout } = await exec(command, ['-p', prompt], {
    timeout: config.timeout
  });

  return stdout;
}
