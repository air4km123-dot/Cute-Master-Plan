import { withSession } from "@/lib/api";
import { masterPlanData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return withSession((session) => masterPlanData(session));
}
