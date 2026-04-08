import { Command } from 'commander';

export function createProgram(): Command {
  const program = new Command();
  program.name('vibegps').description('Code evolution navigator for AI agent sessions');
  program.command('claude').description('Wrapper launch Claude Code');
  program.command('codex').description('Wrapper launch Codex CLI');
  program.command('report').description('Generate report for a session');
  return program;
}
