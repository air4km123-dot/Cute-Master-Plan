import { ForbiddenError } from "@/lib/auth";
import { withSession } from "@/lib/api";
import { canSyncGoogleSheet } from "@/lib/permissions";
import { applyGoogleSheetSync, syncStatus } from "@/lib/googleSheetsSync";

/**
 * POST /api/sync/google-sheet/apply
 *
 * Apply the safe subset of source-field changes. Critical conflicts — a
 * department change, a duplicate or ambiguous row — are skipped and left for a
 * human. New rows are never created and missing rows are never deleted.
 *
 * The body is ignored on purpose: the plan is re-derived from a fresh read of
 * the sheet rather than trusting one posted by the browser, so a stale preview
 * cannot write outdated values and a crafted payload cannot write arbitrary
 * ones. What the admin authorises is the act of applying.
 */
export async function POST() {
  return withSession(async (session) => {
    if (!canSyncGoogleSheet(session)) {
      throw new ForbiddenError("Only an admin can synchronise the Google Sheet.");
    }
    const result = await applyGoogleSheetSync(session);
    return {
      runId: result.runId,
      appliedProjects: result.appliedProjects,
      appliedFields: result.appliedFields,
      skippedBlocked: result.skippedBlocked,
      plan: result.plan,
      status: await syncStatus(),
    };
  });
}
