import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { masterPlanData } from "@/lib/queries";
import MasterPlan from "@/components/MasterPlan";

export const dynamic = "force-dynamic";

export default async function MasterPlanPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <MasterPlan initialData={await masterPlanData(session)} />;
}
