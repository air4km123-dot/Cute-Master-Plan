import { ForbiddenError } from "@/lib/auth";
import { withSession } from "@/lib/api";
import { canSyncGoogleSheet } from "@/lib/permissions";
import { checkGoogleSheet, syncStatus } from "@/lib/googleSheetsSync";

/**
 * POST /api/sync/google-sheet/check
 *
 * Read the sheet and report what differs from the working copy. Preview only —
 * no project, connection or audit row is written. The run itself is journalled
 * in sync_runs so "when did we last look at the sheet" stays answerable.
 */
export async function POST() {
  return withSession(async (session) => {
    if (!canSyncGoogleSheet(session)) {
      throw new ForbiddenError("Only an admin can synchronise the Google Sheet.");
    }
    const plan = await checkGoogleSheet(session);
    return { plan, status: await syncStatus() };
  });
}
