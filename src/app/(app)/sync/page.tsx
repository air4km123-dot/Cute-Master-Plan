import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canSyncGoogleSheet } from "@/lib/permissions";
import { syncStatus } from "@/lib/googleSheetsSync";
import SyncView from "@/components/SyncView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Google Sheet sync — Air4 Master Plan" };

/**
 * The page is readable by any signed-in account — it reports on the company
 * sheet, and there is nothing department-specific to withhold. Running a check
 * or an apply is admin-only, enforced again in the API routes.
 */
export default async function SyncPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <SyncView initialStatus={await syncStatus()} canSync={canSyncGoogleSheet(session)} />;
}
