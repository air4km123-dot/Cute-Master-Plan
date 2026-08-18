import "server-only";
import { get } from "./db";

/**
 * Data quality guard rails (Addendum V2 §35).
 *
 * Every write goes through these. The rule is to refuse bad data outright and
 * warn about suspicious data rather than silently overwriting it.
 */

export class ValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ValidationError(message);
}

export const PROJECT_ID_RE = /^[A-Z0-9]{2,4}-\d{3}$/;

export async function projectExists(projectId: string): Promise<boolean> {
  return !!(await get(`SELECT 1 FROM projects WHERE project_id = ? AND active = 1`, [projectId]));
}

export async function assertProjectExists(
  projectId: string,
  label = "Project"
): Promise<void> {
  assert(typeof projectId === "string" && projectId.length > 0, `${label} is required.`);
  assert(await projectExists(projectId), `${label} "${projectId}" does not exist.`);
}

export function assertValidProgress(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  assert(Number.isFinite(n), "Progress must be a number.");
  assert(Number.isInteger(n), "Progress must be a whole number.");
  assert(n >= 0 && n <= 100, "Progress must be between 0 and 100.");
  return n;
}

export async function assertValidStatus(statusId: unknown): Promise<string> {
  assert(typeof statusId === "string", "Status is required.");
  assert(
    !!(await get(`SELECT 1 FROM status_config WHERE status_id = ? AND active = 1`, [statusId])),
    `"${statusId}" is not one of the configured statuses.`
  );
  return statusId;
}

export async function assertValidConnectionType(typeId: unknown): Promise<string> {
  assert(typeof typeId === "string", "Connection type is required.");
  assert(
    !!(await get(`SELECT 1 FROM connection_types WHERE type_id = ? AND active = 1`, [typeId])),
    `"${typeId}" is not one of the configured connection types.`
  );
  return typeId;
}

export async function assertValidDepartment(deptCode: unknown): Promise<string> {
  assert(typeof deptCode === "string", "Department is required.");
  assert(
    !!(await get(`SELECT 1 FROM departments WHERE dept_code = ? AND active = 1`, [deptCode])),
    `"${deptCode}" is not one of the configured departments.`
  );
  return deptCode;
}

/**
 * Dates are optional everywhere — a project may legitimately have no
 * confirmed due date (§8). Only the format is enforced when a value is given.
 */
export function assertValidDate(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  assert(typeof value === "string", `${label} must be a date.`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value), `${label} must be in YYYY-MM-DD format.`);
  const parsed = new Date(value + "T00:00:00Z");
  assert(!Number.isNaN(parsed.getTime()), `${label} is not a real date.`);
  return value;
}

export async function assertConnectionEndpoints(
  sourceId: unknown,
  targetId: unknown
): Promise<void> {
  assert(typeof sourceId === "string", "Source project is required.");
  assert(typeof targetId === "string", "Target project is required.");
  assert(sourceId !== targetId, "A project cannot connect to itself.");
  await assertProjectExists(sourceId, "Source project");
  await assertProjectExists(targetId, "Target project");
}

export function assertLabel(value: unknown): string {
  assert(typeof value === "string", "Connection label is required.");
  const label = value.trim();
  assert(label.length > 0, "Give the connection a label describing what is transferred.");
  assert(label.length <= 60, "Keep the connection label under 60 characters.");
  return label;
}

/**
 * Non-blocking warnings surfaced back to the user alongside a successful save.
 */
export async function connectionWarnings(
  sourceId: string,
  targetId: string,
  excludeConnectionId?: string
): Promise<string[]> {
  const warnings: string[] = [];

  const duplicate = await get<{ connection_id: string; connection_label: string }>(
    `SELECT connection_id, connection_label FROM connections
      WHERE source_project_id = ? AND target_project_id = ? AND active = 1
        AND connection_id <> ?`,
    [sourceId, targetId, excludeConnectionId ?? ""]
  );
  if (duplicate) {
    warnings.push(
      `${sourceId} → ${targetId} already exists as ${duplicate.connection_id} ("${duplicate.connection_label}").`
    );
  }

  const reverse = await get<{ connection_id: string }>(
    `SELECT connection_id FROM connections
      WHERE source_project_id = ? AND target_project_id = ? AND active = 1
        AND connection_id <> ?`,
    [targetId, sourceId, excludeConnectionId ?? ""]
  );
  if (reverse) {
    warnings.push(
      `${reverse.connection_id} already records the opposite direction. Consider making one connection bidirectional instead.`
    );
  }

  return warnings;
}

export function projectWarnings(fields: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const { progress_percent, status_id, final_due_date, checkpoint_due_date } = fields;

  if (status_id === "NOT_STARTED" && typeof progress_percent === "number" && progress_percent > 0) {
    warnings.push("Status is Not Started but progress is above 0%.");
  }
  if (status_id === "LIVE" && typeof progress_percent === "number" && progress_percent < 100) {
    warnings.push("Status is Live but progress is below 100%.");
  }
  if (
    typeof checkpoint_due_date === "string" &&
    typeof final_due_date === "string" &&
    checkpoint_due_date > final_due_date
  ) {
    warnings.push("The checkpoint date falls after the final due date.");
  }
  return warnings;
}
