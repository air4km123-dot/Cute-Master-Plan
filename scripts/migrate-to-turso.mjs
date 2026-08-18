/**
 * Copy the local working database into Turso, preserving every identifier.
 *
 *   data/air4.db  →  read with better-sqlite3 (offline tooling only)
 *   Turso         →  written with @libsql/client
 *
 * Nothing is regenerated. Permanent Project IDs, connection IDs, user IDs,
 * audit row IDs, timestamps, review states and layout positions are all carried
 * across exactly as they are — a migration that reissued an ID would break every
 * relationship, permission and audit row that points at it.
 *
 * Tables are written parents-first so foreign keys resolve as they go.
 *
 * Refuses to overwrite a Turso database that already holds projects unless
 * --force is passed, so a second accidental run cannot duplicate or clobber
 * live data.
 *
 * Usage:
 *   node scripts/migrate-to-turso.mjs            verify + migrate if empty
 *   node scripts/migrate-to-turso.mjs --force    wipe target first, then migrate
 *   node scripts/migrate-to-turso.mjs --verify   compare only, write nothing
 */
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

// .env.local is not loaded automatically outside Next, so parse it here.
for (const file of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["'](.*)["']$/s, "$1");
  }
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const verifyOnly = args.includes("--verify");

const url = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

if (!url) {
  console.error("TURSO_DATABASE_URL is not set. Add it to .env.local.");
  process.exit(1);
}
if (url.startsWith("libsql://") && !authToken) {
  console.error(
    "TURSO_AUTH_TOKEN is not set.\n" +
      "Create one with:  turso db tokens create cute-master-plan\n" +
      "then add it to .env.local as TURSO_AUTH_TOKEN=..."
  );
  process.exit(1);
}

const LOCAL = path.join(process.cwd(), "data", "air4.db");
if (!fs.existsSync(LOCAL)) {
  console.error(`No local database at ${LOCAL}.`);
  process.exit(1);
}

/**
 * Parents before children, so every foreign key has something to point at by
 * the time it is inserted.
 */
const ORDER = [
  "departments",
  "status_config",
  "connection_types",
  "users",
  "projects",
  "user_projects",
  "project_milestones",
  "connections",
  "audit_log",
  "sync_runs",
  "sync_conflicts",
];

const local = new Database(LOCAL, { readonly: true, fileMustExist: true });
const turso = createClient({ url, ...(authToken ? { authToken } : {}), intMode: "number" });

const localCount = (table) => {
  try {
    return local.prepare(`SELECT COUNT(*) c FROM "${table}"`).get().c;
  } catch {
    return null; // table does not exist locally
  }
};

const remoteCount = async (table) => {
  try {
    const r = await turso.execute(`SELECT COUNT(*) c FROM "${table}"`);
    return r.rows[0].c;
  } catch {
    return null; // table does not exist remotely
  }
};

async function report(label) {
  console.log(`\n${label}`);
  console.log(`${"table".padEnd(22)} ${"local".padStart(6)} ${"turso".padStart(6)}`);
  console.log("-".repeat(38));
  let ok = true;
  for (const table of ORDER) {
    const l = localCount(table);
    const r = await remoteCount(table);
    const match = l === r;
    if (l !== null && !match) ok = false;
    console.log(
      `${table.padEnd(22)} ${String(l ?? "—").padStart(6)} ${String(r ?? "—").padStart(6)}` +
        (l === null ? "  (not local)" : match ? "  ok" : "  MISMATCH")
    );
  }
  return ok;
}

if (verifyOnly) {
  const ok = await report("Verification only — nothing written.");
  await spotCheck();
  local.close();
  process.exit(ok ? 0 : 1);
}

// --------------------------------------------------------------------------
// Schema
// --------------------------------------------------------------------------

const schemaPath = path.join(process.cwd(), "src", "lib", "schema.sql");
const schema = fs
  .readFileSync(schemaPath, "utf8")
  .split(";")
  .map((chunk) =>
    chunk
      // Drop comment lines so a chunk that is only commentary is left empty
      // rather than sent to the server as a statement.
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
  )
  // PRAGMA is meaningless against a hosted database — Turso manages its own
  // journalling and enforces foreign keys itself.
  .filter((chunk) => chunk.length > 0 && !/^PRAGMA/i.test(chunk));

console.log(`Applying schema (${schema.length} statements) to Turso…`);
for (const statement of schema) {
  await turso.execute(statement);
}

// --------------------------------------------------------------------------
// Guard
// --------------------------------------------------------------------------

const existingProjects = (await remoteCount("projects")) ?? 0;
if (existingProjects > 0 && !force) {
  console.error(
    `\nRefusing to migrate: Turso already holds ${existingProjects} project(s).\n` +
      `Re-run with --force to replace them, or --verify to compare.`
  );
  local.close();
  process.exit(1);
}

if (existingProjects > 0 && force) {
  console.log(`\n--force: clearing ${existingProjects} existing project(s) and related rows…`);
  // Children first on the way out.
  for (const table of [...ORDER].reverse()) {
    try {
      await turso.execute(`DELETE FROM "${table}"`);
    } catch {
      /* table may not exist yet */
    }
  }
}

// --------------------------------------------------------------------------
// Copy
// --------------------------------------------------------------------------

const CHUNK = 50;
let totalRows = 0;

for (const table of ORDER) {
  const rows = (() => {
    try {
      return local.prepare(`SELECT * FROM "${table}"`).all();
    } catch {
      return null;
    }
  })();

  if (rows === null) {
    console.log(`${table.padEnd(22)} skipped (not present locally)`);
    continue;
  }
  if (!rows.length) {
    console.log(`${table.padEnd(22)} 0 rows`);
    continue;
  }

  const columns = Object.keys(rows[0]);
  const sql =
    `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) ` +
    `VALUES (${columns.map(() => "?").join(", ")})`;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK).map((row) => ({
      sql,
      args: columns.map((c) => (row[c] === undefined ? null : row[c])),
    }));
    await turso.batch(batch, "write");
  }

  totalRows += rows.length;
  console.log(`${table.padEnd(22)} ${String(rows.length).padStart(5)} rows`);
}

console.log(`\nCopied ${totalRows} rows.`);

// --------------------------------------------------------------------------
// Verify
// --------------------------------------------------------------------------

const ok = await report("Row count comparison");
await spotCheck();

local.close();

if (!ok) {
  console.error("\nRow counts do not match. Investigate before pointing production at Turso.");
  process.exit(1);
}
console.log("\nMigration verified. Turso matches the local working copy.");

async function spotCheck() {
  const ids = ["AF-001", "AF-007", "PG-005", "PG-010", "AS-002", "B2C-002", "BD-002"];
  console.log(`\nSpot check — permanent IDs and the values a sync must never reset:`);
  let allMatch = true;
  for (const id of ids) {
    const l = local
      .prepare(
        `SELECT project_id, dept_code, project_name, priority, status_id,
                progress_percent, project_type, connection_review_status
           FROM projects WHERE project_id = ?`
      )
      .get(id);
    const r = (
      await turso.execute({
        sql: `SELECT project_id, dept_code, project_name, priority, status_id,
                     progress_percent, project_type, connection_review_status
                FROM projects WHERE project_id = ?`,
        args: [id],
      })
    ).rows[0];

    if (!l) {
      console.log(`  ${id.padEnd(8)} not present locally`);
      continue;
    }
    const same = r && Object.keys(l).every((k) => String(l[k]) === String(r[k]));
    if (!same) allMatch = false;
    console.log(
      `  ${same ? "ok  " : "DIFF"} ${id.padEnd(8)} ${String(l.project_name).slice(0, 38).padEnd(38)} ` +
        `${l.dept_code}/${l.status_id}/P${l.priority}`
    );
  }
  if (!allMatch) console.log("  One or more projects differ — do not switch production over.");
}
