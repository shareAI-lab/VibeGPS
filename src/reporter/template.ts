export interface TurnSummary {
  turn: number;
  timestamp: number;
  added: number;
  removed: number;
  filesChanged: number;
  commitDetected: boolean;
  lastAssistantMessage: string;
  diffContent?: string;
  operations?: { tool: string; filePath: string }[];
}

export interface FileHeatmapEntry {
  file: string;
  totalChanges: number;
  isNew: boolean;
}

export interface DiffEntry {
  file: string;
  content: string;
}

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
  turnSummaries: TurnSummary[];
  fileHeatmap: FileHeatmapEntry[];
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderDiffHtml(content: string, maxLines = 200): string {
  const lines = content.split('\n');
  const truncated = lines.length > maxLines;
  const visible = truncated ? lines.slice(0, maxLines) : lines;
  const rendered = visible
    .map((line) => {
      const escaped = escapeHtml(line);
      if (line.startsWith('+') && !line.startsWith('+++')) {
        return `<span class="diff-add">${escaped}</span>`;
      }
      if (line.startsWith('-') && !line.startsWith('---')) {
        return `<span class="diff-remove">${escaped}</span>`;
      }
      if (line.startsWith('@@')) {
        return `<span class="diff-hunk">${escaped}</span>`;
      }
      return escaped;
    })
    .join('\n');
  if (truncated) {
    return `${rendered}\n<span class="diff-hunk">... ${lines.length - maxLines} more lines truncated ...</span>`;
  }
  return rendered;
}

function truncateMessage(msg: string, max = 80): string {
  if (msg.length <= max) return msg;
  return msg.slice(0, max) + '…';
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

export function buildReportHtml(data: ReportTemplateData): string {
  const risks = data.analysis.risks.length > 0 ? data.analysis.risks : ['无'];
  const highlights = data.analysis.highlights.length > 0 ? data.analysis.highlights : ['无'];

  const maxDelta = Math.max(
    ...data.turnSummaries.map((t) => Math.max(t.added, t.removed)),
    1
  );

  const maxHeat = Math.max(
    ...data.fileHeatmap.map((f) => f.totalChanges),
    1
  );

  // --- Turn Trend Chart ---
  const trendRows = data.turnSummaries
    .map(
      (t) => `
      <div class="trend-row">
        <span class="turn-label">#${t.turn}</span>
        <div class="bar-group">
          <div class="bar added" style="width:${pct(t.added, maxDelta)}%"></div>
          <div class="bar removed" style="width:${pct(t.removed, maxDelta)}%"></div>
        </div>
        <span class="delta-label"><span class="added">+${t.added}</span> <span class="removed">-${t.removed}</span></span>
      </div>`
    )
    .join('');

  // --- File Heatmap ---
  const heatmapRows = data.fileHeatmap
    .slice(0, 20)
    .map(
      (f) => `
      <div class="heatmap-row">
        <span class="file-name">${escapeHtml(f.file)}${f.isNew ? '<span class="badge new">new</span>' : ''}</span>
        <div class="heat-bar-container">
          <div class="heat-bar" style="width:${pct(f.totalChanges, maxHeat)}%"></div>
        </div>
        <span class="heat-label">${f.totalChanges}x</span>
      </div>`
    )
    .join('');

  // --- Timeline ---
  const timelineEntries = data.turnSummaries
    .map(
      (t) => {
        const editCount = t.operations?.filter((o) => o.tool === 'Edit').length ?? 0;
        const writeCount = t.operations?.filter((o) => o.tool === 'Write').length ?? 0;
        const opBadges = [
          editCount > 0 ? `<span class="badge edit">Edit ×${editCount}</span>` : '',
          writeCount > 0 ? `<span class="badge new">Write ×${writeCount}</span>` : ''
        ].filter(Boolean).join(' ');

        const diffSection = t.diffContent
          ? `<details class="turn-diff"><summary>查看本轮变更</summary><pre class="diff-content">${renderDiffHtml(t.diffContent, 300)}</pre></details>`
          : '';

        return `
      <div class="timeline-entry${t.commitDetected ? ' has-commit' : ''}">
        <div class="timeline-header">
          <span class="turn-num">#${t.turn}</span>
          <span class="muted">${formatTime(t.timestamp)}</span>
          <span class="added">+${t.added}</span>
          <span class="removed">-${t.removed}</span>
          <span class="muted">${t.filesChanged} files</span>
          ${t.commitDetected ? '<span class="badge commit">commit</span>' : ''}
          ${opBadges}
        </div>
        ${t.lastAssistantMessage ? `<p class="assistant-msg">${escapeHtml(truncateMessage(t.lastAssistantMessage))}</p>` : ''}
        ${diffSection}
      </div>`;
      }
    )
    .join('');

  // --- Diff Details (per-turn) ---
  const diffSections = data.turnSummaries
    .filter((t) => t.diffContent && t.diffContent.length > 0)
    .map(
      (t) => {
        const editCount = t.operations?.filter((o) => o.tool === 'Edit').length ?? 0;
        const writeCount = t.operations?.filter((o) => o.tool === 'Write').length ?? 0;
        const label = [`+${t.added}`, `-${t.removed}`, editCount > 0 ? `Edit×${editCount}` : '', writeCount > 0 ? `Write×${writeCount}` : ''].filter(Boolean).join(' ');
        return `
      <details>
        <summary>#${t.turn} — ${escapeHtml(label)}</summary>
        <pre class="diff-content">${renderDiffHtml(t.diffContent!)}</pre>
      </details>`;
      }
    )
    .join('');

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
      --accent: #58a6ff;
      --green: #3fb950;
      --red: #f85149;
      --orange: #d29922;
      --border: #30363d;
    }

    * { box-sizing: border-box; }

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
      padding: 0 16px 48px;
    }

    h1 { margin: 0 0 4px; }

    .card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
      margin-top: 16px;
    }

    .card h2 { margin: 0 0 8px; font-size: 16px; }

    .stats {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 8px;
      font-size: 18px;
      font-weight: bold;
    }

    .added { color: var(--green); }
    .removed { color: var(--red); }

    ul { margin: 8px 0 0; padding-left: 20px; }
    .muted { color: var(--text-secondary); }

    /* Turn Trend Chart */
    .trend-chart { display: flex; flex-direction: column; gap: 4px; }
    .trend-row { display: flex; align-items: center; gap: 8px; }
    .turn-label { width: 36px; text-align: right; color: var(--text-secondary); font-size: 12px; }
    .bar-group { display: flex; flex: 1; gap: 2px; height: 18px; }
    .bar { height: 100%; border-radius: 2px; min-width: 2px; transition: width 0.3s; }
    .bar.added { background: var(--green); }
    .bar.removed { background: var(--red); }
    .delta-label { width: 110px; text-align: right; font-size: 12px; }

    /* File Heatmap */
    .heatmap { display: flex; flex-direction: column; gap: 6px; }
    .heatmap-row { display: flex; align-items: center; gap: 8px; }
    .file-name { width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .heat-bar-container { flex: 1; height: 14px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden; }
    .heat-bar { height: 100%; background: var(--orange); border-radius: 3px; transition: width 0.3s; }
    .heat-label { width: 50px; text-align: right; font-size: 12px; color: var(--text-secondary); }
    .badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; margin-left: 4px; vertical-align: middle; }
    .badge.new { background: var(--accent); color: #0d1117; }
    .badge.commit { background: var(--orange); color: #0d1117; }
    .badge.edit { background: var(--green); color: #0d1117; }

    /* Timeline */
    .timeline { display: flex; flex-direction: column; gap: 0; }
    .timeline-entry { padding: 10px 12px; border-left: 3px solid var(--border); }
    .timeline-entry.has-commit { border-left-color: var(--orange); }
    .timeline-header { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 13px; }
    .turn-num { font-weight: bold; font-size: 14px; }
    .assistant-msg { margin: 4px 0 0; color: var(--text-secondary); font-size: 13px; font-style: italic; }
    .turn-diff { margin-top: 6px; }
    .turn-diff summary { font-size: 12px; padding: 2px 0; color: var(--text-secondary); }
    .turn-diff summary:hover { color: var(--accent); }

    /* Diff Details */
    details { margin-top: 6px; }
    summary { cursor: pointer; padding: 6px 0; font-weight: bold; font-size: 13px; }
    summary:hover { color: var(--accent); }
    .diff-content {
      background: var(--bg-tertiary);
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.4;
      white-space: pre;
      margin: 4px 0 0;
    }
    .diff-add { color: var(--green); }
    .diff-remove { color: var(--red); }
    .diff-hunk { color: var(--accent); }

    .footer { margin-top: 32px; text-align: center; color: var(--text-secondary); font-size: 12px; }

    @media (max-width: 640px) {
      .file-name { width: 140px; }
      .delta-label { width: 80px; }
      .stats { font-size: 15px; }
      .card { padding: 12px; }
    }
  </style>
</head>
<body>
  <main>
    <h1>🛰️ VibeGPS Report</h1>
    <p class="muted">Session: ${escapeHtml(data.sessionId)} | ${new Date(data.generatedAt).toLocaleString('zh-CN')} | Turns: ${data.totals.turns}</p>

    <section class="card">
      <h2>📊 变更概览</h2>
      <div class="stats">
        <span class="added">+${data.totals.added} 行增加</span>
        <span class="removed">-${data.totals.removed} 行删除</span>
        <span>${data.totals.files} 文件变更</span>
      </div>
      ${data.turnSummaries.length > 0 ? `<div class="trend-chart" style="margin-top:16px">${trendRows}</div>` : ''}
    </section>

    <section class="card">
      <h2>🤖 AI 分析</h2>
      <p><strong>摘要：</strong>${escapeHtml(data.analysis.summary)}</p>
      <p><strong>意图：</strong>${escapeHtml(data.analysis.intent)}</p>
      <p><strong>⚠️ 风险：</strong></p>
      <ul>${risks.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      <p><strong>✨ 亮点：</strong></p>
      <ul>${highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </section>

    ${data.fileHeatmap.length > 0 ? `
    <section class="card">
      <h2>📁 文件变更热力图</h2>
      <div class="heatmap">${heatmapRows}</div>
    </section>` : ''}

    ${diffSections.length > 0 ? `
    <section class="card">
      <h2>📜 Diff 详情（按轮次）</h2>
      ${diffSections}
    </section>` : ''}

    ${data.turnSummaries.length > 0 ? `
    <section class="card">
      <h2>🕐 Turn 时间线</h2>
      <div class="timeline">${timelineEntries}</div>
    </section>` : ''}

    <div class="footer">Generated by VibeGPS v0.1.3 | ${new Date(data.generatedAt).toLocaleString('zh-CN')}</div>
  </main>
</body>
</html>`;
}
