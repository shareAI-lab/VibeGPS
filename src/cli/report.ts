import { orchestrateReportFromStore } from '../reporter/orchestrator.js';
import { openInBrowser } from '../utils/open.js';

export async function runReportCommand(
  options: { sessionId?: string },
  deps: {
    orchestrate: (sessionId?: string) => Promise<{
      sessionId: string;
      output: string;
      compactOutput: string;
      reportPath: string;
    }>;
    open: (path: string) => Promise<void>;
  }
): Promise<string> {
  const result = await deps.orchestrate(options.sessionId);
  await deps.open(result.reportPath);
  return result.output;
}

export const defaultReportDeps = {
  orchestrate: orchestrateReportFromStore,
  open: openInBrowser
};
