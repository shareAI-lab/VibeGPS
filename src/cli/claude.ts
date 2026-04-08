import { launchWrappedAgent } from '../wrapper/launcher.js';

export async function runClaudeCommand(
  args: string[],
  deps: {
    launch: (input: { agent: 'claude'; userArgs: string[] }) => Promise<{ exitCode: number }>;
  } = {
    launch: launchWrappedAgent
  }
): Promise<number> {
  const result = await deps.launch({
    agent: 'claude',
    userArgs: args
  });

  return result.exitCode;
}
