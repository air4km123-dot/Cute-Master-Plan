import "server-only";
import { all } from "./db";
import type { SessionUser } from "./types";

/**
 * Role model.
 *
 *   ADMIN   full control, user management, audit log, connection approval,
 *           Google Sheet sync
 *   VIEWER  reads the whole company Master Plan; edits nothing
 *   OWNER   legacy. Edits only the projects assigned to their User_ID.
 *
 * ---------------------------------------------------------------------------
 * VISIBILITY IS COMPANY-WIDE. Department is not access control.
 * ---------------------------------------------------------------------------
 *
 * Air4 Master Plan is one shared corporate blueprint: every role sees every
 * department, every project and every connection. `masterPlanData` in
 * queries.ts selects all active rows for everyone — the department filter in
 * the UI is a lens, not a boundary, and clearing it always returns the whole
 * company.
 *
 * `users.department_id` is descriptive metadata that appears on the Users page.
 * It has never been consulted in a permission decision and must not be: there
 * is no AF login, no PG login, and no row-level department security. Likewise
 * `projects.owner_name` (ผู้รับผิดชอบ from the sheet) is project metadata, not
 * an account and not a grant.
 *
 * The intended model is now just ADMIN and VIEWER. OWNER is kept because the
 * database still holds 27 owner rows and their grants, and deleting them would
 * destroy history for no benefit — every one of those accounts is passwordless
 * and cannot sign in. Nothing new should extend the OWNER path: features added
 * from here on are ADMIN-or-read-only, which is why sheet sync below checks
 * only for ADMIN and never looks at a department or an owner.
 */

/** Roles offered when creating a new account. OWNER is legacy and not on offer. */
export const ASSIGNABLE_ROLES = ["ADMIN", "VIEWER"] as const;

export function isAdmin(user: SessionUser): boolean {
  return user.role === "ADMIN";
}

/** Project IDs this user may edit. Admins get every active project. */
export function editableProjectIds(user: SessionUser): string[] {
  if (user.role === "ADMIN") {
    return all<{ project_id: string }>(
      `SELECT project_id FROM projects WHERE active = 1`
    ).map((r) => r.project_id);
  }
  if (user.role !== "OWNER") return [];

  return all<{ project_id: string }>(
    `SELECT p.project_id
       FROM projects p
      WHERE p.active = 1
        AND (p.owner_user_id = ?
             OR EXISTS (SELECT 1 FROM user_projects up
                         WHERE up.user_id = ? AND up.project_id = p.project_id))`,
    [user.userId, user.userId]
  ).map((r) => r.project_id);
}

export function canEditProject(user: SessionUser, projectId: string): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role !== "OWNER") return false;
  return editableProjectIds(user).includes(projectId);
}

/** Creating or editing a connection requires edit rights on one of its ends. */
export function canEditConnection(
  user: SessionUser,
  sourceProjectId: string,
  targetProjectId: string
): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role !== "OWNER") return false;
  const editable = editableProjectIds(user);
  return editable.includes(sourceProjectId) || editable.includes(targetProjectId);
}

/** Approving or rejecting an AI suggestion is an ADMIN decision (§2, §12). */
export function canReviewConnection(user: SessionUser): boolean {
  return user.role === "ADMIN";
}

export function canManageUsers(user: SessionUser): boolean {
  return user.role === "ADMIN";
}

export function canViewAuditLog(user: SessionUser): boolean {
  return user.role === "ADMIN";
}

export function canCreateProject(user: SessionUser): boolean {
  return user.role === "ADMIN";
}

/**
 * Google Sheet sync is a company-level operation, not a departmental one: one
 * engine reads one sheet and updates every department's projects in a single
 * pass. Deliberately no department or owner input — an admin is an admin.
 */
export function canSyncGoogleSheet(user: SessionUser): boolean {
  return user.role === "ADMIN";
}
