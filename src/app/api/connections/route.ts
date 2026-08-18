import { withSession, readJsonBody } from "@/lib/api";
import { ForbiddenError } from "@/lib/auth";
import { canEditConnection, isAdmin } from "@/lib/permissions";
import { getConnection, nextConnectionId } from "@/lib/queries";
import { recordAudit } from "@/lib/audit";
import { run } from "@/lib/db";
import {
  ValidationError,
  assertConnectionEndpoints,
  assertLabel,
  assertValidConnectionType,
  connectionWarnings,
} from "@/lib/validation";

/**
 * Create a connection by hand (§13).
 *
 * An admin drawing a connection is stating architecture, so it is recorded as
 * Approved straight away. A project owner proposing one is making a
 * suggestion, so it waits at Not Reviewed for an admin. Neither path can
 * produce an AI Suggested row — that status belongs to the analyser alone.
 */
export async function POST(request: Request) {
  return withSession(async (session) => {
    const body = await readJsonBody(request);

    const source = body.source_project_id;
    const target = body.target_project_id;
    assertConnectionEndpoints(source, target);

    if (!canEditConnection(session, source as string, target as string)) {
      throw new ForbiddenError(
        "You can only create connections that touch a project you own."
      );
    }

    const type = assertValidConnectionType(body.connection_type);
    const label = assertLabel(body.connection_label);
    const direction = body.direction === "BIDIRECTIONAL" ? "BIDIRECTIONAL" : "ONE_WAY";

    const warnings = connectionWarnings(source as string, target as string);

    const connectionId = nextConnectionId();
    const now = new Date().toISOString();
    const status = isAdmin(session) ? "APPROVED" : "NOT_REVIEWED";

    run(
      `INSERT INTO connections (
         connection_id, source_project_id, target_project_id, direction, connection_type,
         connection_label, detailed_description, data_or_process_name, connection_status,
         proposed_by, reviewed_by, review_date, confidence, reason,
         active, created_at, updated_at, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?, ?, ?)`,
      [
        connectionId,
        source,
        target,
        direction,
        type,
        label,
        (body.detailed_description as string) || null,
        (body.data_or_process_name as string) || label,
        status,
        session.username,
        isAdmin(session) ? session.username : null,
        isAdmin(session) ? now : null,
        now,
        now,
        session.username,
      ]
    );

    recordAudit({
      actor: session,
      action: "CREATE_CONNECTION",
      entityType: "CONNECTION",
      entityId: connectionId,
      newValue: `${source} → ${target} (${label})`,
      notes: `Created manually as ${status}`,
    });

    if (!getConnection(connectionId)) {
      throw new ValidationError("The connection could not be saved.");
    }

    return { connection: getConnection(connectionId), warnings };
  });
}
