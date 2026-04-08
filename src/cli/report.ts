import { openInBrowser } from '../utils/open.js';

export async function runReportCommand(
  options: { sessionId?: string },
  deps: {
    orchestrate: (sessionId?: string) => Promise<{
      sessionId: string;
      output: string;
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
  orchestrate: async () => {
    throw new Error('report orchestrator is not wired yet');
  },
  open: openInBrowser
};
