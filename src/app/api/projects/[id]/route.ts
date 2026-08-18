import { withSession, readJsonBody } from "@/lib/api";
import { ForbiddenError } from "@/lib/auth";
import { canEditProject, isAdmin } from "@/lib/permissions";
import { getProject } from "@/lib/queries";
import { recordFieldChanges } from "@/lib/audit";
import { run, get } from "@/lib/db";
import {
  ValidationError,
  assertValidDate,
  assertValidProgress,
  assertValidStatus,
  projectWarnings,
} from "@/lib/validation";
import type { Project, SessionUser } from "@/lib/types";

/**
 * Update one project.
 *
 * Project_ID and department are never editable — the ID is permanent and its
 * prefix must keep matching the department it was issued under (§3).
 */

/** Fields a project owner may change on their own project (§2). */
const OWNER_FIELDS = [
  "status_id",
  "progress_percent",
  "next_step",
  "objective",
  "notes",
  "use_checkpoints",
  "checkpoint_due_date",
  "final_due_date",
] as const;

/** Additional fields reserved for admins. */
const ADMIN_FIELDS = [
  "project_name",
  "project_type",
  "phase",
  "priority",
  "owner_user_id",
  "owner_name",
  "data_owner",
  "system_owner",
  "connection_review_status",
] as const;

const LABELS: Record<string, string> = {
  status_id: "STATUS",
  progress_percent: "PROGRESS",
  final_due_date: "DUE_DATE",
  checkpoint_due_date: "CHECKPOINT",
  owner_user_id: "OWNER",
  project_type: "PROJECT_TYPE",
  connection_review_status: "CONNECTION_REVIEW",
};

function coerce(field: string, value: unknown, session: SessionUser): unknown {
  switch (field) {
    case "progress_percent":
      return assertValidProgress(value);
    case "status_id":
      return assertValidStatus(value);
    case "checkpoint_due_date":
      return assertValidDate(value, "Checkpoint date");
    case "final_due_date":
      return assertValidDate(value, "Final due date");
    case "use_checkpoints":
      return value ? 1 : 0;
    case "priority": {
      if (value === null || value === "") return null;
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        throw new ValidationError("Priority must be a whole number from 1 to 5.");
      }
      return n;
    }
    case "project_type":
      if (value !== "APPROVED" && value !== "FUTURE_ADDON") {
        throw new ValidationError("Project type must be Approved or Future Add-on.");
      }
      return value;
    case "connection_review_status": {
      const allowed = ["NOT_REVIEWED", "AI_REVIEWED", "HUMAN_REVIEWED", "CONFIRMED"];
      if (typeof value !== "string" || !allowed.includes(value)) {
        throw new ValidationError("That is not a valid connection review status.");
      }
      return value;
    }
    case "project_name": {
      if (typeof value !== "string" || !value.trim()) {
        throw new ValidationError("Project name cannot be empty.");
      }
      return value.trim();
    }
    case "owner_user_id": {
      if (value === null || value === "") return null;
      if (typeof value !== "string") throw new ValidationError("Owner is not valid.");
      const exists = get(`SELECT 1 FROM users WHERE user_id = ? AND active = 1`, [value]);
      if (!exists) throw new ValidationError("That user account does not exist.");
      return value;
    }
    default:
      if (value === null || value === undefined) return null;
      if (typeof value !== "string") return String(value);
      void session;
      return value.trim() || null;
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  return withSession(async (session) => {
    const before = getProject(id);
    if (!before || !before.active) throw new ValidationError(`Project "${id}" does not exist.`);
    if (!canEditProject(session, id)) {
      throw new ForbiddenError(
        `${id} is owned by another project owner. Ask an admin for access.`
      );
    }

    const body = await readJsonBody(request);

    if ("project_id" in body && body.project_id !== id) {
      throw new ValidationError("Project ID is permanent and cannot be changed.");
    }
    if ("dept_code" in body && body.dept_code !== before.dept_code) {
      throw new ValidationError(
        "Department cannot be changed — the Project ID prefix would no longer match."
      );
    }

    const allowed: string[] = [
      ...OWNER_FIELDS,
      ...(isAdmin(session) ? ADMIN_FIELDS : []),
    ];

    const rejected = Object.keys(body).filter(
      (k) => !allowed.includes(k) && k !== "project_id" && k !== "dept_code"
    );
    if (rejected.length && !isAdmin(session)) {
      throw new ForbiddenError(
        `Only an admin can change: ${rejected.join(", ")}.`
      );
    }

    const updates: Record<string, unknown> = {};
    for (const field of allowed) {
      if (field in body) updates[field] = coerce(field, body[field], session);
    }
    if (!Object.keys(updates).length) return { project: before, warnings: [] };

    // Warn on combinations that look wrong, but still save what was asked (§35).
    const warnings = projectWarnings({ ...before, ...updates });

    const setSql = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(", ");
    run(
      `UPDATE projects SET ${setSql}, updated_at = ?, updated_by = ? WHERE project_id = ?`,
      [...Object.values(updates), new Date().toISOString(), session.username, id]
    );

    recordFieldChanges(
      session,
      "PROJECT",
      id,
      before as unknown as Record<string, unknown>,
      updates,
      LABELS
    );

    return { project: getProject(id) as Project, warnings };
  });
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withSession(() => {
    const project = getProject(id);
    if (!project) throw new ValidationError(`Project "${id}" does not exist.`);
    return { project };
  });
}
