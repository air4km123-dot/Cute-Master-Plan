import { withSession } from "@/lib/api";
import { syncStatus } from "@/lib/googleSheetsSync";

/**
 * GET /api/sync/google-sheet/status
 *
 * Last check, last apply, open conflicts and any project currently flagged
 * SOURCE_MISSING. Readable by any signed-in account — it reports on the
 * company-wide sheet, so there is nothing department-specific to withhold.
 * Running a sync still requires an admin.
 */
export async function GET() {
  return withSession(() => syncStatus());
}
