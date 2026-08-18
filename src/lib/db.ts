import { createClient, type Client, type InArgs, type Transaction } from "@libsql/client";
import path from "node:path";
import { runMigrations } from "./migrations";

/**
 * Database access — libSQL, one driver for both environments.
 *
 *   Production   TURSO_DATABASE_URL + TURSO_AUTH_TOKEN → the hosted Turso
 *                database. Vercel's filesystem is read-only and thrown away on
 *                every deploy, so the working copy has to live off-box.
 *   Local        no TURSO_DATABASE_URL → file:data/air4.db, the same SQLite file
 *                the app has always used.
 *
 * The same client talks to both, so local development, the test suite and
 * production run identical code against identical SQL. `better-sqlite3` is no
 * longer used at runtime; it remains only in scripts/ for offline tooling that
 * reads the local file directly (export, migration, inspection).
 *
 * Everything here is async. libSQL is a network client in production, and no
 * amount of wrapping makes a round trip synchronous — so `all`, `get`, `run` and
 * `transaction` all return promises and every call site awaits them.
 */

const LOCAL_FILE = `file:${path.join(process.cwd(), "data", "air4.db").replace(/\\/g, "/")}`;

function connectionUrl(): string {
  // Checked first, deliberately: the test suite sets AIR4_DB_PATH to a throwaway
  // copy and must never reach the production database just because a developer
  // happens to have TURSO_DATABASE_URL in their .env.local.
  if (process.env.AIR4_DB_PATH) {
    return `file:${path.resolve(process.cwd(), process.env.AIR4_DB_PATH).replace(/\\/g, "/")}`;
  }
  const configured = process.env.TURSO_DATABASE_URL?.trim();
  if (configured) return configured;
  return LOCAL_FILE;
}

declare global {
  // eslint-disable-next-line no-var
  var __air4db: Client | undefined;
  // eslint-disable-next-line no-var
  var __air4migrated: Promise<void> | undefined;
}

function open(): Client {
  const url = connectionUrl();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

  if (url.startsWith("libsql://") && !authToken) {
    throw new Error(
      "TURSO_DATABASE_URL points at a hosted database but TURSO_AUTH_TOKEN is not set."
    );
  }

  return createClient({
    url,
    ...(authToken ? { authToken } : {}),
    // Keep integers as JS numbers. Every id in this schema is a short string or
    // a small integer, so there is nothing here that needs BigInt.
    intMode: "number",
  });
}

/**
 * The client is created on first use, never at import time.
 *
 * `next build` imports every route module to collect page data. Connecting (or
 * validating credentials) during that pass would fail the build on any machine
 * without the production environment — and on a serverless host it would open a
 * connection in a process that may never serve a request.
 */
export function client(): Client {
  if (!globalThis.__air4db) globalThis.__air4db = open();
  return globalThis.__air4db;
}

/** True when we are talking to a local file rather than hosted Turso. */
export function isLocalFile(): boolean {
  return connectionUrl().startsWith("file:");
}

/**
 * Run migrations once per process, and make every query wait for them.
 *
 * Cached as a promise rather than a boolean so concurrent requests during a cold
 * start all await the same run instead of racing to migrate in parallel.
 */
function ready(): Promise<void> {
  if (!globalThis.__air4migrated) {
    globalThis.__air4migrated = (async () => {
      const c = client();
      if (isLocalFile()) {
        // Only meaningful for a local file; Turso manages its own durability.
        await c.execute("PRAGMA journal_mode = WAL");
      }
      await c.execute("PRAGMA foreign_keys = ON");
      const applied = await runMigrations(c);
      if (applied.length) {
        console.log(`[air4] applied ${applied.length} migration step(s):`);
        for (const step of applied) console.log(`        · ${step}`);
      }
    })();
  }
  return globalThis.__air4migrated;
}

/**
 * libSQL returns rows as array-like objects carrying both positional and named
 * access. Server components hand these to the client as props, so they are
 * flattened into plain JSON-serialisable objects here.
 */
function toObject<T>(row: unknown, columns: string[]): T {
  const record: Record<string, unknown> = {};
  for (const column of columns) {
    record[column] = (row as Record<string, unknown>)[column];
  }
  return record as T;
}

export async function all<T>(sql: string, params: InArgs = []): Promise<T[]> {
  await ready();
  const result = await client().execute({ sql, args: params });
  return result.rows.map((row) => toObject<T>(row, result.columns));
}

export async function get<T>(sql: string, params: InArgs = []): Promise<T | undefined> {
  await ready();
  const result = await client().execute({ sql, args: params });
  if (!result.rows.length) return undefined;
  return toObject<T>(result.rows[0], result.columns);
}

export async function run(sql: string, params: InArgs = []) {
  await ready();
  return client().execute({ sql, args: params });
}

/**
 * Run a set of statements atomically, rolling back if the callback throws.
 *
 * Used wherever a partial write would be worse than no write — applying a sheet
 * sync (the update and its audit rows must land together), creating a project,
 * and recording a connection review.
 */
export async function transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  await ready();
  const tx = await client().transaction("write");
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

/** Read helpers scoped to an open transaction, mirroring `all` / `get`. */
export async function txAll<T>(tx: Transaction, sql: string, params: InArgs = []): Promise<T[]> {
  const result = await tx.execute({ sql, args: params });
  return result.rows.map((row) => toObject<T>(row, result.columns));
}

export async function txGet<T>(
  tx: Transaction,
  sql: string,
  params: InArgs = []
): Promise<T | undefined> {
  const result = await tx.execute({ sql, args: params });
  if (!result.rows.length) return undefined;
  return toObject<T>(result.rows[0], result.columns);
}
