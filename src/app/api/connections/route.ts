import { withSession, readJsonBody } from "@/lib/api";
import { ForbiddenError } from "@/lib/auth";
import { canEditConnection, isAdmin } from "@/lib/permissions";
import { getConnection, nextConnectionId } from "@/lib/queries";
import { recordAudit } from "@/lib/audit";
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
    await assertConnectionEndpoints(source, target);

    if (!(await canEditConnection(session, source as string, target as string))) {
      throw new ForbiddenError(
        "You can only create connections that touch a project you own."
      );
    }

    const type = await assertValidConnectionType(body.connection_type);
    const label = assertLabel(body.connection_label);
    const direction = body.direction === "BIDIRECTIONAL" ? "BIDIRECTIONAL" : "ONE_WAY";

    const warnings = await connectionWarnings(source as string, target as string);

    const connectionId = await nextConnectionId();
    const now = new Date().toISOString();
    const status = isAdmin(session) ? "APPROVED" : "NOT_REVIEWED";

    await run(
      `INSERT INTO connections (
         connection_id, source_project_id, target_project_id, direction, connection_type,
         connection_label, detailed_description, data_or_process_name, connection_status,
         proposed_by, reviewed_by, review_date, confidence, reason,
         active, created_at, updated_at, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?, ?, ?)`,
      [
        connectionId,
        source as InValue,
        target as InValue,
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

    await recordAudit({
      actor: session,
      action: "CREATE_CONNECTION",
      entityType: "CONNECTION",
      entityId: connectionId,
      newValue: `${source} → ${target} (${label})`,
      notes: `Created manually as ${status}`,
    });

    const connection = await getConnection(connectionId);
    if (!connection) {
      throw new ValidationError("The connection could not be saved.");
    }

    return { connection, warnings };
  });
}
