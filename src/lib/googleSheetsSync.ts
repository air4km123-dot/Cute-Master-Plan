import "server-only";
import fs from "node:fs";
import path from "node:path";
import { all, db, get } from "./db";
import { recordAudit } from "./audit";
import { fetchSheetGrid, sheetConfig, type SheetConfig, type SheetGrid } from "./googleSheets";
import type { Project, SessionUser } from "./types";

/**
 * Google Sheet → SQLite synchronisation.
 *
 *   fetchSheetProjects()      read the tab and cut it into rows
 *   normalizeSheetProject()   one raw row → a typed, validated source record
 *   matchPermanentProject()   source row → existing permanent Project_ID
 *   compareChanges()          field-by-field diff against the working copy
 *   generateSyncPlan()        everything above, assembled and classified
 *   applySyncPlan()           write the safe subset inside one transaction
 *   writeAuditLog()           one audit row per field actually changed
 *
 * The engine is deliberately free of any UI, request or session coupling beyond
 * an optional actor for the audit trail, so the same code can later be driven by
 * a cron job, a scheduled task or an admin button without change.
 *
 * Governing rules, all enforced below:
 *   · The sheet owns source fields only. Progress, checkpoints, due dates, data
 *     and system owner, project type, connections, reviews, layout and audit are
 *     Air4's own data and are never written here.
 *   · Project_ID is permanent. A rename updates the name and nothing else.
 *   · A department change never moves a Project_ID — it raises a critical
 *     conflict and blocks that project until a human decides.
 *   · Nothing is created, deleted or approved automatically.
 *   · An unchanged project produces no write and no audit row.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConflictType =
  | "NEW_SOURCE_PROJECT"
  | "SOURCE_MISSING"
  | "DEPARTMENT_CHANGE"
  | "UNKNOWN_DEPARTMENT"
  | "UNKNOWN_STATUS"
  | "UNKNOWN_OWNER"
  | "DUPLICATE_SOURCE_ROW"
  | "AMBIGUOUS_MATCH"
  | "INVALID_SOURCE_ROW"
  | "MISSING_REQUIRED_FIELD";

export type Severity = "CRITICAL" | "WARNING";

export interface SyncConflict {
  type: ConflictType;
  severity: Severity;
  projectId: string | null;
  sourceRow: number | null;
  field: string | null;
  currentValue: string | null;
  sheetValue: string | null;
  message: string;
}

export interface FieldChange {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
  /** false = reported for review but never written by Apply. */
  safe: boolean;
  blockedReason?: string;
}

export type ProjectPlanState = "CHANGED" | "UNCHANGED" | "BLOCKED";

export interface ProjectPlan {
  projectId: string;
  projectName: string;
  deptCode: string;
  sourceRow: number | null;
  sourceSeq: number | null;
  state: ProjectPlanState;
  changes: FieldChange[];
  conflicts: SyncConflict[];
}

export interface NewSourceRow {
  sourceRow: number;
  seq: number | null;
  sourceDept: string;
  deptCode: string | null;
  name: string;
  priority: number | null;
  ownerName: string;
  brief: string;
  statusOriginal: string;
  notes: string;
}

export interface MissingProject {
  projectId: string;
  projectName: string;
  deptCode: string;
  sourceSeq: number | null;
  alreadyFlagged: boolean;
}

export interface SyncSummary {
  rowsRead: number;
  matched: number;
  changed: number;
  unchanged: number;
  blocked: number;
  newRows: number;
  missing: number;
  warnings: number;
  conflicts: number;
  fieldChanges: number;
}

export interface SyncPlan {
  runId: string;
  generatedAt: string;
  spreadsheetId: string;
  tab: string;
  gid: string;
  sourceMode: string;
  projects: ProjectPlan[];
  newRows: NewSourceRow[];
  missing: MissingProject[];
  conflicts: SyncConflict[];
  summary: SyncSummary;
}

export interface ApplyResult {
  runId: string;
  appliedProjects: number;
  appliedFields: number;
  skippedBlocked: number;
  plan: SyncPlan;
}

// ---------------------------------------------------------------------------
// Source field definitions — the sheet owns exactly these, and nothing else.
// ---------------------------------------------------------------------------

/**
 * Every field the sheet is allowed to write, and the human label used in the
 * preview and the audit log. Anything absent from this list is Air4's own data:
 * progress_percent, checkpoint_due_date, final_due_date, data_owner,
 * system_owner, project_type, connection_review_status, layout_x, layout_y and
 * every row in connections and audit_log are all deliberately not here.
 */
const SOURCE_FIELDS = {
  project_name: "Project Name",
  priority: "Priority",
  owner_name: "Owner",
  brief: "Brief",
  status_original: "Status (original)",
  status_id: "Status",
  notes: "Notes",
  source_dept: "Source Department",
} as const;

type SourceField = keyof typeof SOURCE_FIELDS;

// ---------------------------------------------------------------------------
// Status mapping (§8) — controlled, never guessed.
// ---------------------------------------------------------------------------

let statusMapCache: Record<string, string> | null = null;

/** Thai sheet status → controlled status_id, from data/source/departments.json. */
export function statusMap(): Record<string, string> {
  if (statusMapCache) return statusMapCache;
  const file = path.join(process.cwd(), "data", "source", "departments.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    status_mapping?: Record<string, string>;
  };
  const map: Record<string, string> = {};
  for (const [thai, id] of Object.entries(parsed.status_mapping ?? {})) {
    if (thai.startsWith("_")) continue; // "_note" is documentation, not a mapping
    map[normaliseText(thai)] = id;
  }
  statusMapCache = map;
  return map;
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/** Collapse whitespace and unify dash characters so cosmetic edits are not "changes". */
function normaliseText(value: string): string {
  return value
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseName(value: string): string {
  return normaliseText(value).toLowerCase();
}

/** Treat null, undefined and "" as the same absent value. */
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) =>
    v === null || v === undefined || v === "" ? null : normaliseText(String(v));
  return norm(a) === norm(b);
}

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = normaliseText(String(value));
  return text.length ? text : null;
}

// ---------------------------------------------------------------------------
// 1. fetchSheetProjects
// ---------------------------------------------------------------------------

export interface RawSheetRow {
  rowNumber: number;
  cells: string[];
}

/** Locate the header row and return the data rows beneath it, with row numbers. */
export function splitSheetRows(grid: SheetGrid): RawSheetRow[] {
  const headerIndex = grid.rows.findIndex(
    (row) =>
      row.some((c) => normaliseText(c) === "ลำดับ") && row.some((c) => normaliseText(c) === "แผนก")
  );
  if (headerIndex === -1) {
    throw new Error(
      'Could not find the header row in the sheet — expected a row containing "ลำดับ" and "แผนก".'
    );
  }

  const rows: RawSheetRow[] = [];
  for (let i = headerIndex + 1; i < grid.rows.length; i++) {
    const cells = grid.rows[i] ?? [];
    // A row counts as data only if it carries something beyond the sequence number.
    const meaningful = cells.slice(1).some((c) => normaliseText(c).length > 0);
    if (!meaningful) continue;
    rows.push({ rowNumber: grid.firstRowNumber + i, cells });
  }
  return rows;
}

export async function fetchSheetProjects(): Promise<{
  rows: RawSheetRow[];
  config: SheetConfig;
}> {
  const grid = await fetchSheetGrid();
  return { rows: splitSheetRows(grid), config: grid.config };
}

// ---------------------------------------------------------------------------
// 2. normalizeSheetProject
// ---------------------------------------------------------------------------

export interface NormalisedRow {
  rowNumber: number;
  seq: number | null;
  sourceDept: string;
  deptCode: string | null;
  name: string;
  priority: number | null;
  ownerName: string;
  brief: string;
  statusOriginal: string;
  statusId: string | null;
  notes: string;
  problems: SyncConflict[];
}

const cell = (cells: string[], index: number): string => normaliseText(cells[index] ?? "");

/**
 * One raw row → a validated source record.
 *
 * `CS1` and `CS2` are sub-teams of `CS`: they are normalised to the real
 * department while the sheet's original code is kept in source_dept, exactly as
 * the first import did.
 */
export function normalizeSheetProject(
  row: RawSheetRow,
  knownDepartments: Set<string>,
  knownOwners: Set<string>
): NormalisedRow {
  const problems: SyncConflict[] = [];
  const cells = row.cells;

  const seqRaw = cell(cells, 0);
  const seq = /^\d+$/.test(seqRaw) ? Number(seqRaw) : null;
  const sourceDept = cell(cells, 1);
  const name = cell(cells, 2);
  const priorityRaw = cell(cells, 3);
  const ownerName = cell(cells, 4);
  const brief = cell(cells, 5);
  const statusOriginal = cell(cells, 6);
  const notes = cell(cells, 7);

  // Department: exact code, else strip a trailing sub-team digit (CS1 → CS).
  let deptCode: string | null = null;
  if (knownDepartments.has(sourceDept)) {
    deptCode = sourceDept;
  } else {
    const stripped = sourceDept.replace(/\d+$/, "");
    if (stripped && knownDepartments.has(stripped)) deptCode = stripped;
  }
  if (!deptCode) {
    problems.push({
      type: "UNKNOWN_DEPARTMENT",
      severity: "CRITICAL",
      projectId: null,
      sourceRow: row.rowNumber,
      field: "dept_code",
      currentValue: null,
      sheetValue: sourceDept || null,
      message: `Row ${row.rowNumber}: department "${sourceDept}" is not one of the 12 configured departments.`,
    });
  }

  if (!name) {
    problems.push({
      type: "INVALID_SOURCE_ROW",
      severity: "CRITICAL",
      projectId: null,
      sourceRow: row.rowNumber,
      field: "project_name",
      currentValue: null,
      sheetValue: null,
      message: `Row ${row.rowNumber}: has data but no project name, so it cannot be matched or imported.`,
    });
  }

  let priority: number | null = null;
  if (priorityRaw) {
    const parsed = Number(priorityRaw);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 5) {
      priority = parsed;
    } else {
      problems.push({
        type: "MISSING_REQUIRED_FIELD",
        severity: "WARNING",
        projectId: null,
        sourceRow: row.rowNumber,
        field: "priority",
        currentValue: null,
        sheetValue: priorityRaw,
        message: `Row ${row.rowNumber} ("${name}"): priority "${priorityRaw}" is not a whole number from 1 to 5, so it will not be applied.`,
      });
    }
  }

  // Status: mapped or left alone. Never invented. (§8)
  let statusId: string | null = null;
  if (statusOriginal) {
    statusId = statusMap()[normaliseText(statusOriginal)] ?? null;
    if (!statusId) {
      problems.push({
        type: "UNKNOWN_STATUS",
        severity: "WARNING",
        projectId: null,
        sourceRow: row.rowNumber,
        field: "status_id",
        currentValue: null,
        sheetValue: statusOriginal,
        message: `Row ${row.rowNumber} ("${name}"): status "${statusOriginal}" has no mapping. The original text is kept, the controlled status is left unchanged, and an admin must decide how to map it.`,
      });
    }
  }

  // Owner is metadata, never a login. A new name is recorded, and flagged.
  if (ownerName && !knownOwners.has(normaliseName(ownerName))) {
    problems.push({
      type: "UNKNOWN_OWNER",
      severity: "WARNING",
      projectId: null,
      sourceRow: row.rowNumber,
      field: "owner_name",
      currentValue: null,
      sheetValue: ownerName,
      message: `Row ${row.rowNumber} ("${name}"): new owner name "${ownerName}" has not been seen before. It is stored as project metadata; no account is created.`,
    });
  }

  return {
    rowNumber: row.rowNumber,
    seq,
    sourceDept,
    deptCode,
    name,
    priority,
    ownerName,
    brief,
    statusOriginal,
    statusId,
    notes,
    problems,
  };
}

// ---------------------------------------------------------------------------
// 3. matchPermanentProject
// ---------------------------------------------------------------------------

export interface MatchResult {
  pairs: { row: NormalisedRow; project: Project }[];
  unmatchedRows: NormalisedRow[];
  unmatchedProjects: Project[];
  conflicts: SyncConflict[];
}

/**
 * Bind source rows to permanent Project_IDs.
 *
 * Name alone is never an identifier (§3), and the sheet's ลำดับ renumbers
 * whenever a row is inserted, so neither key is trustworthy on its own. Two
 * passes, most reliable evidence first:
 *
 *   Pass 1  unique normalised name  — survives reordering and renumbering
 *   Pass 2  source_seq              — survives a rename
 *
 * A row that survives both passes is genuinely new. A project that survives both
 * has genuinely lost its row. Neither outcome is acted on automatically.
 */
export function matchPermanentProject(
  rows: NormalisedRow[],
  projects: Project[]
): MatchResult {
  const conflicts: SyncConflict[] = [];
  const pairs: { row: NormalisedRow; project: Project }[] = [];

  const rowsLeft = new Set(rows.filter((r) => r.name));
  const projectsLeft = new Set(projects);

  // Duplicate names inside the sheet make name matching unsafe for those rows.
  const byName = new Map<string, NormalisedRow[]>();
  for (const row of rowsLeft) {
    const key = normaliseName(row.name);
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }
  for (const [key, group] of byName) {
    if (group.length < 2) continue;
    for (const row of group) {
      rowsLeft.delete(row);
      conflicts.push({
        type: "DUPLICATE_SOURCE_ROW",
        severity: "CRITICAL",
        projectId: null,
        sourceRow: row.rowNumber,
        field: "project_name",
        currentValue: null,
        sheetValue: row.name,
        message: `"${row.name}" appears on ${group.length} rows (${group
          .map((r) => `row ${r.rowNumber}`)
          .join(", ")}). Duplicate names cannot be matched to one permanent Project ID.`,
      });
      void key;
    }
  }

  // Pass 1 — unique name on both sides.
  const projectsByName = new Map<string, Project[]>();
  for (const project of projectsLeft) {
    const key = normaliseName(project.project_name);
    projectsByName.set(key, [...(projectsByName.get(key) ?? []), project]);
  }
  for (const row of [...rowsLeft]) {
    const candidates = projectsByName.get(normaliseName(row.name)) ?? [];
    const available = candidates.filter((p) => projectsLeft.has(p));
    if (available.length === 1) {
      pairs.push({ row, project: available[0] });
      rowsLeft.delete(row);
      projectsLeft.delete(available[0]);
    } else if (available.length > 1) {
      conflicts.push({
        type: "AMBIGUOUS_MATCH",
        severity: "CRITICAL",
        projectId: null,
        sourceRow: row.rowNumber,
        field: "project_name",
        currentValue: available.map((p) => p.project_id).join(", "),
        sheetValue: row.name,
        message: `Row ${row.rowNumber} ("${row.name}") matches ${available.length} existing projects (${available
          .map((p) => p.project_id)
          .join(", ")}). An admin must say which one it is.`,
      });
      rowsLeft.delete(row);
    }
  }

  // Pass 2 — sequence number, which is what a rename leaves untouched.
  const projectsBySeq = new Map<number, Project[]>();
  for (const project of projectsLeft) {
    if (project.source_seq === null) continue;
    projectsBySeq.set(project.source_seq, [
      ...(projectsBySeq.get(project.source_seq) ?? []),
      project,
    ]);
  }
  for (const row of [...rowsLeft]) {
    if (row.seq === null) continue;
    const available = (projectsBySeq.get(row.seq) ?? []).filter((p) => projectsLeft.has(p));
    if (available.length === 1) {
      pairs.push({ row, project: available[0] });
      rowsLeft.delete(row);
      projectsLeft.delete(available[0]);
    }
  }

  return {
    pairs,
    unmatchedRows: [...rowsLeft],
    unmatchedProjects: [...projectsLeft],
    conflicts,
  };
}

// ---------------------------------------------------------------------------
// 4. compareChanges
// ---------------------------------------------------------------------------

/**
 * Field-by-field diff for one matched pair.
 *
 * A department change is reported as an unsafe change and never applied: the
 * Project_ID encodes the department, so moving AF-007 to BD would either break
 * the permanent identifier or leave a BD project numbered AF. That decision
 * belongs to a human (§11).
 */
export function compareChanges(
  project: Project,
  row: NormalisedRow
): { changes: FieldChange[]; conflicts: SyncConflict[] } {
  const changes: FieldChange[] = [];
  const conflicts: SyncConflict[] = [];

  const push = (field: SourceField, before: unknown, after: unknown, safe = true, blocked?: string) => {
    if (sameValue(before, after)) return;
    changes.push({
      field,
      label: SOURCE_FIELDS[field],
      before: textOrNull(before),
      after: textOrNull(after),
      safe,
      blockedReason: blocked,
    });
  };

  push("project_name", project.project_name, row.name);
  if (row.priority !== null) push("priority", project.priority, row.priority);
  push("owner_name", project.owner_name, row.ownerName);
  push("brief", project.brief, row.brief);
  push("status_original", project.status_original, row.statusOriginal);
  push("notes", project.notes, row.notes);
  push("source_dept", project.source_dept ?? null, row.sourceDept);

  // Controlled status only moves when the mapping is known.
  if (row.statusId && row.statusId !== project.status_id) {
    push("status_id", project.status_id, row.statusId);
  }

  // Department change — critical, blocks this project entirely.
  if (row.deptCode && row.deptCode !== project.dept_code) {
    const message =
      `${project.project_id} is a ${project.dept_code} project but the sheet now says ` +
      `${row.deptCode}. The Project ID is permanent and encodes the department, so nothing ` +
      `is applied to this project until an admin decides.`;
    changes.push({
      field: "dept_code",
      label: "Department",
      before: project.dept_code,
      after: row.deptCode,
      safe: false,
      blockedReason: "Department changes are never applied automatically.",
    });
    conflicts.push({
      type: "DEPARTMENT_CHANGE",
      severity: "CRITICAL",
      projectId: project.project_id,
      sourceRow: row.rowNumber,
      field: "dept_code",
      currentValue: project.dept_code,
      sheetValue: row.deptCode,
      message,
    });
  }

  return { changes, conflicts };
}

// ---------------------------------------------------------------------------
// 5. generateSyncPlan
// ---------------------------------------------------------------------------

function knownOwnerSet(projects: Project[]): Set<string> {
  const owners = new Set<string>();
  for (const project of projects) {
    if (project.owner_name) owners.add(normaliseName(project.owner_name));
  }
  for (const row of all<{ display_name: string }>(`SELECT display_name FROM users`)) {
    if (row.display_name) owners.add(normaliseName(row.display_name));
  }
  return owners;
}

function newRunId(): string {
  return `SYNC-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}

/**
 * Read the sheet and produce the full comparison without touching the database.
 * This is exactly what Check returns, and exactly what Apply re-derives.
 */
export async function generateSyncPlan(): Promise<SyncPlan> {
  const { rows: rawRows, config } = await fetchSheetProjects();

  const departments = new Set(
    all<{ dept_code: string }>(`SELECT dept_code FROM departments WHERE active = 1`).map(
      (d) => d.dept_code
    )
  );

  // Only sheet-sourced projects take part. Future add-ons created in the app
  // have no source row and must never be reported as missing.
  const projects = all<Project>(
    `SELECT * FROM projects WHERE active = 1 AND source_state <> 'MANUAL'
      ORDER BY dept_code, project_id`
  );
  const owners = knownOwnerSet(projects);

  const normalised = rawRows.map((row) => normalizeSheetProject(row, departments, owners));
  const rowProblems = normalised.flatMap((r) => r.problems);

  // A row with a critical structural problem takes no further part.
  const usable = normalised.filter(
    (r) => !r.problems.some((p) => p.severity === "CRITICAL")
  );

  const match = matchPermanentProject(usable, projects);

  const projectPlans: ProjectPlan[] = [];
  const allConflicts: SyncConflict[] = [...match.conflicts];

  for (const { row, project } of match.pairs) {
    const { changes, conflicts } = compareChanges(project, row);

    // Row-level warnings are re-attributed to the project they turned out to belong to.
    const attributed = row.problems.map((p) => ({ ...p, projectId: project.project_id }));
    const combined = [...conflicts, ...attributed];

    const blocked = combined.some((c) => c.severity === "CRITICAL");
    const effective = blocked
      ? changes.map((c) => ({
          ...c,
          safe: false,
          blockedReason:
            c.blockedReason ?? "Blocked by a critical conflict on this project.",
        }))
      : changes;

    // An unmapped status must not move status_id even when nothing else is blocked.
    for (const change of effective) {
      if (change.field === "status_id" && !row.statusId) change.safe = false;
    }

    projectPlans.push({
      projectId: project.project_id,
      projectName: project.project_name,
      deptCode: project.dept_code,
      sourceRow: row.rowNumber,
      sourceSeq: row.seq,
      state: blocked ? "BLOCKED" : effective.length ? "CHANGED" : "UNCHANGED",
      changes: effective,
      conflicts: combined,
    });
    allConflicts.push(...combined);
  }

  // New rows — recorded for review, never created (§9).
  const newRows: NewSourceRow[] = match.unmatchedRows.map((row) => ({
    sourceRow: row.rowNumber,
    seq: row.seq,
    sourceDept: row.sourceDept,
    deptCode: row.deptCode,
    name: row.name,
    priority: row.priority,
    ownerName: row.ownerName,
    brief: row.brief,
    statusOriginal: row.statusOriginal,
    notes: row.notes,
  }));
  for (const row of newRows) {
    allConflicts.push({
      type: "NEW_SOURCE_PROJECT",
      severity: "WARNING",
      projectId: null,
      sourceRow: row.sourceRow,
      field: null,
      currentValue: null,
      sheetValue: row.name,
      message: `Row ${row.sourceRow} ("${row.name}", ${row.sourceDept}) does not match any existing project. It is held for admin review — it is not created, not approved, and not given a Project ID automatically.`,
    });
  }

  // Missing rows — flagged, never deleted (§10).
  const missing: MissingProject[] = match.unmatchedProjects.map((project) => ({
    projectId: project.project_id,
    projectName: project.project_name,
    deptCode: project.dept_code,
    sourceSeq: project.source_seq,
    alreadyFlagged: project.source_state === "SOURCE_MISSING",
  }));
  for (const project of missing) {
    allConflicts.push({
      type: "SOURCE_MISSING",
      severity: "WARNING",
      projectId: project.projectId,
      sourceRow: null,
      field: null,
      currentValue: project.projectName,
      sheetValue: null,
      message: `${project.projectId} ("${project.projectName}") has no matching row in the sheet. It is flagged SOURCE_MISSING and left completely intact — no deletion, no archive, and its connections, progress and audit history are untouched.`,
    });
  }

  // Structural problems on rows that never reached a project.
  const unattributed = rowProblems.filter(
    (p) => !match.pairs.some((pair) => pair.row.rowNumber === p.sourceRow)
  );
  allConflicts.push(...unattributed);

  const changed = projectPlans.filter((p) => p.state === "CHANGED");
  const summary: SyncSummary = {
    rowsRead: rawRows.length,
    matched: match.pairs.length,
    changed: changed.length,
    unchanged: projectPlans.filter((p) => p.state === "UNCHANGED").length,
    blocked: projectPlans.filter((p) => p.state === "BLOCKED").length,
    newRows: newRows.length,
    missing: missing.filter((m) => !m.alreadyFlagged).length,
    warnings: allConflicts.filter((c) => c.severity === "WARNING").length,
    conflicts: allConflicts.filter((c) => c.severity === "CRITICAL").length,
    fieldChanges: changed.reduce((n, p) => n + p.changes.filter((c) => c.safe).length, 0),
  };

  return {
    runId: newRunId(),
    generatedAt: new Date().toISOString(),
    spreadsheetId: config.spreadsheetId,
    tab: config.tab,
    gid: config.gid,
    sourceMode: config.mode ?? "NONE",
    projects: projectPlans,
    newRows,
    missing,
    conflicts: allConflicts,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Run + conflict persistence
// ---------------------------------------------------------------------------

function recordRun(
  plan: SyncPlan,
  mode: "CHECK" | "APPLY",
  actor: SessionUser | null,
  applied: { projects: number; fields: number },
  status: "SUCCESS" | "FAILED",
  error: string | null
): void {
  db.prepare(
    `INSERT INTO sync_runs (run_id, mode, started_at, finished_at, status,
                            actor_user_id, actor_username, spreadsheet_id, tab_name, source_mode,
                            rows_read, matched_count, changed_count, unchanged_count,
                            new_count, missing_count, warning_count, conflict_count,
                            applied_fields, applied_projects, error)
     VALUES (@run_id, @mode, @started_at, @finished_at, @status,
             @actor_user_id, @actor_username, @spreadsheet_id, @tab_name, @source_mode,
             @rows_read, @matched_count, @changed_count, @unchanged_count,
             @new_count, @missing_count, @warning_count, @conflict_count,
             @applied_fields, @applied_projects, @error)`
  ).run({
    run_id: plan.runId,
    mode,
    started_at: plan.generatedAt,
    finished_at: new Date().toISOString(),
    status,
    actor_user_id: actor?.userId ?? null,
    actor_username: actor?.username ?? null,
    spreadsheet_id: plan.spreadsheetId,
    tab_name: plan.tab,
    source_mode: plan.sourceMode,
    rows_read: plan.summary.rowsRead,
    matched_count: plan.summary.matched,
    changed_count: plan.summary.changed,
    unchanged_count: plan.summary.unchanged,
    new_count: plan.summary.newRows,
    missing_count: plan.summary.missing,
    warning_count: plan.summary.warnings,
    conflict_count: plan.summary.conflicts,
    applied_fields: applied.fields,
    applied_projects: applied.projects,
    error,
  });

  const insertConflict = db.prepare(
    `INSERT INTO sync_conflicts (run_id, detected_at, conflict_type, severity, project_id,
                                 source_row, field_name, current_value, sheet_value, message)
     VALUES (@run_id, @detected_at, @conflict_type, @severity, @project_id,
             @source_row, @field_name, @current_value, @sheet_value, @message)`
  );
  const now = new Date().toISOString();
  for (const conflict of plan.conflicts) {
    insertConflict.run({
      run_id: plan.runId,
      detected_at: now,
      conflict_type: conflict.type,
      severity: conflict.severity,
      project_id: conflict.projectId,
      source_row: conflict.sourceRow,
      field_name: conflict.field,
      current_value: conflict.currentValue,
      sheet_value: conflict.sheetValue,
      message: conflict.message,
    });
  }
}

// ---------------------------------------------------------------------------
// 6 + 7. applySyncPlan / writeAuditLog
// ---------------------------------------------------------------------------

/**
 * Read the sheet and record what would change. Writes nothing to projects,
 * connections or audit_log — only the run and its conflicts are journalled, so
 * "when did we last look" stays answerable.
 */
export async function checkGoogleSheet(actor: SessionUser | null): Promise<SyncPlan> {
  const plan = await generateSyncPlan();
  recordRun(plan, "CHECK", actor, { projects: 0, fields: 0 }, "SUCCESS", null);
  return plan;
}

/**
 * Apply the safe subset.
 *
 * The plan is re-derived from a fresh read rather than trusting one submitted by
 * the browser: a preview the admin looked at a minute ago may no longer describe
 * the sheet, and a client-supplied plan would be a way to write arbitrary values
 * into projects. What the admin approves is the act of applying, not the payload.
 */
export async function applyGoogleSheetSync(actor: SessionUser): Promise<ApplyResult> {
  const plan = await generateSyncPlan();

  let appliedProjects = 0;
  let appliedFields = 0;

  const transaction = db.transaction(() => {
    for (const projectPlan of plan.projects) {
      if (projectPlan.state !== "CHANGED") continue;
      const safeChanges = projectPlan.changes.filter((c) => c.safe);
      if (!safeChanges.length) continue;

      const assignments = safeChanges.map((c) => `${c.field} = @${c.field}`);
      const params: Record<string, unknown> = { project_id: projectPlan.projectId };
      for (const change of safeChanges) {
        params[change.field] =
          change.field === "priority" && change.after !== null
            ? Number(change.after)
            : change.after;
      }

      // Source-row bookkeeping travels with a real update; it never causes one.
      assignments.push(
        "source_row_number = @source_row_number",
        "source_sheet_id = @source_sheet_id",
        "source_tab = @source_tab",
        "source_state = 'PRESENT'",
        "source_last_seen_at = @now",
        "source_updated_at = @now",
        "updated_at = @now",
        "updated_by = @updated_by"
      );
      params.source_row_number = projectPlan.sourceRow;
      params.source_sheet_id = plan.spreadsheetId;
      params.source_tab = plan.tab;
      params.now = new Date().toISOString();
      params.updated_by = actor.username;

      db.prepare(
        `UPDATE projects SET ${assignments.join(", ")} WHERE project_id = @project_id`
      ).run(params);

      // writeAuditLog — one append-only row per field actually changed (§7).
      for (const change of safeChanges) {
        recordAudit({
          actor,
          action: "GOOGLE_SHEET_SYNC",
          entityType: "PROJECT",
          entityId: projectPlan.projectId,
          fieldName: change.field,
          oldValue: change.before,
          newValue: change.after,
          source: "GOOGLE_SHEET",
          notes: `${plan.runId} · sheet row ${projectPlan.sourceRow} · ${change.label}`,
        });
        appliedFields++;
      }
      appliedProjects++;
    }

    // Flag disappeared rows. Nothing is deleted, archived or deactivated (§10).
    for (const missing of plan.missing) {
      if (missing.alreadyFlagged) continue;
      db.prepare(
        `UPDATE projects SET source_state = 'SOURCE_MISSING', updated_at = ?, updated_by = ?
          WHERE project_id = ?`
      ).run(new Date().toISOString(), actor.username, missing.projectId);
      recordAudit({
        actor,
        action: "GOOGLE_SHEET_SYNC",
        entityType: "PROJECT",
        entityId: missing.projectId,
        fieldName: "source_state",
        oldValue: "PRESENT",
        newValue: "SOURCE_MISSING",
        source: "GOOGLE_SHEET",
        notes: `${plan.runId} · row no longer present in the sheet; project left intact for review`,
      });
      appliedFields++;
    }

    // A project whose row reappears comes back to PRESENT.
    for (const projectPlan of plan.projects) {
      const current = get<{ source_state: string }>(
        `SELECT source_state FROM projects WHERE project_id = ?`,
        [projectPlan.projectId]
      );
      if (current?.source_state !== "SOURCE_MISSING") continue;
      db.prepare(
        `UPDATE projects SET source_state = 'PRESENT', source_last_seen_at = ?,
                             updated_at = ?, updated_by = ? WHERE project_id = ?`
      ).run(
        new Date().toISOString(),
        new Date().toISOString(),
        actor.username,
        projectPlan.projectId
      );
      recordAudit({
        actor,
        action: "GOOGLE_SHEET_SYNC",
        entityType: "PROJECT",
        entityId: projectPlan.projectId,
        fieldName: "source_state",
        oldValue: "SOURCE_MISSING",
        newValue: "PRESENT",
        source: "GOOGLE_SHEET",
        notes: `${plan.runId} · row found again in the sheet`,
      });
      appliedFields++;
    }

    recordRun(
      plan,
      "APPLY",
      actor,
      { projects: appliedProjects, fields: appliedFields },
      "SUCCESS",
      null
    );
  });

  transaction();

  return {
    runId: plan.runId,
    appliedProjects,
    appliedFields,
    skippedBlocked: plan.summary.blocked,
    plan,
  };
}

// ---------------------------------------------------------------------------
// Status for the UI
// ---------------------------------------------------------------------------

export interface SyncRunRecord {
  run_id: string;
  mode: "CHECK" | "APPLY";
  started_at: string;
  finished_at: string | null;
  status: string;
  actor_username: string | null;
  spreadsheet_id: string | null;
  tab_name: string | null;
  source_mode: string | null;
  rows_read: number;
  matched_count: number;
  changed_count: number;
  unchanged_count: number;
  new_count: number;
  missing_count: number;
  warning_count: number;
  conflict_count: number;
  applied_fields: number;
  applied_projects: number;
  error: string | null;
}

export interface SyncStatus {
  configured: boolean;
  sourceMode: string | null;
  problem: string | null;
  spreadsheetId: string;
  tab: string;
  gid: string;
  lastCheck: SyncRunRecord | null;
  lastApply: SyncRunRecord | null;
  openCritical: number;
  openWarnings: number;
  sourceMissing: { project_id: string; project_name: string }[];
  recent: SyncRunRecord[];
}

export function syncStatus(): SyncStatus {
  const config = sheetConfig();
  const lastOf = (mode: string) =>
    get<SyncRunRecord>(
      `SELECT * FROM sync_runs WHERE mode = ? AND status = 'SUCCESS'
        ORDER BY started_at DESC LIMIT 1`,
      [mode]
    ) ?? null;

  const latestRun = get<{ run_id: string }>(
    `SELECT run_id FROM sync_runs ORDER BY started_at DESC LIMIT 1`
  );

  // Conflicts are counted from the most recent run only, so a stale finding from
  // three checks ago is not still being reported as open.
  const countConflicts = (severity: Severity) =>
    get<{ n: number }>(
      `SELECT COUNT(*) n FROM sync_conflicts
        WHERE run_id = ? AND severity = ? AND resolution = 'OPEN'`,
      [latestRun?.run_id ?? "", severity]
    )?.n ?? 0;

  return {
    configured: config.mode !== null,
    sourceMode: config.mode,
    problem: config.problem,
    spreadsheetId: config.spreadsheetId,
    tab: config.tab,
    gid: config.gid,
    lastCheck: lastOf("CHECK"),
    lastApply: lastOf("APPLY"),
    openCritical: countConflicts("CRITICAL"),
    openWarnings: countConflicts("WARNING"),
    sourceMissing: all<{ project_id: string; project_name: string }>(
      `SELECT project_id, project_name FROM projects
        WHERE active = 1 AND source_state = 'SOURCE_MISSING' ORDER BY project_id`
    ),
    recent: all<SyncRunRecord>(`SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 10`),
  };
}
