import { Command } from 'commander';
import { runClaudeCommand } from './claude.js';
import { runCodexCommand } from './codex.js';
import { defaultReportDeps, runReportCommand } from './report.js';

export function createProgram(): Command {
  const program = new Command();

  program.name('vibegps').description('Code evolution navigator for AI agent sessions');

  program
    .command('claude [args...]')
    .allowUnknownOption(true)
    .description('Wrapper launch Claude Code')
    .action(async (args: string[] = []) => {
      await runClaudeCommand(args);
    });

  program
    .command('codex [args...]')
    .allowUnknownOption(true)
    .description('Wrapper launch Codex CLI')
    .action(async (args: string[] = []) => {
      await runCodexCommand(args);
    });

  program
    .command('report')
    .description('Generate report for a session')
    .option('--session <id>', 'session id')
    .action(async (options: { session?: string }) => {
      const output = await runReportCommand(
        {
          sessionId: options.session
        },
        defaultReportDeps
      );
      process.stdout.write(`${output}\n`);
    });

  return program;
}
