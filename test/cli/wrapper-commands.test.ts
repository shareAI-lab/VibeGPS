import { describe, expect, it, vi } from 'vitest';
import { runClaudeCommand } from '../../src/cli/claude.js';
import { runCodexCommand } from '../../src/cli/codex.js';

describe('wrapper commands', () => {
  it('passes all args to claude launcher', async () => {
    const launch = vi.fn().mockResolvedValue({ exitCode: 0 });

    await runClaudeCommand(['--resume', '--model', 'sonnet'], { launch });

    expect(launch).toHaveBeenCalledWith({
      agent: 'claude',
      userArgs: ['--resume', '--model', 'sonnet']
    });
  });

  it('passes all args to codex launcher', async () => {
    const launch = vi.fn().mockResolvedValue({ exitCode: 0 });

    await runCodexCommand(['--profile', 'fast'], { launch });

    expect(launch).toHaveBeenCalledWith({
      agent: 'codex',
      userArgs: ['--profile', 'fast']
    });
  });
});
