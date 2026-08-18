import { withSession } from "@/lib/api";
import { governanceSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Soft-audit readiness figures (§36, §37). Readable by any signed-in user. */
export async function GET() {
  return withSession(() => governanceSummary());
}
