import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { governanceSummary, getDepartments, getStatuses } from "@/lib/queries";
import GovernanceView from "@/components/GovernanceView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Governance — Air4 Master Plan" };

export default async function GovernancePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Three independent reads — issued together rather than in series, because
  // each is now a round trip to Turso.
  const [summary, departments, statuses] = await Promise.all([
    governanceSummary(),
    getDepartments(),
    getStatuses(),
  ]);

  return <GovernanceView summary={summary} departments={departments} statuses={statuses} />;
}
