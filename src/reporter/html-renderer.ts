import { mkdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildReportHtml, type ReportTemplateData } from './template.js';

export async function renderHtmlReport(
  reportsRoot: string,
  data: ReportTemplateData
): Promise<string> {
  const dir = join(reportsRoot, data.sessionId);
  await mkdir(dir, { recursive: true });

  const filename = `report-${Date.now()}.html`;
  const reportPath = join(dir, filename);
  const html = buildReportHtml(data);

  await writeFile(reportPath, html, 'utf8');

  const latest = join(dir, 'latest.html');
  try {
    await unlink(latest);
  } catch {
    // ignore
  }
  await symlink(reportPath, latest);

  return reportPath;
}
