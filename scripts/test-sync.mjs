/**
 * End-to-end read/write test suite for Google Sheet sync.
 *
 * Everything here runs against a COPY of the live database. data/air4.db is
 * opened once, read-only, to be copied, and is never written to by this script:
 * the destructive scenarios — a department change, a row disappearing — need a
 * database they are allowed to damage.
 *
 * The sheet is a local fixture rewritten between scenarios, so a "someone edited
 * the sheet" event can be simulated exactly and repeatably without touching the
 * real spreadsheet. The engine itself is exercised through the real HTTP API
 * against a real server, with a real session cookie — not by importing internals.
 *
 * Usage:  node scripts/test-sync.mjs
 */
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const ROOT = process.cwd();
const PORT = 3401;
const BASE = `http://127.0.0.1:${PORT}`;

const LIVE_DB = path.join(ROOT, "data", "air4.db");
const TEST_DIR = path.join(ROOT, "data", "test");
const TEST_DB = path.join(TEST_DIR, "air4-test.db");
const FIXTURE = path.join(TEST_DIR, "sheet-test.tsv");
const BASE_FIXTURE = path.join(ROOT, "data", "fixtures", "sheet-current.tsv");

const ADMIN_USER = "admin";
const ADMIN_PASS = "TestOnlyPassword2026";
const VIEWER_USER = "viewer";
const VIEWER_PASS = "TestOnlyViewer2026";

// ---------------------------------------------------------------------------
// Tiny assertion harness
// ---------------------------------------------------------------------------

const results = [];
let current = "—";

function scenario(name) {
  current = name;
  console.log(`\n── ${name}`);
}

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ scenario: current, label, ok, actual, expected });
  console.log(
    `   ${ok ? "PASS" : "FAIL"}  ${label}` +
      (ok ? `  (${JSON.stringify(actual)})` : `\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`)
  );
  return ok;
}

function checkThat(label, condition, detail = "") {
  results.push({ scenario: current, label, ok: !!condition, actual: detail, expected: "true" });
  console.log(`   ${condition ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return !!condition;
}

// ---------------------------------------------------------------------------
// Fixture helpers — the sheet as a grid we can edit
// ---------------------------------------------------------------------------

const COL = { seq: 0, dept: 1, name: 2, priority: 3, owner: 4, brief: 5, status: 6, notes: 7 };

function loadGrid() {
  return fs
    .readFileSync(BASE_FIXTURE, "utf8")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.split("\t"));
}

function writeGrid(grid) {
  fs.writeFileSync(FIXTURE, grid.map((row) => row.join("\t")).join("\n") + "\n", "utf8");
}

/** Index of the row whose ชื่อ Project cell matches, in the mutable grid. */
function rowByName(grid, name) {
  const index = grid.findIndex((row) => (row[COL.name] ?? "").trim() === name);
  if (index === -1) throw new Error(`Fixture has no row named "${name}"`);
  return index;
}

/** Reset the fixture to a faithful copy of the current sheet. */
function resetFixture() {
  writeGrid(loadGrid());
}

// ---------------------------------------------------------------------------
// Database helpers (test copy only)
// ---------------------------------------------------------------------------

function openTestDb() {
  return new Database(TEST_DB);
}

function projectRow(projectId) {
  const db = openTestDb();
  const row = db.prepare(`SELECT * FROM projects WHERE project_id = ?`).get(projectId);
  db.close();
  return row;
}

function scalar(sql, params = []) {
  const db = openTestDb();
  const value = Object.values(db.prepare(sql).get(...params))[0];
  db.close();
  return value;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

let cookie = "";

async function login(username, password) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function api(pathname, method = "POST") {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { cookie, "Content-Type": "application/json" },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const checkSheet = () => api("/api/sync/google-sheet/check");
const applySheet = () => api("/api/sync/google-sheet/apply");

/**
 * Return the fixture to the real sheet and let the database catch up, so the
 * next scenario starts from a known in-step state.
 *
 * Scenarios mutate the database cumulatively — scenario 4 leaves IS-002 with a
 * different owner than the sheet has. Without this, every later scenario would
 * see those leftovers as pending changes and global counts would be meaningless.
 * Settling also doubles as a convergence test: applying twice must reach zero.
 */
async function settle() {
  resetFixture();
  await checkSheet();
  await applySheet();
  const { body } = await checkSheet();
  if (body?.plan?.summary?.changed !== 0) {
    throw new Error(
      `settle() did not converge: ${body?.plan?.summary?.changed} project(s) still differ`
    );
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function prepareTestDatabase() {
  killPort(PORT);
  if (!fs.existsSync(LIVE_DB)) throw new Error(`No live database at ${LIVE_DB}`);
  fs.mkdirSync(TEST_DIR, { recursive: true });

  // Checkpoint the WAL so the copy includes every committed row, then close.
  const live = new Database(LIVE_DB, { readonly: false });
  live.pragma("wal_checkpoint(TRUNCATE)");
  live.close();

  for (const suffix of ["", "-wal", "-shm"]) {
    const from = LIVE_DB + suffix;
    const to = TEST_DB + suffix;
    if (fs.existsSync(to)) fs.rmSync(to);
    if (fs.existsSync(from)) fs.copyFileSync(from, to);
  }

  // Give the test copy known credentials. Only the copy is affected.
  const db = openTestDb();
  db.prepare(`UPDATE users SET password_hash = ?, active = 1 WHERE username = ?`).run(
    bcrypt.hashSync(ADMIN_PASS, 12),
    ADMIN_USER
  );
  db.prepare(`UPDATE users SET password_hash = ?, active = 1 WHERE username = ?`).run(
    bcrypt.hashSync(VIEWER_PASS, 12),
    VIEWER_USER
  );
  const counts = {
    projects: db.prepare(`SELECT COUNT(*) c FROM projects`).get().c,
    connections: db.prepare(`SELECT COUNT(*) c FROM connections`).get().c,
    audit: db.prepare(`SELECT COUNT(*) c FROM audit_log`).get().c,
  };
  db.close();
  return counts;
}

let server;

/**
 * Kill anything already listening on the test port.
 *
 * `next dev` spawns a child that outlives a plain kill of the npx wrapper, and
 * on Windows an orphan keeps an exclusive handle on the SQLite file — the next
 * run then fails to copy the database with EPERM. Clearing the port first makes
 * the suite re-runnable after an interrupted run.
 */
function killPort(port) {
  if (process.platform !== "win32") {
    spawnSync("bash", ["-c", `lsof -ti tcp:${port} | xargs -r kill -9`], { stdio: "ignore" });
    return;
  }
  // PowerShell resolves the owning PIDs directly, which avoids parsing netstat.
  const script =
    `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | ` +
    `Select-Object -ExpandProperty OwningProcess -Unique | ` +
    `ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`;
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: "ignore",
  });
}

async function startServer() {
  server = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["next", "dev", "-p", String(PORT)],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        AIR4_DB_PATH: path.relative(ROOT, TEST_DB),
        AIR4_SHEET_FIXTURE: path.relative(ROOT, FIXTURE),
        SYNC_CRON_SECRET: process.env.SYNC_CRON_SECRET,
        NODE_ENV: "development",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    }
  );

  let log = "";
  server.stdout.on("data", (d) => (log += d.toString()));
  server.stderr.on("data", (d) => (log += d.toString()));

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/sync/google-sheet/status`);
      if (response.status === 401 || response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`Server did not start within 120s.\n${log.slice(-3000)}`);
}

function stopServer() {
  if (server) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(server.pid), "/f", "/t"], { stdio: "ignore" });
    } else {
      server.kill("SIGTERM");
    }
  }
  // The wrapper's children can outlive it; clear the port so the file handle goes.
  killPort(PORT);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function run() {
  const baseline = prepareTestDatabase();
  console.log(
    `Test database ready: ${baseline.projects} projects, ${baseline.connections} connections, ${baseline.audit} audit rows.`
  );

  resetFixture();
  await startServer();
  console.log(`Server up on ${BASE} (test DB + fixture sheet).`);

  // -------------------------------------------------------------------------
  scenario("Auth · admin can sync, viewer cannot");
  const anon = await checkSheet();
  check("anonymous check is refused", anon.status, 401);

  const viewerLogin = await login(VIEWER_USER, VIEWER_PASS);
  check("viewer signs in", viewerLogin.status, 200);
  const viewerSync = await checkSheet();
  check("viewer check is forbidden", viewerSync.status, 403);
  const viewerApply = await applySheet();
  check("viewer apply is forbidden", viewerApply.status, 403);

  // Visibility is company-wide, not departmental.
  const viewerPlan = await api("/api/master-plan", "GET");
  const viewerDepts = new Set((viewerPlan.body?.projects ?? []).map((p) => p.dept_code));
  check("viewer sees all 44 projects", viewerPlan.body?.projects?.length, 44);
  check("viewer sees all 12 departments", viewerDepts.size, 12);
  check("viewer sees all 53 connections", viewerPlan.body?.connections?.length, 53);
  check("viewer may edit nothing", viewerPlan.body?.editableProjectIds?.length, 0);

  const adminLogin = await login(ADMIN_USER, ADMIN_PASS);
  check("admin signs in", adminLogin.status, 200);
  const adminPlan = await api("/api/master-plan", "GET");
  const adminDepts = new Set((adminPlan.body?.projects ?? []).map((p) => p.dept_code));
  check("admin sees all 12 departments", adminDepts.size, 12);
  check("admin may edit every project", adminPlan.body?.editableProjectIds?.length, 44);

  // -------------------------------------------------------------------------
  scenario("1 · Baseline — sheet matches database");
  let response = await checkSheet();
  check("check succeeds", response.status, 200);
  let plan = response.body.plan;
  check("44 rows read", plan.summary.rowsRead, 44);
  check("44 matched", plan.summary.matched, 44);
  check("0 changed", plan.summary.changed, 0);
  check("44 unchanged", plan.summary.unchanged, 44);
  check("0 new rows", plan.summary.newRows, 0);
  check("0 missing", plan.summary.missing, 0);
  check("0 conflicts", plan.summary.conflicts, 0);
  check("0 warnings", plan.summary.warnings, 0);

  scenario("12 · No change writes nothing");
  const auditBefore = scalar(`SELECT COUNT(*) c FROM audit_log`);
  const updatedBefore = projectRow("AF-007").updated_at;
  response = await applySheet();
  check("apply succeeds", response.status, 200);
  check("no fields written", response.body.appliedFields, 0);
  check("no projects touched", response.body.appliedProjects, 0);
  check("no audit rows added", scalar(`SELECT COUNT(*) c FROM audit_log`), auditBefore);
  check("updated_at untouched", projectRow("AF-007").updated_at, updatedBefore);

  // -------------------------------------------------------------------------
  scenario("6+7+8 · Local system data is preserved across a sync");
  // Give AF-007 the kind of local data a sync must never reset.
  {
    const db = openTestDb();
    db.prepare(
      `UPDATE projects SET progress_percent = 65, checkpoint_due_date = '2026-09-30',
                           final_due_date = '2026-12-31', data_owner = 'ออม',
                           system_owner = 'เอ็กซ์', layout_x = 480.5, layout_y = 220.25
        WHERE project_id = 'AF-007'`
    ).run();
    db.close();
  }
  const localBefore = projectRow("AF-007");
  const connectionsBefore = scalar(`SELECT COUNT(*) c FROM connections`);
  const af007ConnectionsBefore = scalar(
    `SELECT COUNT(*) c FROM connections WHERE source_project_id = 'AF-007' OR target_project_id = 'AF-007'`
  );
  checkThat("AF-007 has connections to protect", af007ConnectionsBefore > 0, `${af007ConnectionsBefore}`);

  // -------------------------------------------------------------------------
  scenario("2+3+4+5 · Brief, priority, owner and status sync");
  {
    const grid = loadGrid();
    const row = rowByName(grid, "Management Budget Dashboard");
    grid[row][COL.brief] = "จัดทำ Dashboard ผู้บริหาร รวมงบ BU และ Cash Flow ฉบับปรับปรุง 2569";
    grid[row][COL.priority] = "5";
    grid[row][COL.owner] = "แก้ว";
    grid[row][COL.status] = "กำลังดำเนินการ";
    grid[row][COL.notes] = "ปรับ Priority ตามมติที่ประชุม";
    writeGrid(grid);
  }
  response = await checkSheet();
  plan = response.body.plan;
  check("1 project changed", plan.summary.changed, 1);
  check("43 unchanged", plan.summary.unchanged, 43);
  check("0 conflicts", plan.summary.conflicts, 0);

  const af007 = plan.projects.find((p) => p.projectId === "AF-007");
  const fields = Object.fromEntries(af007.changes.map((c) => [c.field, [c.before, c.after]]));
  check("priority 4 → 5", fields.priority, ["4", "5"]);
  check("owner อ๊อฟ → แก้ว", fields.owner_name, ["อ๊อฟ", "แก้ว"]);
  check("status_original changed", fields.status_original?.[1], "กำลังดำเนินการ");
  check("status_id PLANNING → DEVELOPING", fields.status_id, ["PLANNING", "DEVELOPING"]);
  checkThat("brief changed", !!fields.brief, fields.brief?.[1]?.slice(0, 30));
  checkThat("notes changed", !!fields.notes, fields.notes?.[1]);
  checkThat("every change is safe to apply", af007.changes.every((c) => c.safe));

  response = await applySheet();
  check("apply touched 1 project", response.body.appliedProjects, 1);
  check("apply wrote 6 fields", response.body.appliedFields, 6);

  const after = projectRow("AF-007");
  check("priority written", after.priority, 5);
  check("owner written", after.owner_name, "แก้ว");
  check("status_id written", after.status_id, "DEVELOPING");
  check("status_original written", after.status_original, "กำลังดำเนินการ");
  checkThat("brief written", after.brief.includes("ฉบับปรับปรุง 2569"));

  // The whole point: internal data survived.
  check("Project ID unchanged", after.project_id, "AF-007");
  check("progress NOT reset", after.progress_percent, 65);
  check("checkpoint NOT reset", after.checkpoint_due_date, "2026-09-30");
  check("final due date NOT reset", after.final_due_date, "2026-12-31");
  check("data owner NOT reset", after.data_owner, "ออม");
  check("system owner NOT reset", after.system_owner, "เอ็กซ์");
  check("layout NOT reset", [after.layout_x, after.layout_y], [480.5, 220.25]);
  check("project type NOT reset", after.project_type, localBefore.project_type);
  check("connection review NOT reset", after.connection_review_status, localBefore.connection_review_status);
  check("connections intact", scalar(`SELECT COUNT(*) c FROM connections`), connectionsBefore);
  check(
    "AF-007 connections intact",
    scalar(
      `SELECT COUNT(*) c FROM connections WHERE source_project_id = 'AF-007' OR target_project_id = 'AF-007'`
    ),
    af007ConnectionsBefore
  );

  scenario("13 · Audit log records every applied field");
  const auditRows = (() => {
    const db = openTestDb();
    const rows = db
      .prepare(
        `SELECT field_name, old_value, new_value, source, action FROM audit_log
          WHERE entity_id = 'AF-007' AND action = 'GOOGLE_SHEET_SYNC' ORDER BY audit_id`
      )
      .all();
    db.close();
    return rows;
  })();
  check("6 audit rows written", auditRows.length, 6);
  check("action is GOOGLE_SHEET_SYNC", [...new Set(auditRows.map((r) => r.action))], ["GOOGLE_SHEET_SYNC"]);
  check("source is GOOGLE_SHEET", [...new Set(auditRows.map((r) => r.source))], ["GOOGLE_SHEET"]);
  const priorityAudit = auditRows.find((r) => r.field_name === "priority");
  check("priority before/after recorded", [priorityAudit.old_value, priorityAudit.new_value], ["4", "5"]);

  // -------------------------------------------------------------------------
  scenario("5b · Unknown status is never guessed");
  await settle();
  {
    const grid = loadGrid();
    const row = rowByName(grid, "Employee Data Hub");
    grid[row][COL.status] = "รอผู้บริหารอนุมัติงบ";
    writeGrid(grid);
  }
  response = await checkSheet();
  plan = response.body.plan;
  const unknownStatus = plan.conflicts.find((c) => c.type === "UNKNOWN_STATUS");
  checkThat("UNKNOWN_STATUS warning raised", !!unknownStatus, unknownStatus?.projectId);
  check("severity is WARNING", unknownStatus?.severity, "WARNING");
  const pg010 = plan.projects.find((p) => p.projectId === "PG-010");
  checkThat(
    "status_id is not in the change list",
    !pg010.changes.some((c) => c.field === "status_id")
  );
  checkThat(
    "status_original still applies",
    pg010.changes.some((c) => c.field === "status_original" && c.safe)
  );
  const pg010StatusBefore = projectRow("PG-010").status_id;
  await applySheet();
  check("status_id left alone", projectRow("PG-010").status_id, pg010StatusBefore);
  check("status_original kept verbatim", projectRow("PG-010").status_original, "รอผู้บริหารอนุมัติงบ");

  // -------------------------------------------------------------------------
  scenario("4b · Unknown owner warns but is still stored as metadata");
  await settle();
  {
    const grid = loadGrid();
    grid[rowByName(grid, "Graphic Asset Library")][COL.owner] = "สมชาย";
    writeGrid(grid);
  }
  response = await checkSheet();
  plan = response.body.plan;
  const unknownOwner = plan.conflicts.find((c) => c.type === "UNKNOWN_OWNER");
  checkThat("UNKNOWN_OWNER warning raised", !!unknownOwner, unknownOwner?.sheetValue);
  check("severity is WARNING", unknownOwner?.severity, "WARNING");
  await applySheet();
  check("owner name stored", projectRow("IS-002").owner_name, "สมชาย");
  check("no account was created", scalar(`SELECT COUNT(*) c FROM users WHERE display_name = 'สมชาย'`), 0);

  // -------------------------------------------------------------------------
  scenario("Rename · Project ID survives, matched by sequence");
  await settle();
  {
    const grid = loadGrid();
    grid[rowByName(grid, "Strategic Data Intelligence")][COL.name] = "Strategic Market Intelligence";
    writeGrid(grid);
  }
  response = await checkSheet();
  plan = response.body.plan;
  const renamed = plan.projects.find((p) => p.projectId === "BD-002");
  checkThat("BD-002 still matched after rename", !!renamed, renamed?.state);
  check("44 still matched", plan.summary.matched, 44);
  check("no new project invented", plan.summary.newRows, 0);
  check("nothing reported missing", plan.summary.missing, 0);
  check(
    "name change is the only change",
    renamed.changes.map((c) => c.field),
    ["project_name"]
  );
  await applySheet();
  const bd002 = projectRow("BD-002");
  check("new name written", bd002.project_name, "Strategic Market Intelligence");
  check("Project ID unchanged", bd002.project_id, "BD-002");
  check("department unchanged", bd002.dept_code, "BD");
  check("44 projects still", scalar(`SELECT COUNT(*) c FROM projects`), 44);

  // -------------------------------------------------------------------------
  scenario("11 · Department change is a critical conflict");
  await settle();
  {
    const grid = loadGrid();
    grid[rowByName(grid, "Management Budget Dashboard")][COL.dept] = "BD";
    grid[rowByName(grid, "Management Budget Dashboard")][COL.priority] = "1";
    writeGrid(grid);
  }
  response = await checkSheet();
  plan = response.body.plan;
  const deptConflict = plan.conflicts.find((c) => c.type === "DEPARTMENT_CHANGE");
  checkThat("DEPARTMENT_CHANGE raised", !!deptConflict, `${deptConflict?.currentValue} → ${deptConflict?.sheetValue}`);
  check("severity is CRITICAL", deptConflict?.severity, "CRITICAL");
  check("conflict count is 1", plan.summary.conflicts, 1);
  const blocked = plan.projects.find((p) => p.projectId === "AF-007");
  check("project is BLOCKED", blocked.state, "BLOCKED");
  checkThat("no change on it is applicable", blocked.changes.every((c) => !c.safe));
  check("AF-007 contributes nothing to write", blocked.changes.filter((c) => c.safe).length, 0);

  const beforeDept = projectRow("AF-007");
  response = await applySheet();
  check("1 project skipped as blocked", response.body.skippedBlocked, 1);
  checkThat(
    "AF-007 was not among the applied projects",
    !response.body.plan.projects.some((p) => p.projectId === "AF-007" && p.state === "CHANGED")
  );
  const afterDept = projectRow("AF-007");
  check("department unchanged", afterDept.dept_code, "AF");
  check("Project ID unchanged", afterDept.project_id, "AF-007");
  check("priority not applied either", afterDept.priority, beforeDept.priority);

  // -------------------------------------------------------------------------
  scenario("10 · New sheet row is never auto-approved");
  await settle();
  {
    const grid = loadGrid();
    grid.push([
      "45",
      "IS",
      "AI Sales Forecast Assistant",
      "4",
      "เอ็กซ์",
      "ทดลองใช้ AI พยากรณ์ยอดขายรายเดือน",
      "ศึกษารายละเอียดก่อนเริ่ม",
      "เพิ่มใหม่จากที่ประชุม",
    ]);
    writeGrid(grid);
  }
  response = await checkSheet();
  plan = response.body.plan;
  check("45 rows read", plan.summary.rowsRead, 45);
  check("1 new source row", plan.summary.newRows, 1);
  check("still 44 matched", plan.summary.matched, 44);
  const newRow = plan.newRows[0];
  check("new row identified", newRow.name, "AI Sales Forecast Assistant");
  const newFlag = plan.conflicts.find((c) => c.type === "NEW_SOURCE_PROJECT");
  checkThat("NEW_SOURCE_PROJECT raised", !!newFlag);
  check("held as a warning, not applied", newFlag?.severity, "WARNING");

  await applySheet();
  check("still 44 projects — nothing created", scalar(`SELECT COUNT(*) c FROM projects`), 44);
  check(
    "no IS-005 was issued",
    scalar(`SELECT COUNT(*) c FROM projects WHERE project_id = 'IS-005'`),
    0
  );

  // -------------------------------------------------------------------------
  scenario("9 · Missing row is flagged, never deleted");
  await settle();
  {
    const grid = loadGrid();
    grid.splice(rowByName(grid, "Injector Troubleshooting"), 1);
    writeGrid(grid);
  }
  const sv003ConnectionsBefore = scalar(
    `SELECT COUNT(*) c FROM connections WHERE source_project_id = 'SV-003' OR target_project_id = 'SV-003'`
  );
  response = await checkSheet();
  plan = response.body.plan;
  check("43 rows read", plan.summary.rowsRead, 43);
  check("1 missing", plan.summary.missing, 1);
  check("0 new rows", plan.summary.newRows, 0);
  const missingFlag = plan.conflicts.find((c) => c.type === "SOURCE_MISSING");
  check("SOURCE_MISSING is for SV-003", missingFlag?.projectId, "SV-003");
  check("severity is WARNING", missingFlag?.severity, "WARNING");

  await applySheet();
  const sv003 = projectRow("SV-003");
  checkThat("SV-003 still exists", !!sv003);
  check("flagged SOURCE_MISSING", sv003.source_state, "SOURCE_MISSING");
  check("still active — not archived", sv003.active, 1);
  check("still 44 projects", scalar(`SELECT COUNT(*) c FROM projects`), 44);
  check(
    "connections intact",
    scalar(
      `SELECT COUNT(*) c FROM connections WHERE source_project_id = 'SV-003' OR target_project_id = 'SV-003'`
    ),
    sv003ConnectionsBefore
  );
  check("all 53 connections intact", scalar(`SELECT COUNT(*) c FROM connections`), connectionsBefore);

  scenario("9b · Reappearing row recovers to PRESENT");
  await settle();
  check("back to PRESENT", projectRow("SV-003").source_state, "PRESENT");

  // -------------------------------------------------------------------------
  scenario("16 · AI connections are untouched by sync");
  check(
    "53 connections, all still AI_SUGGESTED",
    scalar(`SELECT COUNT(*) c FROM connections WHERE connection_status = 'AI_SUGGESTED'`),
    53
  );
  check(
    "sync never approved one",
    scalar(`SELECT COUNT(*) c FROM connections WHERE connection_status IN ('APPROVED','EDITED')`),
    0
  );
  check(
    "no sync audit row mentions a connection",
    scalar(
      `SELECT COUNT(*) c FROM audit_log WHERE action = 'GOOGLE_SHEET_SYNC' AND entity_type = 'CONNECTION'`
    ),
    0
  );

  scenario("Audit history is append-only and intact");
  checkThat(
    "original 136 audit rows still present",
    scalar(`SELECT COUNT(*) c FROM audit_log`) >= baseline.audit,
    `now ${scalar(`SELECT COUNT(*) c FROM audit_log`)}, was ${baseline.audit}`
  );
  check(
    "original AI_SUGGEST_CONNECTION rows intact",
    scalar(`SELECT COUNT(*) c FROM audit_log WHERE action = 'AI_SUGGEST_CONNECTION'`),
    53
  );
  check(
    "original IMPORT_PROJECT rows intact",
    scalar(`SELECT COUNT(*) c FROM audit_log WHERE action = 'IMPORT_PROJECT'`),
    44
  );

  scenario("Last sync information");
  const status = (await api("/api/sync/google-sheet/status", "GET")).body;
  checkThat("last check recorded", !!status.lastCheck, status.lastCheck?.started_at);
  checkThat("last apply recorded", !!status.lastApply, status.lastApply?.started_at);
  check("source mode is the fixture", status.sourceMode, "FIXTURE");
  checkThat("run history kept", status.recent.length > 1, `${status.recent.length} runs`);

  // -------------------------------------------------------------------------
  scenario("Auto sync endpoint · secret is enforced");
  {
    const url = `${BASE}/api/sync/google-sheet/auto`;
    const post = (headers) => fetch(url, { method: "POST", headers }).then((r) => r.status);

    check("no token is rejected", await post({}), 401);
    check("wrong token is rejected", await post({ Authorization: "Bearer wrong-token" }), 401);
    check("a session cookie alone is not enough", await post({ cookie }), 401);
    check(
      "correct token is accepted",
      await post({ Authorization: `Bearer ${process.env.SYNC_CRON_SECRET}` }),
      200
    );
  }

  // -------------------------------------------------------------------------
  resetFixture();
}

// ---------------------------------------------------------------------------

try {
  await run();
} catch (error) {
  console.error(`\nHarness error: ${error.message}`);
  results.push({ scenario: current, label: `harness: ${error.message}`, ok: false });
} finally {
  stopServer();
}

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);

console.log(`\n${"=".repeat(64)}`);
console.log(`${passed}/${results.length} checks passed`);
if (failed.length) {
  console.log(`\nFailures:`);
  for (const f of failed) console.log(`  · [${f.scenario}] ${f.label}`);
}
console.log(`${"=".repeat(64)}`);

process.exit(failed.length ? 1 : 0);
