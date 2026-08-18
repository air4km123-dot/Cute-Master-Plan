/**
 * Apply pending schema migrations to data/air4.db.
 *
 * The app runs these automatically when it first opens the database, so this
 * script is only for doing it deliberately — before a build, or to see exactly
 * what changed. It is additive and idempotent: safe to run repeatedly, and it
 * never drops or rewrites anything.
 *
 * A timestamped copy is written to data/backups/ first. The database holds local
 * decisions that cannot be regenerated — connection reviews, progress, layout,
 * audit history — so a schema change always gets a rollback point.
 *
 * Usage:  node scripts/migrate.mjs [--no-backup] [--db <path>]
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { runMigrations } from "../src/lib/migrations.ts";

const args = process.argv.slice(2);
const dbArg = args.indexOf("--db");
const dbPath = path.resolve(
  process.cwd(),
  dbArg !== -1 ? args[dbArg + 1] : path.join("data", "air4.db")
);
const skipBackup = args.includes("--no-backup");

if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. Nothing to migrate.`);
  process.exit(1);
}

if (!skipBackup) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  const backupDir = path.join(path.dirname(dbPath), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, `air4-before-migration-${stamp}.db`);

  // A WAL database must be checkpointed before the file is copied, or recent
  // commits would be left behind in the -wal sidecar.
  const source = new Database(dbPath);
  source.pragma("wal_checkpoint(TRUNCATE)");
  source.close();

  fs.copyFileSync(dbPath, target);
  console.log(`Backup  → ${path.relative(process.cwd(), target)}`);
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const applied = runMigrations(db);

if (applied.length === 0) {
  console.log("Schema  → already up to date, nothing to do.");
} else {
  console.log(`Applied ${applied.length} step(s):`);
  for (const step of applied) console.log(`  · ${step}`);
}

const counts = ["projects", "connections", "audit_log", "sync_runs", "sync_conflicts"].map(
  (table) => `${table}=${db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c}`
);
console.log(`Rows    → ${counts.join("  ")}`);

db.close();
