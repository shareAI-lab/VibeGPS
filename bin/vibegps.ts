#!/usr/bin/env node
import { createProgram } from '../src/cli/index.js';

async function main(): Promise<void> {
  const program = createProgram();
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[vibegps] fatal: ${message}`);
  process.exitCode = 1;
});
