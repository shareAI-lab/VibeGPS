import type { AnalyzerConfig } from '../types.js';
import { ANTHROPIC_API_URL, DEFAULT_API_MODEL } from '../constants.js';
import https from 'node:https';
import { execa } from 'execa';

function sanitizeForTerminal(input: string, maxLength = 240): string {
  const noAnsi = input.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
  const printable = noAnsi
    .replace(/[^\x09\x0a\x0d\x20-\x7e\u4e00-\u9fff。，、；：？！【】（）《》“”‘’·…—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (printable.length <= maxLength) {
    return printable;
  }
  return `${printable.slice(0, maxLength)}...`;
}

function truncateDiff(diff: string): string {
  if (diff.length <= 8000) {
    return diff;
  }
  return `${diff.slice(0, 8000)}\n...TRUNCATED...`;
}

function stripNullBytes(input: string): string {
  return input.replace(/\0/g, '');
}

function buildPrompt(input: {
  stat: string;
  files: string[];
  lastAssistantMessage: string;
  diff: string;
  userPrompt?: string;
}): string {
  const safeFiles = input.files.map((file) => stripNullBytes(file));
  const safeAssistantMessage = stripNullBytes(input.lastAssistantMessage);
  const safeDiff = truncateDiff(stripNullBytes(input.diff));
  const safeUserPrompt = input.userPrompt ? stripNullBytes(input.userPrompt) : '';
  const userPromptSection = safeUserPrompt
    ? `\n用户要求：${safeUserPrompt}\n请重点分析：代码修改是否符合用户意图？有无遗漏/偏离？风险点？`
    : '';
  const jsonSchema = safeUserPrompt
    ? '{"summary":"一句话摘要","intent":"修改意图","risks":["风险点"],"highlights":["亮点"],"intentMatch":"full|partial|deviated"}'
    : '{"summary":"一句话摘要","intent":"修改意图","risks":["风险点"],"highlights":["亮点"]}';
  return [
    '分析以下代码变更，返回纯 JSON（不要 markdown 代码块标记）：',
    jsonSchema,
    `变更统计：${input.stat}`,
    `文件列表：${safeFiles.join(', ')}`,
    `最近 AI 回复：${safeAssistantMessage}`,
    userPromptSection,
    'Diff 内容：',
    safeDiff
  ].join('\n');
}

function resolveApiKey(config: AnalyzerConfig): string | null {
  if (config.apiKey) {
    return config.apiKey;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  return null;
}

interface ApiCallParams {
  apiKey: string;
  model: string;
  prompt: string;
  timeout: number;
  apiUrl: string;
}

export async function callAnthropicApi(params: ApiCallParams): Promise<string> {
  const body = JSON.stringify({
    model: params.model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: params.prompt }]
  });

  return await new Promise<string>((resolve, reject) => {
    const url = new URL(params.apiUrl);
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'x-api-key': params.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data) as {
                content: Array<{ type: string; text: string }>;
              };
              const text = parsed.content?.[0]?.text;
              if (text) {
                resolve(text);
              } else {
                reject(new Error(`unexpected API response: ${data.slice(0, 200)}`));
              }
            } catch {
              reject(new Error(`failed to parse API response: ${data.slice(0, 200)}`));
            }
          } else {
            reject(new Error(`API ${res.statusCode}: ${data.slice(0, 300)}`));
          }
        });
      }
    );

    req.setTimeout(params.timeout, () => {
      req.destroy(new Error(`API request timed out after ${params.timeout}ms`));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function callClaudeCli(prompt: string, timeout: number): Promise<string> {
  const result = await execa('claude', ['-p', prompt], {
    timeout,
    reject: false
  });

  if (result.failed || !result.stdout) {
    throw new Error(`claude CLI 失败: ${result.stderr || 'no output'}`);
  }

  return result.stdout.trim();
}

export async function callCodexExec(prompt: string, timeout: number): Promise<string> {
  const result = await execa('codex', [
    'exec', '--json', '--sandbox', 'read-only', prompt
  ], { timeout, reject: false });

  if (result.failed || !result.stdout) {
    throw new Error(`codex exec failed: ${sanitizeForTerminal(result.stderr || 'no output')}`);
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      text?: string;
      content?: string;
      message?: string;
    };
    return parsed.text ?? parsed.content ?? parsed.message ?? result.stdout;
  } catch {
    return result.stdout;
  }
}

async function tryClaude(
  config: AnalyzerConfig,
  prompt: string,
  apiCall: (params: ApiCallParams) => Promise<string>,
  cliCall: (prompt: string, timeout: number) => Promise<string>
): Promise<string> {
  // Prefer API when key is available (avoids conflict with wrapped Claude Code process)
  const apiKey = resolveApiKey(config);
  if (apiKey) {
    try {
      const model = config.model ?? DEFAULT_API_MODEL;
      return await apiCall({
        apiKey,
        model,
        prompt,
        timeout: config.timeout,
        apiUrl: ANTHROPIC_API_URL
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[VibeGPS] API 分析失败: ${sanitizeForTerminal(msg)}\n`);
    }
  }
  // Fallback to CLI
  try {
    return await cliCall(prompt, config.timeout);
  } catch {
    if (!apiKey) {
      throw new Error('Claude API key 未配置，且 Claude CLI 不可用（可能正被 VibeGPS 包装的进程占用）。请设置 ANTHROPIC_API_KEY 或在 config.json 中配置 analyzer.apiKey');
    }
    throw new Error('Claude API 和 CLI 均不可用');
  }
}

export async function runAnalyzer(
  config: AnalyzerConfig,
  input: {
    stat: string;
    files: string[];
    lastAssistantMessage: string;
    diff: string;
    userPrompt?: string;
  },
  apiCall: (params: ApiCallParams) => Promise<string> = callAnthropicApi,
  claudeCliCall: (prompt: string, timeout: number) => Promise<string> = callClaudeCli,
  codexCall: (prompt: string, timeout: number) => Promise<string> = callCodexExec,
  options?: {
    disableCodexCli?: boolean;
  }
): Promise<string | null> {
  if (!config.enabled) {
    return null;
  }

  const prompt = buildPrompt(input);

  // Build ordered analyzer list based on preference
  const disableCodexCli = options?.disableCodexCli ?? false;
  const analyzers: Array<{ name: string; fn: () => Promise<string> }> = [];

  if (config.prefer === 'codex' && !disableCodexCli) {
    analyzers.push({ name: 'Codex', fn: () => codexCall(prompt, config.timeout) });
  }
  analyzers.push({ name: 'Claude', fn: () => tryClaude(config, prompt, apiCall, claudeCliCall) });
  if (config.prefer !== 'codex' && !disableCodexCli) {
    analyzers.push({ name: 'Codex', fn: () => codexCall(prompt, config.timeout) });
  }

  for (const { name, fn } of analyzers) {
    try {
      return await fn();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[VibeGPS] ${name} 分析失败: ${sanitizeForTerminal(msg)}\n`);
    }
  }

  return null;
}
