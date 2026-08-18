import { withSession, readJsonBody } from "@/lib/api";
import { ForbiddenError } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { run, transaction } from "@/lib/db";
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

    const clean = positions
      .filter(
        (p): p is { id: string; x: number; y: number } =>
          !!p &&
          typeof p.id === "string" &&
          Number.isFinite(p.x) &&
          Number.isFinite(p.y)
      )
      .map((p) => ({ id: p.id, x: p.x, y: p.y }));

    // One transaction: a half-saved layout would leave the diagram inconsistent.
    await transaction(async (tx) => {
      for (const row of clean) {
        await tx.execute({
          sql: `UPDATE projects SET layout_x = ?, layout_y = ? WHERE project_id = ?`,
          args: [row.x, row.y, row.id],
        });
      }
    });

    await recordAudit({
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
  return withSession(async (session) => {
    if (!isAdmin(session)) {
      throw new ForbiddenError("Only an admin can reset the Master Plan layout.");
    }
    await run(`UPDATE projects SET layout_x = NULL, layout_y = NULL`);
    await recordAudit({
      actor: session,
      action: "RESET_LAYOUT",
      entityType: "SYSTEM",
      notes: "Reset all card positions to the automatic layout",
    });
    return { ok: true };
  });
}
