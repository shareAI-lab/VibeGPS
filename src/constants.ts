import { homedir } from 'node:os';
import { join } from 'node:path';

export const VIBEGPS_HOME = join(homedir(), '.vibegps');
export const SESSIONS_DIR = join(VIBEGPS_HOME, 'sessions');
export const REPORTS_DIR = join(VIBEGPS_HOME, 'reports');
export const TMP_HOOK_DIR = join(VIBEGPS_HOME, 'tmp', 'hooks');

export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_API_MODEL = 'claude-sonnet-4-20250514';

export const DEFAULT_CONFIG = {
  report: {
    threshold: 200,
    minTurnsBetween: 3,
    autoOpen: true
  },
  analyzer: {
    prefer: 'claude' as const,
    timeout: 30_000,
    enabled: true,
    apiKey: undefined as string | undefined,
    model: undefined as string | undefined
  }
};
