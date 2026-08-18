import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { runMigrations } from "./migrations";

/**
 * Single shared connection. Cached on globalThis so Next's dev-mode module
 * reloading does not open a new file handle on every request.
 */

/**
 * data/air4.db is the real working copy and the default.
 *
 * AIR4_DB_PATH points the app at a different file. Its only intended use is
 * testing: the sync test suite copies the live database and drives destructive
 * scenarios — a department change, a disappearing row — against the copy, so the
 * real audit history and connection reviews are never at risk. Leave it unset in
 * normal use.
 */
const DB_PATH = process.env.AIR4_DB_PATH
  ? path.resolve(process.cwd(), process.env.AIR4_DB_PATH)
  : path.join(process.cwd(), "data", "air4.db");

declare global {
  // eslint-disable-next-line no-var
  var __air4db: Database.Database | undefined;
}

function open(): Database.Database {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      `Air4 database not found at ${DB_PATH}. Run "npm run seed" to create it from data/source/.`
    );
  }
  const database = new Database(DB_PATH);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");

  // Additive only — see src/lib/migrations.ts. Never rebuilds the database.
  const applied = runMigrations(database);
  if (applied.length) {
    console.log(`[air4] applied ${applied.length} migration step(s):`);
    for (const step of applied) console.log(`        · ${step}`);
  }

  return database;
}

export const db: Database.Database = globalThis.__air4db ?? open();

if (process.env.NODE_ENV !== "production") globalThis.__air4db = db;

/** Typed convenience wrappers. */
export function all<T>(sql: string, params: unknown[] = []): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

export function get<T>(sql: string, params: unknown[] = []): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}

export function run(sql: string, params: unknown[] = []) {
  return db.prepare(sql).run(...(params as never[]));
}
