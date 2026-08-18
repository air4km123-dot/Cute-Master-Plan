/**
 * Full backup of data/air4.db before the Turso migration.
 *
 * Writes two things:
 *   1. A byte-for-byte copy of the database file (WAL checkpointed first, so
 *      recent commits are actually in it).
 *   2. Every table as JSON, one file per table, plus a manifest of row counts.
 *
 * The JSON export is the rollback path that does not depend on SQLite: if the
 * migration goes wrong, or Turso has to be rebuilt from scratch, these files
 * carry the 44 permanent Project IDs, the connection review decisions and the
 * whole audit history in a form anything can read.
 *
 * Read-only with respect to the data — the only write is the WAL checkpoint,
 * which moves committed pages into the main file without changing content.
 *
 * Usage:  node scripts/export-db.mjs [--db <path>] [--out <dir>]
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : fallback;
};

const dbPath = path.resolve(process.cwd(), argValue("--db", path.join("data", "air4.db")));
if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}.`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const backupDir = path.join(process.cwd(), "data", "backups");
const outDir = path.resolve(
  process.cwd(),
  argValue("--out", path.join("data", "backups", `export-${stamp}`))
);

fs.mkdirSync(backupDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

// Checkpoint so the file copy is complete, then reopen read-only for the export.
{
  const live = new Database(dbPath);
  live.pragma("wal_checkpoint(TRUNCATE)");
  live.close();
}

const fileBackup = path.join(backupDir, `air4-before-turso-${stamp}.db`);
fs.copyFileSync(dbPath, fileBackup);
console.log(`File backup   → ${path.relative(process.cwd(), fileBackup)}`);

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const tables = db
  .prepare(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name`
  )
  .all()
  .map((r) => r.name);

const manifest = {
  exported_at: new Date().toISOString(),
  source: path.relative(process.cwd(), dbPath),
  tables: {},
};

console.log(`\nTable                   Rows   File`);
console.log(`${"-".repeat(58)}`);

for (const table of tables) {
  const rows = db.prepare(`SELECT * FROM "${table}"`).all();
  const file = path.join(outDir, `${table}.json`);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");
  manifest.tables[table] = rows.length;
  console.log(`${table.padEnd(22)} ${String(rows.length).padStart(5)}   ${table}.json`);
}

// The schema itself, so a rebuild does not depend on schema.sql having stayed in step.
const schema = db
  .prepare(
    `SELECT sql FROM sqlite_master
      WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`
  )
  .all()
  .map((r) => r.sql + ";")
  .join("\n\n");
fs.writeFileSync(path.join(outDir, "_schema.sql"), schema + "\n", "utf8");

// Spot-check values that must survive the migration unchanged.
const spotIds = ["AF-001", "AF-007", "PG-005", "PG-010", "AS-002", "B2C-002", "BD-002"];
manifest.spot_check = db
  .prepare(
    `SELECT project_id, dept_code, project_name, priority, status_id, progress_percent,
            project_type, connection_review_status, layout_x, layout_y
       FROM projects WHERE project_id IN (${spotIds.map(() => "?").join(",")})
      ORDER BY project_id`
  )
  .all(...spotIds);

manifest.integrity = {
  projects: db.prepare(`SELECT COUNT(*) c FROM projects`).get().c,
  future_addons: db
    .prepare(`SELECT COUNT(*) c FROM projects WHERE project_type = 'FUTURE_ADDON'`)
    .get().c,
  connections: db.prepare(`SELECT COUNT(*) c FROM connections`).get().c,
  connections_ai_suggested: db
    .prepare(`SELECT COUNT(*) c FROM connections WHERE connection_status = 'AI_SUGGESTED'`)
    .get().c,
  connections_approved: db
    .prepare(
      `SELECT COUNT(*) c FROM connections WHERE connection_status IN ('APPROVED','EDITED')`
    )
    .get().c,
  audit_rows: db.prepare(`SELECT COUNT(*) c FROM audit_log`).get().c,
  users: db.prepare(`SELECT COUNT(*) c FROM users`).get().c,
  departments: db.prepare(`SELECT COUNT(*) c FROM departments`).get().c,
  projects_with_layout: db
    .prepare(`SELECT COUNT(*) c FROM projects WHERE layout_x IS NOT NULL`)
    .get().c,
};

fs.writeFileSync(
  path.join(outDir, "_manifest.json"),
  JSON.stringify(manifest, null, 2),
  "utf8"
);

console.log(`\nJSON export   → ${path.relative(process.cwd(), outDir)}`);
console.log(`\nIntegrity baseline (what Turso must match):`);
for (const [key, value] of Object.entries(manifest.integrity)) {
  console.log(`  ${key.padEnd(26)} ${value}`);
}

db.close();
