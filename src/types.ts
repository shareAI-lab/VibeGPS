export interface ReportConfig {
  threshold: number;
  minTurnsBetween: number;
  autoOpen: boolean;
}

export interface AnalyzerConfig {
  prefer: 'claude' | 'codex';
  timeout: number;
  enabled: boolean;
  apiKey?: string;
  model?: string;
}

export interface VibegpsConfig {
  report: ReportConfig;
  analyzer: AnalyzerConfig;
}
