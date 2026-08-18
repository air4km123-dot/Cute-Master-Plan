/**
 * Move the CS1 / CS2 provenance note out of the sheet-owned `notes` column.
 *
 * The original seed recorded the sheet's own department code by writing
 * "Source sheet department code: CS1" into projects.notes. But `notes` mirrors
 * หมายเหตุจากที่ประชุม, which the sheet owns — and that column is empty in the
 * sheet. So the first real sync would correctly see "CS1 note → empty" and wipe
 * it, which is exactly the kind of silent overwrite of internal data the sync
 * rules forbid.
 *
 * The same fact now lives in projects.source_dept, which the sheet cannot
 * overwrite, so the note is redundant duplication rather than information.
 *
 * This clears it for exactly the rows where BOTH hold:
 *   · notes matches the generated sentence, character for character
 *   · source_dept already records the very same code
 *
 * Any note a human typed is left alone — the pattern match is strict, and a row
 * whose source_dept does not agree is skipped and reported. One audit row per
 * project records the change, so the text remains recoverable from the audit log.
 *
 * Safe to run more than once. Usage:  node scripts/cleanup-notes-provenance.mjs [--db <path>] [--dry-run]
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dbArg = args.indexOf("--db");
const dryRun = args.includes("--dry-run");
const dbPath = path.resolve(
  process.cwd(),
  dbArg !== -1 ? args[dbArg + 1] : path.join("data", "air4.db")
);

if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}.`);
  process.exit(1);
}

const PATTERN = /^Source sheet department code:\s*(\S+)$/;

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const candidates = db
  .prepare(
    `SELECT project_id, notes, source_dept, dept_code FROM projects
      WHERE notes IS NOT NULL AND notes <> ''`
  )
  .all();

const toClear = [];
const skipped = [];

for (const row of candidates) {
  const match = PATTERN.exec(row.notes.trim());
  if (!match) continue; // a real, human-written note
  if (match[1] !== row.source_dept) {
    skipped.push(row);
    continue;
  }
  toClear.push(row);
}

if (dryRun) {
  console.log(`Dry run — nothing written.`);
  for (const row of toClear) console.log(`  would clear ${row.project_id}: ${JSON.stringify(row.notes)}`);
} else {
  const clear = db.prepare(
    `UPDATE projects SET notes = NULL, updated_at = ?, updated_by = 'migration'
      WHERE project_id = ?`
  );
  const audit = db.prepare(
    `INSERT INTO audit_log (timestamp, user_id, username, action, entity_type, entity_id,
                            field_name, old_value, new_value, source, notes)
     VALUES (?, NULL, NULL, 'CLEANUP_NOTES_PROVENANCE', 'PROJECT', ?,
             'notes', ?, NULL, 'MIGRATION', ?)`
  );

  const transaction = db.transaction(() => {
    for (const row of toClear) {
      const ts = new Date().toISOString();
      clear.run(ts, row.project_id);
      audit.run(
        ts,
        row.project_id,
        row.notes,
        `Internal provenance moved out of the sheet-owned notes field; the sheet's ` +
          `department code "${row.source_dept}" is recorded in source_dept instead. ` +
          `Prevents the first Google Sheet sync from overwriting it silently.`
      );
    }
  });
  transaction();
  console.log(`Cleared provenance notes on ${toClear.length} project(s):`);
  for (const row of toClear) console.log(`  ${row.project_id}  ${JSON.stringify(row.notes)} → NULL  (source_dept=${row.source_dept})`);
}

if (skipped.length) {
  console.log(`\nSkipped — source_dept disagrees, left for a human:`);
  for (const row of skipped) {
    console.log(`  ${row.project_id}  notes=${JSON.stringify(row.notes)}  source_dept=${row.source_dept}`);
  }
}

const remaining = db
  .prepare(`SELECT COUNT(*) c FROM projects WHERE notes IS NOT NULL AND notes <> ''`)
  .get().c;
console.log(`\nProjects still carrying a note: ${remaining}`);

db.close();
