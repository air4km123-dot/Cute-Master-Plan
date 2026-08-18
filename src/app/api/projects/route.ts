import { withSession, readJsonBody } from "@/lib/api";
import { ForbiddenError } from "@/lib/auth";
import { canCreateProject } from "@/lib/permissions";
import { getProject, nextProjectId } from "@/lib/queries";
import { recordAudit } from "@/lib/audit";
import { run } from "@/lib/db";
import {
  ValidationError,
  assertValidDate,
  assertValidDepartment,
  assertValidProgress,
  assertValidStatus,
} from "@/lib/validation";

/**
 * Create a project.
 *
 * Used both for genuinely new approved projects and for Future Add-ons that
 * come out of gap analysis (§5, §6). A Future Add-on takes the normal next
 * number in its department sequence — the ID stays simple and permanent, and
 * the "future" meaning lives in project_type, not in the identifier.
 */
export async function POST(request: Request) {
  return withSession(async (session) => {
    if (!canCreateProject(session)) {
      throw new ForbiddenError("Only an admin can add projects to the Master Plan.");
    }

    const body = await readJsonBody(request);

    const deptCode = assertValidDepartment(body.dept_code);
    const name = typeof body.project_name === "string" ? body.project_name.trim() : "";
    if (!name) throw new ValidationError("Give the project a name.");

    const projectType = body.project_type === "FUTURE_ADDON" ? "FUTURE_ADDON" : "APPROVED";
    const statusId = body.status_id ? assertValidStatus(body.status_id) : "NOT_STARTED";
    const progress = body.progress_percent === undefined ? 0 : assertValidProgress(body.progress_percent);
    const checkpoint = assertValidDate(body.checkpoint_due_date, "Checkpoint date");
    const finalDue = assertValidDate(body.final_due_date, "Final due date");

    const projectId = nextProjectId(deptCode);
    const now = new Date().toISOString();

    run(
      `INSERT INTO projects (
         project_id, dept_code, project_name, project_type, phase, priority,
         owner_user_id, owner_name, data_owner, system_owner, objective, brief, notes,
         status_id, status_original, next_step, progress_percent,
         use_checkpoints, checkpoint_due_date, final_due_date,
         connection_review_status, active, created_at, updated_at, updated_by
       ) VALUES (?, ?, ?, ?, 'PHASE_1', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?,
                 'NOT_REVIEWED', 1, ?, ?, ?)`,
      [
        projectId,
        deptCode,
        name,
        projectType,
        body.priority === undefined || body.priority === null ? null : Number(body.priority),
        (body.owner_user_id as string) || null,
        (body.owner_name as string) || null,
        (body.data_owner as string) || null,
        (body.system_owner as string) || null,
        (body.objective as string) || null,
        (body.brief as string) || null,
        (body.notes as string) || null,
        statusId,
        (body.next_step as string) || null,
        progress,
        body.use_checkpoints ? 1 : 0,
        checkpoint,
        finalDue,
        now,
        now,
        session.username,
      ]
    );

    recordAudit({
      actor: session,
      action: projectType === "FUTURE_ADDON" ? "CREATE_FUTURE_ADDON" : "CREATE_PROJECT",
      entityType: "PROJECT",
      entityId: projectId,
      newValue: name,
      notes: `${projectType === "FUTURE_ADDON" ? "Future add-on" : "Approved project"} created in ${deptCode}`,
    });

    return { project: getProject(projectId) };
  });
}
