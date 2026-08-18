import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canViewAuditLog } from "@/lib/permissions";
import { all } from "@/lib/db";
import AuditView from "@/components/AuditView";
import type { AuditEntry } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log — Air4 Master Plan" };

export default async function AuditPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canViewAuditLog(session)) redirect("/");

  const entries = all<AuditEntry>(
    `SELECT * FROM audit_log ORDER BY audit_id DESC LIMIT 500`
  );
  const total =
    all<{ n: number }>(`SELECT COUNT(*) n FROM audit_log`)[0]?.n ?? entries.length;

  return <AuditView entries={entries} total={total} />;
}
