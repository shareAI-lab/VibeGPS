import type { AnalyzerConfig } from '../types.js';
import { ANTHROPIC_API_URL, DEFAULT_API_MODEL } from '../constants.js';
import https from 'node:https';
import { execa } from 'execa';

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
    '分析以下代码变更，返回纯 JSON（不要 markdown 代码块标记）：',
    '{"summary":"一句话摘要","intent":"修改意图","risks":["风险点"],"highlights":["亮点"]}',
    `变更统计：${input.stat}`,
    `文件列表：${input.files.join(', ')}`,
    `最近 AI 回复：${input.lastAssistantMessage}`,
    'Diff 内容：',
    truncateDiff(input.diff)
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
    throw new Error(`codex exec failed: ${result.stderr || 'no output'}`);
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
  const apiKey = resolveApiKey(config);
  if (apiKey) {
    const model = config.model ?? DEFAULT_API_MODEL;
    return await apiCall({
      apiKey,
      model,
      prompt,
      timeout: config.timeout,
      apiUrl: ANTHROPIC_API_URL
    });
  }

  process.stderr.write('[VibeGPS] 未配置 ANTHROPIC_API_KEY，使用 Claude CLI 分析\n');
  return await cliCall(prompt, config.timeout);
}

export async function runAnalyzer(
  config: AnalyzerConfig,
  input: {
    stat: string;
    files: string[];
    lastAssistantMessage: string;
    diff: string;
  },
  apiCall: (params: ApiCallParams) => Promise<string> = callAnthropicApi,
  claudeCliCall: (prompt: string, timeout: number) => Promise<string> = callClaudeCli,
  codexCall: (prompt: string, timeout: number) => Promise<string> = callCodexExec
): Promise<string | null> {
  if (!config.enabled) {
    return null;
  }

  const prompt = buildPrompt(input);

  // Build ordered analyzer list based on preference
  const analyzers: Array<{ name: string; fn: () => Promise<string> }> =
    config.prefer === 'codex'
      ? [
          { name: 'Codex', fn: () => codexCall(prompt, config.timeout) },
          { name: 'Claude', fn: () => tryClaude(config, prompt, apiCall, claudeCliCall) }
        ]
      : [
          { name: 'Claude', fn: () => tryClaude(config, prompt, apiCall, claudeCliCall) },
          { name: 'Codex', fn: () => codexCall(prompt, config.timeout) }
        ];

  for (const { name, fn } of analyzers) {
    try {
      return await fn();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[VibeGPS] ${name} 分析失败: ${msg}\n`);
    }
  }

  return null;
}
