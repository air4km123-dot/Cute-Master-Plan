import { withSession, readJsonBody } from "@/lib/api";
import { ForbiddenError, hashPassword, passwordProblem } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import type { InValue } from "@libsql/client";
import { get, run } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { ValidationError, assertValidDepartment } from "@/lib/validation";
import type { AppUser, Role } from "@/lib/types";

const ROLES: Role[] = ["ADMIN", "OWNER", "VIEWER"];
const SAFE_COLUMNS = `user_id, username, display_name, role, department_id,
                      must_set_password, active, created_at, last_login`;

/**
 * Update an account: set a password, change role or department, deactivate.
 *
 * Passwords arrive here in the request body over the session-authenticated
 * channel, are hashed immediately, and the plain value is never written to a
 * log, an audit row or the response (§1).
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  return withSession(async (session) => {
    if (!canManageUsers(session)) {
      throw new ForbiddenError("Only an admin can change user accounts.");
    }

    const before = await get<AppUser>(`SELECT ${SAFE_COLUMNS} FROM users WHERE user_id = ?`, [id]);
    if (!before) throw new ValidationError("That user account does not exist.");

    const body = await readJsonBody(request);
    const updates: Record<string, unknown> = {};
    const auditNotes: string[] = [];

    if ("password" in body) {
      const problem = passwordProblem(body.password as string);
      if (problem) throw new ValidationError(problem);
      updates.password_hash = hashPassword(body.password as string);
      updates.must_set_password = 0;
      auditNotes.push("password set");
    }

    if ("role" in body) {
      const role = body.role as Role;
      if (!ROLES.includes(role)) throw new ValidationError("Choose Admin, Owner or Viewer.");
      if (before.role === "ADMIN" && role !== "ADMIN") {
        const admins = await get<{ n: number }>(
          `SELECT COUNT(*) n FROM users WHERE role = 'ADMIN' AND active = 1`
        );
        if ((admins?.n ?? 0) <= 1) {
          throw new ValidationError("This is the only active admin. Promote someone else first.");
        }
      }
      updates.role = role;
    }

    if ("display_name" in body) {
      const name = String(body.display_name ?? "").trim();
      if (!name) throw new ValidationError("Display name cannot be empty.");
      updates.display_name = name;
    }

    if ("department_id" in body) {
      updates.department_id = body.department_id
        ? await assertValidDepartment(body.department_id)
        : null;
    }

    if ("active" in body) {
      const active = body.active ? 1 : 0;
      if (!active && before.user_id === session.userId) {
        throw new ValidationError("You cannot deactivate your own account.");
      }
      if (!active && before.role === "ADMIN") {
        const admins = await get<{ n: number }>(
          `SELECT COUNT(*) n FROM users WHERE role = 'ADMIN' AND active = 1`
        );
        if ((admins?.n ?? 0) <= 1) {
          throw new ValidationError("This is the only active admin.");
        }
      }
      updates.active = active;
    }

    if (!Object.keys(updates).length) return { user: before };

    const setSql = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(", ");
    await run(`UPDATE users SET ${setSql} WHERE user_id = ?`, [
      ...(Object.values(updates) as InValue[]),
      id,
    ]);

    // Record what changed, never the credential itself.
    for (const [field, value] of Object.entries(updates)) {
      if (field === "password_hash" || field === "must_set_password") continue;
      await recordAudit({
        actor: session,
        action: "UPDATE_PERMISSIONS",
        entityType: "USER",
        entityId: id,
        fieldName: field,
        oldValue: (before as unknown as Record<string, unknown>)[field],
        newValue: value,
      });
    }
    if (auditNotes.length) {
      await recordAudit({
        actor: session,
        action: "SET_PASSWORD",
        entityType: "USER",
        entityId: id,
        notes: `Password set for ${before.username}`,
      });
    }

    return {
      user: await get<AppUser>(`SELECT ${SAFE_COLUMNS} FROM users WHERE user_id = ?`, [id]),
    };
  });
}
