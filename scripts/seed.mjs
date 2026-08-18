/**
 * Air4 Master Plan — database seed.
 *
 * Loads the officially approved 44 projects from data/source/*.json into the
 * application database, creates login accounts, and stores the initial AI
 * architecture review as SUGGESTIONS awaiting human approval.
 *
 *   npm run seed        # create the database if it does not exist
 *   npm run reseed      # drop and rebuild it (--force)
 *
 * Passwords are never written to disk in plain text. The admin password is
 * taken from AIR4_ADMIN_PASSWORD, or generated and printed to this terminal
 * once. Every other account starts with no password and cannot log in until
 * an admin sets one from the Users page.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "air4.db");
const SRC = path.join(DATA_DIR, "source");

// Source spreadsheet recorded on every seeded project, so a project can be
// traced back to the tab it came from. Kept in step with src/lib/googleSheets.ts.
const SHEET_ID =
  process.env.GOOGLE_SPREADSHEET_ID ?? "1zby_FYFWKHXDLP5Q6Z74XD3A7Onpxvs7zsuuV-5kc-0";
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB ?? "สรุปโปรเจค";

const force = process.argv.includes("--force");
const now = () => new Date().toISOString();
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(SRC, f), "utf8"));

// --- guard rails -------------------------------------------------------

const PROJECT_ID_RE = /^[A-Z0-9]{2,4}-\d{3}$/;

function fail(msg) {
  console.error(`\n  Seed aborted: ${msg}\n`);
  process.exit(1);
}

// --- prepare -----------------------------------------------------------

fs.mkdirSync(DATA_DIR, { recursive: true });

if (fs.existsSync(DB_PATH)) {
  if (!force) {
    fail(
      `${DB_PATH} already exists.\n` +
        `  Run "npm run reseed" to rebuild it. This deletes all local edits and audit history.`
    );
  }
  try {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const f = DB_PATH + suffix;
      if (fs.existsSync(f)) fs.rmSync(f);
    }
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EBUSY") {
      fail(
        `the database file is open in another process.\n` +
          `  Stop the dev server (Ctrl+C in the "npm run dev" terminal), then run this again.`
      );
    }
    throw error;
  }
  console.log("  Existing database removed (--force).");
}

const config = readJson("departments.json");
const { projects } = readJson("projects.json");
const aiReview = readJson("ai-connections.json");

// Validate the source data before touching the database (§35).
const seenIds = new Set();
const deptCodes = new Set(config.departments.map((d) => d.dept_code));
const statusIds = new Set(config.statuses.map((s) => s.status_id));
const typeIds = new Set(config.connection_types.map((t) => t.type_id));

for (const p of projects) {
  if (!PROJECT_ID_RE.test(p.project_id)) fail(`invalid Project_ID "${p.project_id}"`);
  if (seenIds.has(p.project_id)) fail(`duplicate Project_ID "${p.project_id}"`);
  if (!p.project_id.startsWith(p.dept_code + "-"))
    fail(`Project_ID "${p.project_id}" does not match department "${p.dept_code}"`);
  if (!deptCodes.has(p.dept_code)) fail(`unknown department "${p.dept_code}" on ${p.project_id}`);
  if (!statusIds.has(p.status_id)) fail(`unknown status "${p.status_id}" on ${p.project_id}`);
  seenIds.add(p.project_id);
}
for (const c of aiReview.connections) {
  if (!seenIds.has(c.source)) fail(`connection source "${c.source}" is not a known project`);
  if (!seenIds.has(c.target)) fail(`connection target "${c.target}" is not a known project`);
  if (c.source === c.target) fail(`connection "${c.source}" points at itself`);
  if (!typeIds.has(c.type)) fail(`unknown connection type "${c.type}"`);
}

const db = new Database(DB_PATH);
db.exec(fs.readFileSync(path.join(ROOT, "src", "lib", "schema.sql"), "utf8"));

// --- audit helper ------------------------------------------------------

const insertAudit = db.prepare(`
  INSERT INTO audit_log (timestamp, user_id, username, action, entity_type, entity_id,
                         field_name, old_value, new_value, source, notes)
  VALUES (@timestamp, @user_id, @username, @action, @entity_type, @entity_id,
          @field_name, @old_value, @new_value, @source, @notes)
`);

function audit(action, entity_type, entity_id, notes) {
  insertAudit.run({
    timestamp: now(),
    user_id: "system",
    username: "system",
    action,
    entity_type,
    entity_id,
    field_name: null,
    old_value: null,
    new_value: null,
    source: "SEED_IMPORT",
    notes: notes ?? null,
  });
}

// --- configuration tables ---------------------------------------------

const insertDept = db.prepare(`
  INSERT INTO departments (dept_code, dept_name_th, dept_name_en, color, head_name, display_order, active)
  VALUES (@dept_code, @dept_name_th, @dept_name_en, @color, @head_name, @display_order, 1)
`);
const insertStatus = db.prepare(`
  INSERT INTO status_config (status_id, status_name, display_order, color, active)
  VALUES (@status_id, @status_name, @display_order, @color, 1)
`);
const insertType = db.prepare(`
  INSERT INTO connection_types (type_id, type_name, color, display_order, active)
  VALUES (@type_id, @type_name, @color, @display_order, 1)
`);

// --- users -------------------------------------------------------------

const insertUser = db.prepare(`
  INSERT INTO users (user_id, username, password_hash, display_name, role,
                     department_id, must_set_password, active, created_at)
  VALUES (@user_id, @username, @password_hash, @display_name, @role,
          @department_id, @must_set_password, 1, @created_at)
`);

const adminPassword =
  process.env.AIR4_ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
const generatedAdminPassword = !process.env.AIR4_ADMIN_PASSWORD;

if (adminPassword.length < 8) fail("AIR4_ADMIN_PASSWORD must be at least 8 characters");

// bcrypt cost 12 — deliberate work factor for password storage.
const adminHash = bcrypt.hashSync(adminPassword, 12);

// --- projects & connections -------------------------------------------

const insertProject = db.prepare(`
  INSERT INTO projects (
    project_id, source_seq, dept_code, project_name, project_type, phase, priority,
    owner_user_id, owner_name, objective, brief, notes,
    status_id, status_original, next_step, progress_percent,
    use_checkpoints, checkpoint_due_date, final_due_date,
    connection_review_status,
    source_sheet_id, source_tab, source_dept, source_state,
    active, created_at, updated_at, updated_by
  ) VALUES (
    @project_id, @source_seq, @dept_code, @project_name, 'APPROVED', 'PHASE_1', @priority,
    @owner_user_id, @owner_name, NULL, @brief, @notes,
    @status_id, @status_original, @next_step, 0,
    0, NULL, NULL,
    'AI_REVIEWED',
    @source_sheet_id, @source_tab, @source_dept, 'PRESENT',
    1, @created_at, @updated_at, 'system'
  )
`);

const insertGrant = db.prepare(`
  INSERT OR IGNORE INTO user_projects (user_id, project_id, granted_by, granted_at)
  VALUES (@user_id, @project_id, 'system', @granted_at)
`);

const insertConnection = db.prepare(`
  INSERT INTO connections (
    connection_id, source_project_id, target_project_id, direction, connection_type,
    connection_label, detailed_description, data_or_process_name, connection_status,
    proposed_by, reviewed_by, review_date, confidence, reason,
    active, created_at, updated_at, updated_by
  ) VALUES (
    @connection_id, @source, @target, @direction, @type,
    @label, NULL, @label, 'AI_SUGGESTED',
    @proposed_by, NULL, NULL, @confidence, @reason,
    1, @created_at, @updated_at, 'system'
  )
`);

const run = db.transaction(() => {
  const ts = now();

  for (const d of config.departments) insertDept.run(d);
  for (const s of config.statuses) insertStatus.run(s);
  for (const t of config.connection_types) insertType.run(t);

  // Admin account.
  insertUser.run({
    user_id: "USR-ADMIN",
    username: "admin",
    password_hash: adminHash,
    display_name: "Air4 Administrator",
    role: "ADMIN",
    department_id: null,
    must_set_password: 0,
    created_at: ts,
  });
  audit("CREATE_USER", "USER", "USR-ADMIN", "Admin account created by seed");

  // One account per ผู้รับผิดชอบ in the sheet. No password is set: these
  // accounts cannot authenticate until an admin sets one (§1 security).
  const owners = new Map();
  for (const p of projects) {
    if (!owners.has(p.owner_username)) {
      owners.set(p.owner_username, { name: p.owner_name, dept: p.dept_code });
    }
  }

  let n = 0;
  for (const [username, info] of owners) {
    const user_id = `USR-${String(++n).padStart(3, "0")}`;
    insertUser.run({
      user_id,
      username,
      password_hash: "",
      display_name: info.name,
      role: "OWNER",
      department_id: info.dept,
      must_set_password: 1,
      created_at: ts,
    });
    audit("CREATE_USER", "USER", user_id, `Project owner account for ${info.name} (no password set)`);
    info.user_id = user_id;
  }

  // A viewer account for executives and meeting/presentation use.
  insertUser.run({
    user_id: "USR-VIEWER",
    username: "viewer",
    password_hash: "",
    display_name: "Air4 Viewer",
    role: "VIEWER",
    department_id: null,
    must_set_password: 1,
    created_at: ts,
  });
  audit("CREATE_USER", "USER", "USR-VIEWER", "Shared viewer account (no password set)");

  // Projects.
  for (const p of projects) {
    const owner = owners.get(p.owner_username);
    insertProject.run({
      project_id: p.project_id,
      source_seq: p.seq,
      dept_code: p.dept_code,
      project_name: p.name,
      priority: p.priority ?? null,
      owner_user_id: owner?.user_id ?? null,
      owner_name: p.owner_name ?? null,
      brief: p.brief || null,
      // notes mirrors หมายเหตุจากที่ประชุม and is owned by the sheet, so nothing
      // internal may live here — a sync would legitimately overwrite it. The
      // sheet's own department code (CS1 / CS2) goes in source_dept instead.
      notes: p.notes || null,
      status_id: p.status_id,
      status_original: p.status_original || null,
      next_step: p.next_step || null,
      source_sheet_id: SHEET_ID,
      source_tab: SHEET_TAB,
      source_dept: p.source_dept ?? p.dept_code,
      created_at: ts,
      updated_at: ts,
    });
    if (owner?.user_id) {
      insertGrant.run({ user_id: owner.user_id, project_id: p.project_id, granted_at: ts });
    }
    audit("IMPORT_PROJECT", "PROJECT", p.project_id, `Imported from source sheet row ${p.seq}`);
  }

  // AI-suggested connections — not architecture until approved (§12).
  let c = 0;
  for (const conn of aiReview.connections) {
    const connection_id = `CON-${String(++c).padStart(3, "0")}`;
    insertConnection.run({
      connection_id,
      source: conn.source,
      target: conn.target,
      direction: conn.direction || "ONE_WAY",
      type: conn.type,
      label: conn.label,
      confidence: conn.confidence,
      reason: conn.reason,
      proposed_by: aiReview._proposed_by,
      created_at: ts,
      updated_at: ts,
    });
    audit(
      "AI_SUGGEST_CONNECTION",
      "CONNECTION",
      connection_id,
      `${conn.source} → ${conn.target} (${conn.label}) — awaiting human review`
    );
  }

  audit(
    "INITIAL_AI_REVIEW",
    "SYSTEM",
    null,
    `Initial architecture review covered ${projects.length} projects and produced ${c} suggestions`
  );
});

run();

// --- .env.local --------------------------------------------------------

const envPath = path.join(ROOT, ".env.local");
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(
    envPath,
    `# Air4 Master Plan — local secrets. Never commit this file.\n` +
      `AUTH_SECRET=${crypto.randomBytes(32).toString("hex")}\n`,
    { mode: 0o600 }
  );
  console.log("  Created .env.local with a fresh AUTH_SECRET.");
}

// --- report ------------------------------------------------------------

const count = (sql) => db.prepare(sql).get().n;
console.log(`
  Air4 Master Plan database ready — ${DB_PATH}

    Departments        ${count("SELECT COUNT(*) n FROM departments")}
    Statuses           ${count("SELECT COUNT(*) n FROM status_config")}
    Projects           ${count("SELECT COUNT(*) n FROM projects")}  (all APPROVED, solid border)
    User accounts      ${count("SELECT COUNT(*) n FROM users")}
    AI suggestions     ${count("SELECT COUNT(*) n FROM connections WHERE connection_status = 'AI_SUGGESTED'")}  (awaiting human review)
    Approved conns     ${count("SELECT COUNT(*) n FROM connections WHERE connection_status IN ('APPROVED','EDITED')")}
    Audit entries      ${count("SELECT COUNT(*) n FROM audit_log")}
`);

if (generatedAdminPassword) {
  console.log(`  Sign in as:  admin  /  ${adminPassword}`);
  console.log(`  This password is shown once and is not stored anywhere in plain text.`);
  console.log(`  Change it from the Users page after signing in.\n`);
} else {
  console.log(`  Sign in as:  admin  /  (the value of AIR4_ADMIN_PASSWORD)\n`);
}
console.log(
  `  All other accounts (project owners, viewer) have no password yet and cannot\n` +
    `  sign in. Set passwords for them from the Users page as admin.\n`
);

db.close();
