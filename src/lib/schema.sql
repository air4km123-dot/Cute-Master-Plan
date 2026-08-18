-- =====================================================================
-- Air4 Master Plan — Schema (Addendum V2)
--
-- Design notes:
--  * Authentication credentials live HERE, never in Google Sheets. (§1)
--  * Project_ID is the permanent technical identifier for every
--    relationship, layout, permission and audit row. Project names are
--    never used as keys. (§3)
--  * Status and Connection Type are controlled configuration tables,
--    not free text. (§10, §17)
--  * Written in portable SQL so the move from SQLite to Postgres is a
--    driver change, not a redesign. (§28)
-- =====================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS departments (
  dept_code      TEXT PRIMARY KEY,
  dept_name_th   TEXT NOT NULL,
  dept_name_en   TEXT NOT NULL,
  color          TEXT NOT NULL,
  head_name      TEXT,
  display_order  INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS status_config (
  status_id      TEXT PRIMARY KEY,
  status_name    TEXT NOT NULL,
  display_order  INTEGER NOT NULL,
  color          TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS connection_types (
  type_id        TEXT PRIMARY KEY,
  type_name      TEXT NOT NULL,
  color          TEXT NOT NULL,
  display_order  INTEGER NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------
-- Users & access
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  user_id        TEXT PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL DEFAULT '',   -- '' = no password set, cannot log in
  display_name   TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('ADMIN', 'OWNER', 'VIEWER')),
  department_id  TEXT REFERENCES departments (dept_code),
  must_set_password INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  last_login     TEXT
);

-- Linked_Project_IDs (§1). A join table rather than a delimited column so
-- grants are queryable and auditable one row at a time.
CREATE TABLE IF NOT EXISTS user_projects (
  user_id     TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects (project_id) ON DELETE CASCADE,
  granted_by  TEXT,
  granted_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, project_id)
);

-- ---------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
  project_id        TEXT PRIMARY KEY,            -- permanent, e.g. AF-003 (§3)
  source_seq        INTEGER,                     -- ลำดับ from the original sheet
  dept_code         TEXT NOT NULL REFERENCES departments (dept_code),
  project_name      TEXT NOT NULL,
  project_type      TEXT NOT NULL DEFAULT 'APPROVED'
                      CHECK (project_type IN ('APPROVED', 'FUTURE_ADDON')),
  phase             TEXT NOT NULL DEFAULT 'PHASE_1',
  priority          INTEGER,

  owner_user_id     TEXT REFERENCES users (user_id),
  owner_name        TEXT,                        -- ผู้รับผิดชอบ as written in the sheet
  data_owner        TEXT,                        -- §30
  system_owner      TEXT,                        -- §30

  objective         TEXT,
  brief             TEXT,                        -- Brief เบื้องต้นจากที่ประชุม
  notes             TEXT,                        -- หมายเหตุจากที่ประชุม

  status_id         TEXT NOT NULL REFERENCES status_config (status_id),
  status_original   TEXT,                        -- original Thai status, preserved (§10)
  next_step         TEXT,
  progress_percent  INTEGER NOT NULL DEFAULT 0
                      CHECK (progress_percent BETWEEN 0 AND 100),

  -- Flexible scheduling: none of these are required (§8, §9)
  use_checkpoints     INTEGER NOT NULL DEFAULT 0,
  checkpoint_due_date TEXT,
  final_due_date      TEXT,

  connection_review_status TEXT NOT NULL DEFAULT 'NOT_REVIEWED'
    CHECK (connection_review_status IN
      ('NOT_REVIEWED', 'AI_REVIEWED', 'HUMAN_REVIEWED', 'CONFIRMED')),

  layout_x  REAL,                                -- keyed by Project_ID (§3)
  layout_y  REAL,

  -- Google Sheet source-row identity. The sheet owns the source fields; these
  -- columns record which row they came from so a rename never breaks the link
  -- to the permanent Project_ID. Added by src/lib/migrations.ts on existing
  -- databases — keep the two in step.
  source_sheet_id     TEXT,
  source_tab          TEXT,
  source_row_number   INTEGER,
  source_dept         TEXT,                      -- as written in the sheet, e.g. CS1
  source_state        TEXT NOT NULL DEFAULT 'PRESENT',
                      -- PRESENT | SOURCE_MISSING | MANUAL
  source_last_seen_at TEXT,
  source_updated_at   TEXT,

  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_dept   ON projects (dept_code);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner  ON projects (owner_user_id);

-- Extensible milestone table. MVP uses the single checkpoint field above;
-- this is here so multiple checkpoints need no migration later. (§9)
CREATE TABLE IF NOT EXISTS project_milestones (
  milestone_id    TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects (project_id) ON DELETE CASCADE,
  milestone_name  TEXT NOT NULL,
  due_date        TEXT,
  status_id       TEXT REFERENCES status_config (status_id),
  progress        INTEGER DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  owner_user_id   TEXT REFERENCES users (user_id),
  notes           TEXT,
  display_order   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_milestones_project ON project_milestones (project_id);

-- ---------------------------------------------------------------------
-- Connections (§16)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS connections (
  connection_id        TEXT PRIMARY KEY,
  source_project_id    TEXT NOT NULL REFERENCES projects (project_id) ON DELETE CASCADE,
  target_project_id    TEXT NOT NULL REFERENCES projects (project_id) ON DELETE CASCADE,
  direction            TEXT NOT NULL DEFAULT 'ONE_WAY'
                         CHECK (direction IN ('ONE_WAY', 'BIDIRECTIONAL')),
  connection_type      TEXT NOT NULL REFERENCES connection_types (type_id),
  connection_label     TEXT NOT NULL,            -- 1–5 words (§15)
  detailed_description TEXT,
  data_or_process_name TEXT,
  connection_status    TEXT NOT NULL DEFAULT 'NOT_REVIEWED'
                         CHECK (connection_status IN
                           ('NOT_REVIEWED', 'AI_SUGGESTED', 'APPROVED', 'EDITED', 'REJECTED')),
  proposed_by   TEXT,
  reviewed_by   TEXT,
  review_date   TEXT,
  confidence    TEXT CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  reason        TEXT,                            -- why the AI proposed it (§21)
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,

  -- Guard rail §35: a project may not connect to itself.
  CHECK (source_project_id <> target_project_id)
);

CREATE INDEX IF NOT EXISTS idx_conn_source ON connections (source_project_id);
CREATE INDEX IF NOT EXISTS idx_conn_target ON connections (target_project_id);
CREATE INDEX IF NOT EXISTS idx_conn_status ON connections (connection_status);

-- ---------------------------------------------------------------------
-- Audit log (§23, §24) — append only; no UPDATE/DELETE path in the app.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp    TEXT NOT NULL,
  user_id      TEXT,
  username     TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  field_name   TEXT,
  old_value    TEXT,
  new_value    TEXT,
  source       TEXT NOT NULL DEFAULT 'WEB_APP',
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_time   ON audit_log (timestamp DESC);

-- ---------------------------------------------------------------------
-- Google Sheet synchronisation
--
-- One row per Check or Apply, plus everything a human still has to decide.
-- Nothing in sync_conflicts is ever applied automatically. Mirrored in
-- src/lib/migrations.ts, which is what reaches an existing data/air4.db.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sync_runs (
  run_id          TEXT PRIMARY KEY,
  mode            TEXT NOT NULL CHECK (mode IN ('CHECK', 'APPLY')),
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  status          TEXT NOT NULL DEFAULT 'RUNNING'
                    CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED')),
  actor_user_id   TEXT,
  actor_username  TEXT,
  spreadsheet_id  TEXT,
  tab_name        TEXT,
  source_mode     TEXT,
  rows_read       INTEGER NOT NULL DEFAULT 0,
  matched_count   INTEGER NOT NULL DEFAULT 0,
  changed_count   INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  new_count       INTEGER NOT NULL DEFAULT 0,
  missing_count   INTEGER NOT NULL DEFAULT 0,
  warning_count   INTEGER NOT NULL DEFAULT 0,
  conflict_count  INTEGER NOT NULL DEFAULT 0,
  applied_fields  INTEGER NOT NULL DEFAULT 0,
  applied_projects INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_time ON sync_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  conflict_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT NOT NULL REFERENCES sync_runs (run_id),
  detected_at   TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'WARNING')),
  project_id    TEXT,
  source_row    INTEGER,
  field_name    TEXT,
  current_value TEXT,
  sheet_value   TEXT,
  message       TEXT NOT NULL,
  resolution    TEXT NOT NULL DEFAULT 'OPEN'
                  CHECK (resolution IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  resolved_by   TEXT,
  resolved_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_run  ON sync_conflicts (run_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_open ON sync_conflicts (resolution, severity);
