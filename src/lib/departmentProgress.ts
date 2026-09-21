import "server-only";
import { all, run } from "./db";
import { fetchSheetGrid } from "./googleSheets";

/**
 * Department progress, mirrored from the รวมลิงก์ชีต tab.
 *
 * That tab is the company's own roll-up: one row per department, pulled from
 * each department's GROWS tracking sheet, with column E holding the average
 * % Progress across that department's projects. Air4 shows it on the department
 * zone so the Master Plan answers "how far along is Finance?" at a glance.
 *
 * It is kept apart from projects.progress_percent on purpose. That column is
 * Air4's own per-project figure and the sheet sync is forbidden to write it; this
 * is a department-level number the departments report themselves. Mixing the two
 * would let a report overwrite a decision.
 *
 * It is a mirrored display metric rather than a decision, so changes are not
 * written to the audit log field by field — the last-updated time is stored with
 * each value instead, and the sheet itself is the history.
 */

export const PROGRESS_TAB = process.env.GOOGLE_PROGRESS_TAB?.trim() || "รวมลิงก์ชีต";

/** Column E, used when the header cannot be recognised by its text. */
const FALLBACK_PROGRESS_COLUMN = 4;

export interface DepartmentProgressRow {
  /** Label as written in the sheet, e.g. "PM/B2C". */
  label: string;
  /** Air4 department codes this row applies to, e.g. ["PM", "B2C"]. */
  codes: string[];
  percent: number;
}

const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

/** "52.38%" → 52.38. Anything that is not a number yields null rather than 0. */
function parsePercent(value: unknown): number | null {
  const text = clean(value).replace(/%/g, "").replace(/,/g, "");
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  // A fraction (0.5238) means the cell was read unformatted; scale it up.
  const pct = n > 0 && n <= 1 && !clean(value).includes("%") ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
}

/**
 * Find the table under its header row and read one value per department.
 *
 * The header is located by its text — a "แผนก" cell and a cell mentioning
 * "Progress" — so an extra summary row above it, or a column inserted later,
 * does not silently shift which number gets read. Column E is only the fallback.
 * Reading stops at the "รวม…" total row.
 */
export function parseDepartmentProgress(rows: string[][]): DepartmentProgressRow[] {
  const headerIndex = rows.findIndex(
    (row) => row.some((c) => clean(c) === "แผนก") && row.some((c) => /progress/i.test(clean(c)))
  );
  if (headerIndex === -1) return [];

  const header = rows[headerIndex];
  const deptColumn = header.findIndex((c) => clean(c) === "แผนก");
  const found = header.findIndex((c) => /progress/i.test(clean(c)));
  const progressColumn = found === -1 ? FALLBACK_PROGRESS_COLUMN : found;

  const result: DepartmentProgressRow[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const label = clean(row[deptColumn]);
    if (!label) continue;
    if (label.startsWith("รวม")) break;

    const percent = parsePercent(row[progressColumn]);
    if (percent === null) continue;

    const codes = label
      .split("/")
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
    result.push({ label, codes, percent });
  }
  return result;
}

export interface DepartmentProgressResult {
  tab: string;
  rowsRead: number;
  departmentsUpdated: number;
  /** Sheet labels that match no configured department, so nothing was stored for them. */
  unmatched: string[];
}

/**
 * Read the tab and store one value per department.
 *
 * A department that appears in a combined row ("PM/B2C") receives that row's
 * figure, with the combined label kept so the UI can say it is shared.
 */
export async function syncDepartmentProgress(): Promise<DepartmentProgressResult> {
  const grid = await fetchSheetGrid(PROGRESS_TAB);
  const parsed = parseDepartmentProgress(grid.rows);

  const known = new Set(
    (await all<{ dept_code: string }>(`SELECT dept_code FROM departments`)).map((d) => d.dept_code)
  );

  const now = new Date().toISOString();
  const unmatched: string[] = [];
  let updated = 0;

  for (const row of parsed) {
    const matching = row.codes.filter((code) => known.has(code));
    if (!matching.length) {
      unmatched.push(row.label);
      continue;
    }
    for (const code of matching) {
      await run(
        `INSERT INTO department_progress (dept_code, progress_percent, source_label, source_tab, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (dept_code) DO UPDATE SET
           progress_percent = excluded.progress_percent,
           source_label     = excluded.source_label,
           source_tab       = excluded.source_tab,
           updated_at       = excluded.updated_at`,
        [code, row.percent, row.label, PROGRESS_TAB, now]
      );
      updated++;
    }
  }

  return { tab: PROGRESS_TAB, rowsRead: parsed.length, departmentsUpdated: updated, unmatched };
}
