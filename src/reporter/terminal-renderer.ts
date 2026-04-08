export function renderTerminalSummary(input: {
  sessionId: string;
  totals: {
    added: number;
    removed: number;
    files: number;
    turns: number;
  };
  analysis: {
    summary: string;
    intent: string;
    risks: string[];
    highlights: string[];
  };
  reportPath: string;
}): string {
  return [
    `VibeGPS Report - Session ${input.sessionId}`,
    `变更: +${input.totals.added} -${input.totals.removed} | ${input.totals.files} 文件 | ${input.totals.turns} 轮`,
    `摘要: ${input.analysis.summary}`,
    `风险: ${input.analysis.risks[0] ?? '无'}`,
    `亮点: ${input.analysis.highlights[0] ?? '无'}`,
    `报告: file://${input.reportPath}`
  ].join('\n');
}
