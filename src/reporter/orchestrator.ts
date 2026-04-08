import { runAnalyzer } from '../analyzer/agent-runner.js';
import { parseLLMResult } from '../analyzer/parser.js';
import { renderHtmlReport } from './html-renderer.js';
import { renderTerminalSummary } from './terminal-renderer.js';

export async function generateReport(input: {
  sessionId: string;
  reportRoot: string;
  analyzerConfig: {
    prefer: 'claude' | 'codex';
    timeout: number;
    enabled: boolean;
  };
  totals: {
    added: number;
    removed: number;
    files: number;
    turns: number;
  };
  files: string[];
  diff: string;
  lastAssistantMessage: string;
}) {
  const raw = await runAnalyzer(input.analyzerConfig, {
    stat: `+${input.totals.added} -${input.totals.removed}`,
    files: input.files,
    lastAssistantMessage: input.lastAssistantMessage,
    diff: input.diff
  });

  const parsed = raw ? parseLLMResult(raw) : null;
  const analysis =
    parsed ?? {
      summary: '静态报告模式：LLM 分析不可用',
      intent: '基于变更统计生成',
      risks: ['请人工复核关键模块'],
      highlights: ['已输出完整变更明细']
    };

  const reportPath = await renderHtmlReport(input.reportRoot, {
    sessionId: input.sessionId,
    generatedAt: Date.now(),
    totals: input.totals,
    analysis,
    timeline: []
  });

  const output = renderTerminalSummary({
    sessionId: input.sessionId,
    totals: input.totals,
    analysis,
    reportPath
  });

  return {
    sessionId: input.sessionId,
    output,
    reportPath
  };
}
