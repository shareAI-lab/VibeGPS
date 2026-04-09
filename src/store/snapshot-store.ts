import type Database from 'better-sqlite3';

// ── Types ──

export interface SessionRecord {
  id: string;
  cwd: string;
  agent: string;
  startedAt: number;
  endedAt: number | null;
  baselineHead: string;
}

export interface SnapshotRecord {
  id: number;
  sessionId: string;
  turn: number | null;
  headHash: string;
  timestamp: number;
  totalAdded: number;
  totalRemoved: number;
  fileCount: number;
  diffContent: string | null;
}

export interface FileChangeRecord {
  session_id: string;
  turn: number;
  filePath: string;
  operation: string;
  source: string;
  toolName?: string;
  linesAdded: number;
  linesRemoved: number;
  oldSnippet?: string;
  newSnippet?: string;
  timestamp: number;
}

export interface TurnRecord {
  sessionId: string;
  turn: number;
  startSnapshotId: number | null;
  endSnapshotId: number | null;
  timestamp: number;
  headHash: string;
  commitDetected: boolean;
  deltaAdded: number;
  deltaRemoved: number;
  lastAssistantMessage: string | null;
  operationsJson: string | null;
}

export interface ReportRecord {
  sessionId: string;
  generatedAt: number;
  htmlPath: string;
  triggerType: string | null;
  totalsJson: string | null;
  analysisJson: string | null;
}

export interface AgentOutputRecord {
  sessionId: string;
  turn: number | null;
  agent: string;
  rawOutput: string;
  parsedJson: string | null;
}

export interface FileHeatmapEntry {
  file: string;
  totalChanges: number;
  isNew: boolean;
}

// ── Write Operations ──

export function createSession(
  db: Database.Database,
  input: { id: string; cwd: string; agent: string; baselineHead: string }
): void {
  db.prepare(
    `INSERT INTO sessions (id, cwd, agent, started_at, baseline_head)
     VALUES (?, ?, ?, ?, ?)`
  ).run(input.id, input.cwd, input.agent, Date.now(), input.baselineHead);
}

export function sessionExists(db: Database.Database, sessionId: string): boolean {
  const row = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
  return row !== undefined;
}

export function insertSnapshot(
  db: Database.Database,
  input: {
    sessionId: string;
    turn: number | null;
    headHash: string;
    totalAdded: number;
    totalRemoved: number;
    fileCount: number;
    diffContent?: string;
  }
): number {
  const stmt = db.prepare(
    `INSERT INTO snapshots (session_id, turn, head_hash, timestamp, total_added, total_removed, file_count, diff_content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.sessionId,
    input.turn,
    input.headHash,
    Date.now(),
    input.totalAdded,
    input.totalRemoved,
    input.fileCount,
    input.diffContent ?? null
  );
  return Number(result.lastInsertRowid);
}

const SNIPPET_MAX = 500;

export function insertFileChanges(
  db: Database.Database,
  sessionId: string,
  turn: number,
  changes: FileChangeRecord[]
): void {
  const stmt = db.prepare(
    `INSERT INTO file_changes (session_id, turn, file_path, operation, source, tool_name, lines_added, lines_removed, old_snippet, new_snippet, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const timestamp = Date.now();
  for (const c of changes) {
    stmt.run(
      sessionId,
      turn,
      c.filePath,
      c.operation,
      c.source,
      c.toolName ?? null,
      c.linesAdded,
      c.linesRemoved,
      c.oldSnippet ? c.oldSnippet.slice(0, SNIPPET_MAX) : null,
      c.newSnippet ? c.newSnippet.slice(0, SNIPPET_MAX) : null,
      c.timestamp ?? timestamp
    );
  }
}

export function insertTurn(db: Database.Database, turn: TurnRecord): void {
  db.prepare(
    `INSERT INTO turns (session_id, turn, start_snapshot_id, end_snapshot_id, timestamp, head_hash, commit_detected, delta_added, delta_removed, last_assistant_message, operations_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    turn.sessionId,
    turn.turn,
    turn.startSnapshotId,
    turn.endSnapshotId,
    turn.timestamp,
    turn.headHash,
    turn.commitDetected ? 1 : 0,
    turn.deltaAdded,
    turn.deltaRemoved,
    turn.lastAssistantMessage ?? null,
    turn.operationsJson ?? null
  );
}

export function insertReport(db: Database.Database, report: ReportRecord): void {
  db.prepare(
    `INSERT INTO reports (session_id, generated_at, html_path, trigger_type, totals_json, analysis_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    report.sessionId,
    report.generatedAt,
    report.htmlPath,
    report.triggerType ?? null,
    report.totalsJson ?? null,
    report.analysisJson ?? null
  );
}

export function insertAgentOutput(db: Database.Database, output: AgentOutputRecord): void {
  db.prepare(
    `INSERT INTO agent_outputs (session_id, turn, agent, raw_output, parsed_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    output.sessionId,
    output.turn ?? null,
    output.agent,
    output.rawOutput,
    output.parsedJson ?? null,
    Date.now()
  );
}

export function updateSessionEndedAt(db: Database.Database, sessionId: string): void {
  db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(Date.now(), sessionId);
}

// ── Read Operations ──

export function getSession(db: Database.Database, sessionId: string): SessionRecord | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    cwd: row.cwd as string,
    agent: row.agent as string,
    startedAt: row.started_at as number,
    endedAt: (row.ended_at as number | null) ?? null,
    baselineHead: row.baseline_head as string
  };
}

export function getLatestSnapshot(db: Database.Database, sessionId: string): SnapshotRecord | null {
  const row = db
    .prepare('SELECT * FROM snapshots WHERE session_id = ? ORDER BY id DESC LIMIT 1')
    .get(sessionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as number,
    sessionId: row.session_id as string,
    turn: (row.turn as number | null) ?? null,
    headHash: row.head_hash as string,
    timestamp: row.timestamp as number,
    totalAdded: row.total_added as number,
    totalRemoved: row.total_removed as number,
    fileCount: row.file_count as number,
    diffContent: (row.diff_content as string | null) ?? null
  };
}

export function getTurns(db: Database.Database, sessionId: string): TurnRecord[] {
  const rows = db.prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY turn').all(sessionId) as Record<string, unknown>[];
  return rows.map((row) => ({
    sessionId: row.session_id as string,
    turn: row.turn as number,
    startSnapshotId: (row.start_snapshot_id as number | null) ?? null,
    endSnapshotId: (row.end_snapshot_id as number | null) ?? null,
    timestamp: row.timestamp as number,
    headHash: row.head_hash as string,
    commitDetected: Boolean(row.commit_detected),
    deltaAdded: row.delta_added as number,
    deltaRemoved: row.delta_removed as number,
    lastAssistantMessage: (row.last_assistant_message as string | null) ?? null,
    operationsJson: (row.operations_json as string | null) ?? null
  }));
}

export function getFileHeatmap(db: Database.Database, sessionId: string): FileHeatmapEntry[] {
  const rows = db
    .prepare(
      `SELECT file_path, COUNT(*) as total_changes,
         MAX(CASE WHEN operation = 'write' THEN 1 ELSE 0 END) as is_new
       FROM file_changes WHERE session_id = ?
       GROUP BY file_path
       ORDER BY total_changes DESC`
    )
    .all(sessionId) as Record<string, unknown>[];
  return rows.map((row) => ({
    file: row.file_path as string,
    totalChanges: row.total_changes as number,
    isNew: Boolean(row.is_new)
  }));
}

export function getRecentSessions(db: Database.Database, limit = 20): SessionRecord[] {
  const rows = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?').all(limit) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    cwd: row.cwd as string,
    agent: row.agent as string,
    startedAt: row.started_at as number,
    endedAt: (row.ended_at as number | null) ?? null,
    baselineHead: row.baseline_head as string
  }));
}

export function getSessionTotalDelta(
  db: Database.Database,
  sessionId: string
): { added: number; removed: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(delta_added), 0) as added, COALESCE(SUM(delta_removed), 0) as removed
       FROM turns WHERE session_id = ?`
    )
    .get(sessionId) as Record<string, unknown>;
  return {
    added: (row?.added as number) ?? 0,
    removed: (row?.removed as number) ?? 0
  };
}

export function getReports(db: Database.Database, sessionId: string): ReportRecord[] {
  const rows = db
    .prepare('SELECT * FROM reports WHERE session_id = ? ORDER BY generated_at DESC')
    .all(sessionId) as Record<string, unknown>[];
  return rows.map((row) => ({
    sessionId: row.session_id as string,
    generatedAt: row.generated_at as number,
    htmlPath: row.html_path as string,
    triggerType: (row.trigger_type as string | null) ?? null,
    totalsJson: (row.totals_json as string | null) ?? null,
    analysisJson: (row.analysis_json as string | null) ?? null
  }));
}
