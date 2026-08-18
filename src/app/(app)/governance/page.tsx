import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { governanceSummary, getDepartments, getStatuses } from "@/lib/queries";
import GovernanceView from "@/components/GovernanceView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Governance — Air4 Master Plan" };

export default async function GovernancePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <GovernanceView
      summary={governanceSummary()}
      departments={getDepartments()}
      statuses={getStatuses()}
    />
  );
}
