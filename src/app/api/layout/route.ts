import { withSession, readJsonBody } from "@/lib/api";
import { ForbiddenError } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { ValidationError } from "@/lib/validation";

/**
 * Save card positions, keyed by Project_ID (§3).
 *
 * Layout is presentation state, not business data, so it does not write a row
 * per card to the audit log — one summary entry per rearrangement is enough.
 */
export async function POST(request: Request) {
  return withSession(async (session) => {
    if (!isAdmin(session)) {
      throw new ForbiddenError("Only an admin can rearrange the Master Plan.");
    }

    const body = await readJsonBody(request);
    const positions = body.positions;
    if (!Array.isArray(positions)) {
      throw new ValidationError("Expected a list of positions.");
    }

    const update = db.prepare(
      `UPDATE projects SET layout_x = ?, layout_y = ? WHERE project_id = ?`
    );
    const apply = db.transaction((rows: { id: string; x: number; y: number }[]) => {
      for (const row of rows) update.run(row.x, row.y, row.id);
    });

    const clean = positions
      .filter(
        (p): p is { id: string; x: number; y: number } =>
          !!p &&
          typeof p.id === "string" &&
          Number.isFinite(p.x) &&
          Number.isFinite(p.y)
      )
      .map((p) => ({ id: p.id, x: p.x, y: p.y }));

    apply(clean);

    recordAudit({
      actor: session,
      action: "REARRANGE_LAYOUT",
      entityType: "SYSTEM",
      notes: `Saved positions for ${clean.length} project card(s)`,
    });

    return { saved: clean.length };
  });
}

/** Clear saved positions so the diagram falls back to the computed layout. */
export async function DELETE() {
  return withSession((session) => {
    if (!isAdmin(session)) {
      throw new ForbiddenError("Only an admin can reset the Master Plan layout.");
    }
    db.prepare(`UPDATE projects SET layout_x = NULL, layout_y = NULL`).run();
    recordAudit({
      actor: session,
      action: "RESET_LAYOUT",
      entityType: "SYSTEM",
      notes: "Reset all card positions to the automatic layout",
    });
    return { ok: true };
  });
}
