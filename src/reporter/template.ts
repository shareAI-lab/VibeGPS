export interface ReportTemplateData {
  sessionId: string;
  generatedAt: number;
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
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildReportHtml(data: ReportTemplateData): string {
  const risks = data.analysis.risks.length > 0 ? data.analysis.risks : ['无'];
  const highlights = data.analysis.highlights.length > 0 ? data.analysis.highlights : ['无'];

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VibeGPS Report</title>
  <style>
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --green: #3fb950;
      --red: #f85149;
      --border: #30363d;
    }

    body {
      margin: 0;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      line-height: 1.5;
    }

    main {
      max-width: 1080px;
      margin: 24px auto;
      padding: 0 16px 24px;
    }

    .card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      margin-top: 16px;
    }

    .stats {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .added {
      color: var(--green);
    }

    .removed {
      color: var(--red);
    }

    ul {
      margin: 8px 0 0;
      padding-left: 20px;
    }

    .muted {
      color: var(--text-secondary);
    }
  </style>
</head>
<body>
  <main>
    <h1>VibeGPS Report</h1>
    <p class="muted">Session: ${escapeHtml(data.sessionId)} | Generated: ${new Date(data.generatedAt).toLocaleString('zh-CN')}</p>

    <section class="card">
      <h2>变更概览</h2>
      <div class="stats">
        <span class="added">+${data.totals.added}</span>
        <span class="removed">-${data.totals.removed}</span>
        <span>${data.totals.files} files</span>
        <span>${data.totals.turns} turns</span>
      </div>
    </section>

    <section class="card">
      <h2>AI 分析</h2>
      <p><strong>摘要：</strong>${escapeHtml(data.analysis.summary)}</p>
      <p><strong>意图：</strong>${escapeHtml(data.analysis.intent)}</p>
      <p><strong>风险：</strong></p>
      <ul>${risks.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      <p><strong>亮点：</strong></p>
      <ul>${highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </section>
  </main>
</body>
</html>`;
}
