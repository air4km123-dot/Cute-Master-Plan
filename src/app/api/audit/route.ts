import { withSession } from "@/lib/api";
import { ForbiddenError } from "@/lib/auth";
import { canViewAuditLog } from "@/lib/permissions";
import type { InValue } from "@libsql/client";
import { all } from "@/lib/db";
import type { AuditEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Read the change history. Admin only (§2), and read-only for everyone (§24). */
export async function GET(request: Request) {
  return withSession(async (session) => {
    if (!canViewAuditLog(session)) {
      throw new ForbiddenError("Only an admin can read the audit log.");
    }

    const url = new URL(request.url);
    const entityType = url.searchParams.get("entityType");
    const entityId = url.searchParams.get("entityId");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 1000);

    const where: string[] = [];
    const params: InValue[] = [];
    if (entityType) {
      where.push("entity_type = ?");
      params.push(entityType);
    }
    if (entityId) {
      where.push("entity_id = ?");
      params.push(entityId);
    }

    const entries = await all<AuditEntry>(
      `SELECT * FROM audit_log
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY audit_id DESC
        LIMIT ?`,
      [...params, limit]
    );

    return { entries };
  });
}
