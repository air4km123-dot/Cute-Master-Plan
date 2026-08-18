import { withSession, readJsonBody } from "@/lib/api";
import { ForbiddenError, hashPassword, passwordProblem } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import { all, get, run } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { ValidationError, assertValidDepartment } from "@/lib/validation";
import type { AppUser, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

const ROLES: Role[] = ["ADMIN", "OWNER", "VIEWER"];
const USERNAME_RE = /^[a-z0-9._-]{2,32}$/;

/** password_hash is never selected — it must not leave the server. */
const SAFE_COLUMNS = `user_id, username, display_name, role, department_id,
                      must_set_password, active, created_at, last_login`;

export async function GET() {
  return withSession((session) => {
    if (!canManageUsers(session)) {
      throw new ForbiddenError("Only an admin can manage user accounts.");
    }
    const users = all<AppUser>(
      `SELECT ${SAFE_COLUMNS} FROM users ORDER BY role, username`
    );
    const projectCounts = all<{ owner_user_id: string; n: number }>(
      `SELECT owner_user_id, COUNT(*) n FROM projects
        WHERE active = 1 AND owner_user_id IS NOT NULL GROUP BY owner_user_id`
    );
    return {
      users,
      ownedProjectCounts: Object.fromEntries(
        projectCounts.map((r) => [r.owner_user_id, r.n])
      ),
    };
  });
}

export async function POST(request: Request) {
  return withSession(async (session) => {
    if (!canManageUsers(session)) {
      throw new ForbiddenError("Only an admin can create user accounts.");
    }

    const body = await readJsonBody(request);
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
    const role = body.role as Role;

    if (!USERNAME_RE.test(username)) {
      throw new ValidationError(
        "Username must be 2–32 characters using letters, numbers, dot, dash or underscore."
      );
    }
    if (!displayName) throw new ValidationError("Give the account a display name.");
    if (!ROLES.includes(role)) throw new ValidationError("Choose Admin, Owner or Viewer.");
    if (get(`SELECT 1 FROM users WHERE username = ? COLLATE NOCASE`, [username])) {
      throw new ValidationError(`The username "${username}" is already taken.`);
    }

    const departmentId = body.department_id ? assertValidDepartment(body.department_id) : null;

    // A password is optional at creation. Without one the account exists but
    // cannot sign in, which is the safe default for bulk onboarding.
    let hash = "";
    let mustSet = 1;
    if (body.password) {
      const problem = passwordProblem(body.password as string);
      if (problem) throw new ValidationError(problem);
      hash = hashPassword(body.password as string);
      mustSet = 0;
    }

    const seq =
      (get<{ n: number }>(`SELECT COUNT(*) n FROM users`)?.n ?? 0) + 1;
    const userId = `USR-${String(seq).padStart(3, "0")}-${username.slice(0, 6).toUpperCase()}`;

    run(
      `INSERT INTO users (user_id, username, password_hash, display_name, role,
                          department_id, must_set_password, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [userId, username, hash, displayName, role, departmentId, mustSet, new Date().toISOString()]
    );

    recordAudit({
      actor: session,
      action: "CREATE_USER",
      entityType: "USER",
      entityId: userId,
      newValue: `${username} (${role})`,
      notes: mustSet ? "Created without a password" : "Created with a password",
    });

    return { user: get<AppUser>(`SELECT ${SAFE_COLUMNS} FROM users WHERE user_id = ?`, [userId]) };
  });
}
