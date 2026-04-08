import { describe, expect, it } from 'vitest';
import { buildMergedSettings } from '../../src/wrapper/settings-merger.js';

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
    expect(merged.hooks?.SessionStart?.[0]?.hooks?.[0]?.command).toContain('vibegps-forwarder.cjs 3456 SessionStart');
  });
});
