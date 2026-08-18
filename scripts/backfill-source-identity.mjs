/**
 * One-time backfill of source-row provenance on the 44 imported projects.
 *
 * The original import recorded the sheet's ลำดับ in projects.source_seq but not
 * the sheet's own department code — `CS1` and `CS2` were normalised to `CS` and
 * the original was only mentioned in a note. The sync engine treats
 * source_dept as a source field, so without this backfill the very first check
 * would report all 44 projects as "Source Department: empty → CS1/AS/IO/…" and
 * write 44 audit rows for data the project already knew.
 *
 * That value is recovered here from data/source/projects.json, which is the
 * record of what the sheet said at import time. Nothing else is touched: no
 * name, priority, owner, brief, status, progress, connection or review is
 * changed, and a single SYSTEM audit row records that the backfill happened
 * rather than 44 field rows of noise.
 *
 * Safe to run more than once — it only fills columns that are still empty.
 *
 * Usage:  node scripts/backfill-source-identity.mjs [--db <path>]
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dbArg = args.indexOf("--db");
const dbPath = path.resolve(
  process.cwd(),
  dbArg !== -1 ? args[dbArg + 1] : path.join("data", "air4.db")
);

const SHEET_ID = process.env.GOOGLE_SPREADSHEET_ID ?? "1zby_FYFWKHXDLP5Q6Z74XD3A7Onpxvs7zsuuV-5kc-0";
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB ?? "สรุปโปรเจค";

if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}.`);
  process.exit(1);
}

const source = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data", "source", "projects.json"), "utf8")
);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const update = db.prepare(
  `UPDATE projects
      SET source_dept     = COALESCE(source_dept, @source_dept),
          source_sheet_id = COALESCE(source_sheet_id, @sheet_id),
          source_tab      = COALESCE(source_tab, @tab)
    WHERE project_id = @project_id
      AND (source_dept IS NULL OR source_sheet_id IS NULL OR source_tab IS NULL)`
);

let filled = 0;
const missing = [];

const transaction = db.transaction(() => {
  for (const project of source.projects) {
    const exists = db
      .prepare(`SELECT 1 FROM projects WHERE project_id = ?`)
      .get(project.project_id);
    if (!exists) {
      missing.push(project.project_id);
      continue;
    }
    const result = update.run({
      project_id: project.project_id,
      source_dept: project.source_dept ?? project.dept_code,
      sheet_id: SHEET_ID,
      tab: SHEET_TAB,
    });
    filled += result.changes;
  }

  if (filled > 0) {
    db.prepare(
      `INSERT INTO audit_log (timestamp, user_id, username, action, entity_type, entity_id,
                              field_name, old_value, new_value, source, notes)
       VALUES (?, NULL, NULL, 'BACKFILL_SOURCE_IDENTITY', 'SYSTEM', NULL,
               NULL, NULL, ?, 'MIGRATION', ?)`
    ).run(
      new Date().toISOString(),
      String(filled),
      `Recovered source_dept / source_sheet_id / source_tab for ${filled} project(s) from ` +
        `data/source/projects.json so Google Sheet sync has a provenance baseline. ` +
        `No business field was modified.`
    );
  }
});

transaction();

console.log(`Backfilled provenance on ${filled} project(s).`);
if (missing.length) {
  console.log(`Not in this database (ignored): ${missing.join(", ")}`);
}

const remaining = db
  .prepare(`SELECT COUNT(*) c FROM projects WHERE source_dept IS NULL AND source_state <> 'MANUAL'`)
  .get().c;
console.log(`Sheet-sourced projects still missing source_dept: ${remaining}`);

const sample = db
  .prepare(
    `SELECT project_id, dept_code, source_dept, source_seq FROM projects
      WHERE project_id IN ('CS-001','CS-002','AF-007','PG-005') ORDER BY project_id`
  )
  .all();
for (const row of sample) {
  console.log(
    `  ${row.project_id.padEnd(7)} dept=${row.dept_code.padEnd(4)} source_dept=${String(
      row.source_dept
    ).padEnd(4)} seq=${row.source_seq}`
  );
}

db.close();
