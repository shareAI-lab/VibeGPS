import { launchWrappedAgent } from '../wrapper/launcher.js';

export async function runCodexCommand(
  args: string[],
  deps: {
    launch: (input: { agent: 'codex'; userArgs: string[] }) => Promise<{ exitCode: number }>;
  } = {
    launch: launchWrappedAgent
  }
): Promise<number> {
  const result = await deps.launch({
    agent: 'codex',
    userArgs: args
  });

  return result.exitCode;
}
