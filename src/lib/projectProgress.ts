import "server-only";
import { all, run } from "./db";
import { fetchSheetGrid } from "./googleSheets";
import progressMap from "../../data/source/progress-map.json";

/**
 * Per-project % Progress, mirrored from the รายละเอียด Project tab (column E).
 *
 * That tab is the roll-up of every department's own GROWS tracking sheet, so
 * its percentages are what the departments themselves report. They are stored in
 * project_sheet_progress, not projects.progress_percent: that column is Air4's
 * own figure and the sheet sync is forbidden to write it. The card shows the
 * sheet's number when there is one and falls back to Air4's otherwise, so
 * nothing is overwritten and nothing is lost.
 *
 * Matching is the hard part. The tab has no Project ID, and each department
 * names its projects its own way — "CS1 Dashboard" in Air4 is
 * "พัฒนาระบบวิเคราะห์ยอดขายโตโยต้าสำหรับผู้บริหาร" in the sheet. Name alone is
 * never an identifier (§3), so a row is bound to a project only when:
 *
 *   1. it is in the same department, and
 *   2. its name equals the Air4 name, or begins with it followed by a space or
 *      bracket ("Online Vehicle Booking System ระบบจองรถ ออนไลน์"), or
 *   3. data/source/progress-map.json pins that project to that exact sheet name.
 *
 * Anything else is reported, not guessed. A department renaming its row simply
 * leaves the card without a sheet figure until the pin is updated.
 */

export const DETAIL_TAB = process.env.GOOGLE_DETAIL_TAB?.trim() || "รายละเอียด Project";

/** Column E, used only if the header cannot be recognised by its text. */
const FALLBACK_PROGRESS_COLUMN = 4;

const PINS: Record<string, { sheet_name: string }> =
  (progressMap as { map: Record<string, { sheet_name: string }> }).map;

const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/[‐-―]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const key = (value: unknown) => clean(value).toLowerCase();

function parsePercent(value: unknown): number | null {
  const raw = clean(value);
  const text = raw.replace(/%/g, "").replace(/,/g, "");
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  const pct = n > 0 && n <= 1 && !raw.includes("%") ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
}

export interface DetailRow {
  row: number;
  deptLabel: string;
  deptCodes: string[];
  name: string;
  percent: number | null;
  checkpoints: string;
}

/**
 * Read the table under its header — a "แผนก" cell alongside a "ชื่อ Project"
 * cell — so a banner added above it cannot shift the rows being read.
 */
export function parseDetailRows(rows: string[][]): DetailRow[] {
  const headerIndex = rows.findIndex(
    (r) => r.some((c) => clean(c) === "แผนก") && r.some((c) => /ชื่อ\s*project/i.test(clean(c)))
  );
  if (headerIndex === -1) return [];

  const header = rows[headerIndex];
  const col = (test: (c: string) => boolean, fallback: number) => {
    const i = header.findIndex((c) => test(clean(c)));
    return i === -1 ? fallback : i;
  };
  const deptCol = col((c) => c === "แผนก", 0);
  const nameCol = col((c) => /ชื่อ\s*project/i.test(c), 1);
  const pctCol = col((c) => /%/.test(c) && /progress/i.test(c), FALLBACK_PROGRESS_COLUMN);
  const cpCol = col((c) => /^CP/i.test(c), 5);

  const out: DetailRow[] = [];
  rows.slice(headerIndex + 1).forEach((r, i) => {
    const name = clean(r[nameCol]);
    const deptLabel = clean(r[deptCol]);
    if (!name || !deptLabel) return;
    out.push({
      row: headerIndex + 2 + i,
      deptLabel,
      deptCodes: deptLabel.split("/").map((d) => d.trim().toUpperCase()).filter(Boolean),
      name,
      percent: parsePercent(r[pctCol]),
      checkpoints: clean(r[cpCol]),
    });
  });
  return out;
}

interface ProjectRef {
  project_id: string;
  dept_code: string;
  project_name: string;
}

export type MatchMethod = "NAME" | "PINNED";

export interface ProjectProgressMatch {
  projectId: string;
  row: DetailRow;
  method: MatchMethod;
}

/** Bind sheet rows to permanent Project IDs. Pure, so it can be tested offline. */
export function matchDetailRows(rows: DetailRow[], projects: ProjectRef[]) {
  const matches: ProjectProgressMatch[] = [];
  const usedRows = new Set<DetailRow>();

  for (const project of projects) {
    const candidates = rows.filter(
      (r) => !usedRows.has(r) && r.deptCodes.includes(project.dept_code)
    );

    const pinned = PINS[project.project_id];
    let hit: DetailRow | undefined;
    let method: MatchMethod = "NAME";

    if (pinned) {
      hit = candidates.find((r) => key(r.name) === key(pinned.sheet_name));
      method = "PINNED";
    } else {
      const own = key(project.project_name);
      const found = candidates.filter((r) => {
        const theirs = key(r.name);
        return theirs === own || theirs.startsWith(own + " ") || theirs.startsWith(own + "(");
      });
      // Two rows that both start with the same name are not evidence of either.
      if (found.length === 1) hit = found[0];
    }

    if (hit) {
      usedRows.add(hit);
      matches.push({ projectId: project.project_id, row: hit, method });
    }
  }

  return {
    matches,
    unmatchedRows: rows.filter((r) => !usedRows.has(r)),
    unmatchedProjects: projects
      .filter((p) => !matches.some((m) => m.projectId === p.project_id))
      .map((p) => p.project_id),
  };
}

export interface ProjectProgressResult {
  tab: string;
  rowsRead: number;
  matched: number;
  byName: number;
  pinned: number;
  /** Sheet rows no Air4 project claimed — usually projects Air4 does not track yet. */
  unmatchedRows: { row: number; dept: string; name: string }[];
  /** Air4 projects with no row in the tab; their cards fall back to Air4's own figure. */
  unmatchedProjects: string[];
}

export async function syncProjectProgress(): Promise<ProjectProgressResult> {
  const grid = await fetchSheetGrid(DETAIL_TAB);
  const rows = parseDetailRows(grid.rows);
  const projects = await all<ProjectRef>(
    `SELECT project_id, dept_code, project_name FROM projects WHERE active = 1`
  );

  const { matches, unmatchedRows, unmatchedProjects } = matchDetailRows(rows, projects);
  const now = new Date().toISOString();

  for (const m of matches) {
    await run(
      `INSERT INTO project_sheet_progress
         (project_id, progress_percent, checkpoints, sheet_name, sheet_row, match_method, source_tab, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET
         progress_percent = excluded.progress_percent,
         checkpoints      = excluded.checkpoints,
         sheet_name       = excluded.sheet_name,
         sheet_row        = excluded.sheet_row,
         match_method     = excluded.match_method,
         source_tab       = excluded.source_tab,
         updated_at       = excluded.updated_at`,
      [
        m.projectId,
        m.row.percent,
        m.row.checkpoints || null,
        m.row.name,
        m.row.row,
        m.method,
        DETAIL_TAB,
        now,
      ]
    );
  }

  // A project that lost its row must not keep showing last week's number.
  if (unmatchedProjects.length) {
    await run(
      `DELETE FROM project_sheet_progress
        WHERE project_id IN (${unmatchedProjects.map(() => "?").join(",")})`,
      unmatchedProjects
    );
  }

  return {
    tab: DETAIL_TAB,
    rowsRead: rows.length,
    matched: matches.length,
    byName: matches.filter((m) => m.method === "NAME").length,
    pinned: matches.filter((m) => m.method === "PINNED").length,
    unmatchedRows: unmatchedRows.map((r) => ({ row: r.row, dept: r.deptLabel, name: r.name })),
    unmatchedProjects,
  };
}
