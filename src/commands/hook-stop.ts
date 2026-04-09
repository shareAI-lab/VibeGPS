import { Command } from "commander";
import { runStopHook } from "../services/hook-stop";

export function registerHookStopCommand(program: Command): void {
  program
    .command("hook-stop")
    .description("Internal Stop hook entrypoint for Codex and Claude Code")
    .action(async () => {
      const output = await runStopHook(process.cwd());
      process.stdout.write(
        JSON.stringify({
          continue: output.continue,
          systemMessage: output.systemMessage,
        })
      );
    });
}
