import { describe, expect, it } from 'vitest';
import { buildMergedCodexHooks, buildMergedSettings } from '../../src/wrapper/settings-merger.js';

describe('settings merger', () => {
  it('keeps existing hooks and appends vibegps hooks', () => {
    const merged = buildMergedSettings(
      {
        hooks: {
          Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo old' }] }]
        }
      },
      3456
    );

    expect(merged.hooks?.Stop).toHaveLength(2);
    const command = merged.hooks?.SessionStart?.[0]?.hooks?.[0]?.command ?? '';
    expect(command).toContain('vibegps-forwarder.cjs');
    expect(command).toContain('3456 SessionStart');
    expect(command).not.toContain('node scripts/vibegps-forwarder.cjs');
    expect(merged.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toContain(
      'UserPromptSubmit'
    );
  });

  it('merges codex hooks file while preserving existing entries', () => {
    const merged = buildMergedCodexHooks(
      {
        hooks: {
          SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo startup' }] }]
        }
      },
      7788
    );

    expect(merged.hooks?.SessionStart).toHaveLength(2);
    expect(merged.hooks?.Stop).toHaveLength(1);
    expect(merged.hooks?.UserPromptSubmit).toHaveLength(1);
    expect(merged.hooks?.PostToolUse).toHaveLength(1);
    expect(merged.hooks?.Stop?.[0]?.hooks?.[0]?.command).toContain('7788 Stop');
    expect(merged.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toContain('7788 PostToolUse');
  });
});
