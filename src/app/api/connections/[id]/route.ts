import { withSession, readJsonBody } from "@/lib/api";
import { ForbiddenError } from "@/lib/auth";
import { canEditConnection, canReviewConnection } from "@/lib/permissions";
import { getConnection } from "@/lib/queries";
import { recordAudit, recordFieldChanges } from "@/lib/audit";
import type { InValue } from "@libsql/client";
import { run } from "@/lib/db";
import {
  ValidationError,
  assertConnectionEndpoints,
  assertLabel,
  assertValidConnectionType,
  connectionWarnings,
} from "@/lib/validation";

/**
 * Edit, approve or reject a connection (§12, §13).
 *
 * Approving and rejecting are admin decisions. Editing the content of a
 * connection is open to anyone who can edit a project at either end, and an
 * edit to an already-approved connection moves it to Edited so the diagram
 * still shows it as confirmed architecture while recording that it changed.
 */

const REVIEW_ACTIONS = new Set(["approve", "reject", "reset"]);

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  return withSession(async (session) => {
    const before = await getConnection(id);
    if (!before || !before.active) {
      throw new ValidationError(`Connection "${id}" does not exist.`);
    }

    const body = await readJsonBody(request);
    const action = typeof body.action === "string" ? body.action : null;
    const now = new Date().toISOString();

    // ---- review decisions -------------------------------------------------
    if (action && REVIEW_ACTIONS.has(action)) {
      if (!canReviewConnection(session)) {
        throw new ForbiddenError("Only an admin can approve or reject connections.");
      }

      const status =
        action === "approve" ? "APPROVED" : action === "reject" ? "REJECTED" : "AI_SUGGESTED";

      if (action === "reset" && !before.proposed_by) {
        throw new ValidationError("This connection was not proposed by the analyser.");
      }

      await run(
        `UPDATE connections
            SET connection_status = ?, reviewed_by = ?, review_date = ?, updated_at = ?, updated_by = ?
          WHERE connection_id = ?`,
        [
          status,
          action === "reset" ? null : session.username,
          action === "reset" ? null : now,
          now,
          session.username,
          id,
        ]
      );

      await recordAudit({
        actor: session,
        action:
          action === "approve"
            ? "APPROVE_CONNECTION"
            : action === "reject"
              ? "REJECT_CONNECTION"
              : "RESET_CONNECTION_REVIEW",
        entityType: "CONNECTION",
        entityId: id,
        fieldName: "connection_status",
        oldValue: before.connection_status,
        newValue: status,
        notes: `${before.source_project_id} → ${before.target_project_id} (${before.connection_label})`,
      });

      return { connection: await getConnection(id), warnings: [] };
    }

    // ---- content edits ----------------------------------------------------
    const source = (body.source_project_id as string) ?? before.source_project_id;
    const target = (body.target_project_id as string) ?? before.target_project_id;

    if (source !== before.source_project_id || target !== before.target_project_id) {
      await assertConnectionEndpoints(source, target);
    }

    if (!(await canEditConnection(session, source, target))) {
      throw new ForbiddenError("You can only edit connections that touch a project you own.");
    }

    const updates: Record<string, unknown> = {};
    if ("source_project_id" in body) updates.source_project_id = source;
    if ("target_project_id" in body) updates.target_project_id = target;
    if ("connection_label" in body) updates.connection_label = assertLabel(body.connection_label);
    if ("connection_type" in body) {
      updates.connection_type = await assertValidConnectionType(body.connection_type);
    }
    if ("direction" in body) {
      updates.direction = body.direction === "BIDIRECTIONAL" ? "BIDIRECTIONAL" : "ONE_WAY";
    }
    if ("detailed_description" in body) {
      updates.detailed_description = (body.detailed_description as string)?.trim() || null;
    }
    if ("data_or_process_name" in body) {
      updates.data_or_process_name = (body.data_or_process_name as string)?.trim() || null;
    }

    if (!Object.keys(updates).length) return { connection: before, warnings: [] };

    // An edit to confirmed architecture is recorded as Edited, not silently
    // left as Approved (§12).
    if (before.connection_status === "APPROVED") updates.connection_status = "EDITED";

    const setSql = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(", ");
    await run(
      `UPDATE connections SET ${setSql}, updated_at = ?, updated_by = ? WHERE connection_id = ?`,
      [...(Object.values(updates) as InValue[]), now, session.username, id]
    );

    await recordFieldChanges(
      session,
      "CONNECTION",
      id,
      before as unknown as Record<string, unknown>,
      updates
    );

    return {
      connection: await getConnection(id),
      warnings: await connectionWarnings(source, target, id),
    };
  });
}

/**
 * Deactivate a connection. The row is kept so the audit trail still resolves,
 * matching how projects are deactivated rather than deleted (§24).
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  return withSession(async (session) => {
    const before = await getConnection(id);
    if (!before || !before.active) {
      throw new ValidationError(`Connection "${id}" does not exist.`);
    }
    if (!(await canEditConnection(session, before.source_project_id, before.target_project_id))) {
      throw new ForbiddenError("You can only delete connections that touch a project you own.");
    }

    await run(
      `UPDATE connections SET active = 0, updated_at = ?, updated_by = ? WHERE connection_id = ?`,
      [new Date().toISOString(), session.username, id]
    );

    await recordAudit({
      actor: session,
      action: "DELETE_CONNECTION",
      entityType: "CONNECTION",
      entityId: id,
      oldValue: `${before.source_project_id} → ${before.target_project_id} (${before.connection_label})`,
      newValue: null,
      notes: "Connection deactivated; the record is kept for the audit trail",
    });

    return { ok: true };
  });
}
