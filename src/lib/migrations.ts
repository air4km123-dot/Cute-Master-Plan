import type { Client } from "@libsql/client";

/**
 * Additive, idempotent schema migrations.
 *
 * The Air4 database is a working copy that accumulates local decisions —
 * connection reviews, progress, layout, audit history. It is never rebuilt from
 * source. So schema changes must be ALTER TABLE / CREATE TABLE IF NOT EXISTS
 * only: nothing here drops, renames or rewrites an existing column, and every
 * statement is safe to run repeatedly against an already-migrated database.
 *
 * Editing src/lib/schema.sql alone does NOT change an existing data/air4.db —
 * that file only describes a fresh seed. Any new column or table must be added
 * in BOTH places, and this is the half that reaches the live database.
 */

interface ColumnSpec {
  table: string;
  column: string;
  /** Full column definition. No NOT NULL without a DEFAULT — existing rows need a value. */
  definition: string;
}

/**
 * Source-row identity for Google Sheet synchronisation.
 *
 * The original import stored only source_seq (the sheet's ลำดับ). These columns
 * let a project be traced back to a specific row of a specific sheet, so a
 * rename in the sheet no longer risks losing the link to the permanent
 * Project_ID.
 */
const COLUMNS: ColumnSpec[] = [
  // Which sheet/tab this project's source row lives in.
  { table: "projects", column: "source_sheet_id", definition: "TEXT" },
  { table: "projects", column: "source_tab", definition: "TEXT" },
  // The 1-based spreadsheet row number the project was last matched to.
  { table: "projects", column: "source_row_number", definition: "INTEGER" },
  // Department code exactly as written in the sheet (e.g. "CS1", normalised to CS).
  { table: "projects", column: "source_dept", definition: "TEXT" },
  /**
   * PRESENT        row found in the sheet at the last check
   * SOURCE_MISSING project exists here but its row is gone from the sheet (§10 — never deleted)
   * MANUAL         created inside the app (future add-on); has no source row and is never
   *                reported as missing
   */
  { table: "projects", column: "source_state", definition: "TEXT NOT NULL DEFAULT 'PRESENT'" },
  // When the sheet row was last seen, and when sheet data last actually changed a field.
  { table: "projects", column: "source_last_seen_at", definition: "TEXT" },
  { table: "projects", column: "source_updated_at", definition: "TEXT" },
];

const TABLES: string[] = [
  /**
   * One row per Check or Apply. Check runs are recorded too, so "when did we
   * last look at the sheet" is answerable even when nothing changed.
   */
  `CREATE TABLE IF NOT EXISTS sync_runs (
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
   )`,

  `CREATE INDEX IF NOT EXISTS idx_sync_runs_time ON sync_runs (started_at DESC)`,

  /**
   * Anything a human must decide. Nothing in here is ever auto-applied:
   * CRITICAL blocks the affected project from being updated at all, WARNING is
   * informational and leaves safe fields free to apply.
   */
  `CREATE TABLE IF NOT EXISTS sync_conflicts (
     conflict_id     INTEGER PRIMARY KEY AUTOINCREMENT,
     run_id          TEXT NOT NULL REFERENCES sync_runs (run_id),
     detected_at     TEXT NOT NULL,
     conflict_type   TEXT NOT NULL,
     severity        TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'WARNING')),
     project_id      TEXT,
     source_row      INTEGER,
     field_name      TEXT,
     current_value   TEXT,
     sheet_value     TEXT,
     message         TEXT NOT NULL,
     resolution      TEXT NOT NULL DEFAULT 'OPEN'
                       CHECK (resolution IN ('OPEN', 'RESOLVED', 'DISMISSED')),
     resolved_by     TEXT,
     resolved_at     TEXT
   )`,

  `CREATE INDEX IF NOT EXISTS idx_sync_conflicts_run  ON sync_conflicts (run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_conflicts_open ON sync_conflicts (resolution, severity)`,
];

/**
 * `pragma_table_info` is used as a table-valued function rather than issuing a
 * bare `PRAGMA table_info(...)`, because the function form accepts a bound
 * parameter and returns an ordinary result set over the libSQL wire protocol.
 */
async function columnExists(db: Client, table: string, column: string): Promise<boolean> {
  const result = await db.execute({
    sql: `SELECT 1 FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column],
  });
  return result.rows.length > 0;
}

async function tableExists(db: Client, table: string): Promise<boolean> {
  const result = await db.execute({
    sql: `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
    args: [table],
  });
  return result.rows.length > 0;
}

/**
 * Bring an existing database up to date. Returns the statements applied, so a
 * first run can be reported instead of happening silently.
 */
export async function runMigrations(db: Client): Promise<string[]> {
  const applied: string[] = [];

  for (const spec of COLUMNS) {
    if (!(await tableExists(db, spec.table))) continue;
    if (await columnExists(db, spec.table, spec.column)) continue;
    await db.execute(`ALTER TABLE ${spec.table} ADD COLUMN ${spec.column} ${spec.definition}`);
    applied.push(`ADD COLUMN ${spec.table}.${spec.column}`);
  }

  const syncTablesPresent = async () =>
    (await tableExists(db, "sync_runs")) && (await tableExists(db, "sync_conflicts"));

  for (const statement of TABLES) {
    const before = await syncTablesPresent();
    await db.execute(statement);
    const after = await syncTablesPresent();
    if (!before && after) applied.push("CREATE sync_runs / sync_conflicts");
  }

  /**
   * Projects created inside the app have no sheet row and must never be
   * reported as SOURCE_MISSING. Only the originally imported rows (which carry
   * a source_seq) start life as PRESENT. Runs once, on the migration that
   * introduces the column.
   */
  if (applied.some((a) => a.endsWith("projects.source_state"))) {
    await db.execute(`UPDATE projects SET source_state = 'MANUAL' WHERE source_seq IS NULL`);
    applied.push("SET source_state = MANUAL for projects with no source row");
  }

  return applied;
}
