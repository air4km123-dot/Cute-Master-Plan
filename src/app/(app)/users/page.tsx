import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import { all } from "@/lib/db";
import { getDepartments } from "@/lib/queries";
import UsersView from "@/components/UsersView";
import type { AppUser } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users — Air4 Master Plan" };

export default async function UsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManageUsers(session)) redirect("/");

  // password_hash is never selected.
  const users = await all<AppUser>(
    `SELECT user_id, username, display_name, role, department_id,
            must_set_password, active, created_at, last_login
       FROM users
      ORDER BY CASE role WHEN 'ADMIN' THEN 0 WHEN 'OWNER' THEN 1 ELSE 2 END, username`
  );
  const counts = await all<{ owner_user_id: string; n: number }>(
    `SELECT owner_user_id, COUNT(*) n FROM projects
      WHERE active = 1 AND owner_user_id IS NOT NULL GROUP BY owner_user_id`
  );

  return (
    <UsersView
      users={users}
      departments={await getDepartments()}
      ownedCounts={Object.fromEntries(counts.map((c) => [c.owner_user_id, c.n]))}
      currentUserId={session.userId}
    />
  );
}
