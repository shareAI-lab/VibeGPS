import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SCHEMA_VERSION = 3;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  cwd           TEXT NOT NULL,
  agent         TEXT NOT NULL DEFAULT 'claude',
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  baseline_head TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL REFERENCES sessions(id),
  turn           INTEGER,
  head_hash      TEXT NOT NULL,
  timestamp      INTEGER NOT NULL,
  total_added    INTEGER DEFAULT 0,
  total_removed  INTEGER DEFAULT 0,
  file_count     INTEGER DEFAULT 0,
  diff_content   TEXT
);
CREATE INDEX IF NOT EXISTS idx_snapshots_session ON snapshots(session_id, turn);

CREATE TABLE IF NOT EXISTS file_changes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL REFERENCES sessions(id),
  turn           INTEGER NOT NULL,
  file_path      TEXT NOT NULL,
  operation      TEXT NOT NULL,
  source         TEXT NOT NULL,
  tool_name      TEXT,
  lines_added    INTEGER DEFAULT 0,
  lines_removed  INTEGER DEFAULT 0,
  old_snippet    TEXT,
  new_snippet    TEXT,
  timestamp      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_changes_session ON file_changes(session_id, turn);
CREATE INDEX IF NOT EXISTS idx_file_changes_path ON file_changes(file_path);

CREATE TABLE IF NOT EXISTS turns (
  session_id             TEXT NOT NULL REFERENCES sessions(id),
  turn                   INTEGER NOT NULL,
  start_snapshot_id      INTEGER REFERENCES snapshots(id),
  end_snapshot_id        INTEGER REFERENCES snapshots(id),
  timestamp              INTEGER NOT NULL,
  head_hash              TEXT NOT NULL,
  commit_detected        INTEGER DEFAULT 0,
  delta_added            INTEGER DEFAULT 0,
  delta_removed          INTEGER DEFAULT 0,
  last_assistant_message TEXT,
  operations_json        TEXT,
  user_prompt            TEXT,
  patch_path             TEXT,
  PRIMARY KEY (session_id, turn)
);

CREATE TABLE IF NOT EXISTS reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  generated_at  INTEGER NOT NULL,
  html_path     TEXT NOT NULL,
  trigger_turn  INTEGER,
  trigger_type  TEXT,
  totals_json   TEXT,
  analysis_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_session ON reports(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_session_turn ON reports(session_id, trigger_turn);

CREATE TABLE IF NOT EXISTS agent_outputs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  turn          INTEGER,
  agent         TEXT NOT NULL,
  raw_output    TEXT,
  parsed_json   TEXT,
  created_at    INTEGER NOT NULL
);
`;

export function openDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -10000');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  let userVersion = db.pragma('user_version', { simple: true }) as number;
  if (userVersion < 1) {
    db.exec(SCHEMA_SQL);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
    userVersion = SCHEMA_VERSION;
  }
  if (userVersion < 2) {
    // 兼容从 v1 升级：为报告去重引入 turn 维度。
    db.exec('ALTER TABLE reports ADD COLUMN trigger_turn INTEGER');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_session_turn ON reports(session_id, trigger_turn)');
    db.pragma('user_version = 2');
  }
  if (userVersion < 3) {
    db.exec('ALTER TABLE turns ADD COLUMN user_prompt TEXT');
    db.exec('ALTER TABLE turns ADD COLUMN patch_path TEXT');
    db.pragma('user_version = 3');
  }

  return db;
}
