import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { applyGoogleSheetSync } from "@/lib/googleSheetsSync";
import { SheetAccessError } from "@/lib/googleSheets";
import { recordAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/types";

/**
 * POST /api/sync/google-sheet/auto
 *
 * The scheduled entry point, called once a day at 08:30 Asia/Bangkok
 * (01:30 UTC) by .github/workflows/daily-sheet-sync.yml.
 *
 * There is no session here — a scheduler has no cookie — so the route is
 * guarded by a shared secret instead:
 *
 *   Authorization: Bearer $SYNC_CRON_SECRET
 *
 * It applies exactly the same safe subset as the admin button. Department
 * changes, duplicate rows, ambiguous matches and unmapped statuses are still
 * refused and left for a human; new rows are still not created and missing rows
 * are still not deleted. An unattended run is never allowed to do more than a
 * supervised one.
 */

export const dynamic = "force-dynamic";

/** Constant-time compare so a wrong token cannot be found byte by byte. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Attributed to a service identity, so audit rows say who did it. */
const SCHEDULER: SessionUser = {
  userId: "SYSTEM_SCHEDULER",
  username: "scheduler",
  displayName: "Scheduled sync",
  role: "ADMIN",
  departmentId: null,
};

export async function POST(request: Request) {
  const expected = process.env.SYNC_CRON_SECRET?.trim();

  if (!expected) {
    // Refuse rather than run unauthenticated if the secret was never set.
    return NextResponse.json(
      { error: "Scheduled sync is not configured (SYNC_CRON_SECRET is unset)." },
      { status: 503 }
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token || !secretMatches(token, expected)) {
    recordAudit({
      actor: null,
      action: "SYNC_AUTH_FAILED",
      entityType: "SYSTEM",
      source: "SCHEDULER",
      notes: "Rejected a scheduled sync request with a missing or incorrect bearer token.",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await applyGoogleSheetSync(SCHEDULER);
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      appliedProjects: result.appliedProjects,
      appliedFields: result.appliedFields,
      skippedBlocked: result.skippedBlocked,
      summary: result.plan.summary,
    });
  } catch (error) {
    const message = error instanceof SheetAccessError ? error.message : "Scheduled sync failed.";
    if (!(error instanceof SheetAccessError)) console.error("[air4] scheduled sync:", error);
    recordAudit({
      actor: SCHEDULER,
      action: "GOOGLE_SHEET_SYNC_FAILED",
      entityType: "SYSTEM",
      source: "SCHEDULER",
      notes: message,
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
