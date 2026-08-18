import "server-only";
import type { Transaction } from "@libsql/client";
import { run } from "./db";
import type { SessionUser } from "./types";

/**
 * Append-only change history (Addendum V2 §23, §24).
 *
 * The application never exposes an UPDATE or DELETE path for audit_log, so a
 * normal user cannot rewrite history. One row is written per changed field so
 * "45 → 60" style questions can be answered directly.
 *
 * Every function takes an optional transaction. When a write must land together
 * with its audit rows — applying a sheet sync, creating a project, recording a
 * connection review — the caller passes the open transaction so a rollback takes
 * the history with it. Without one, the row is written on its own connection.
 */

const INSERT = `
  INSERT INTO audit_log (timestamp, user_id, username, action, entity_type, entity_id,
                         field_name, old_value, new_value, source, notes)
  VALUES (:timestamp, :user_id, :username, :action, :entity_type, :entity_id,
          :field_name, :old_value, :new_value, :source, :notes)
`;

export interface AuditInput {
  actor: SessionUser | null;
  action: string;
  entityType: "PROJECT" | "CONNECTION" | "USER" | "SYSTEM" | "SESSION";
  entityId?: string | null;
  fieldName?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  notes?: string | null;
  source?: string;
}

const asText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
};

function argsFor(entry: AuditInput) {
  return {
    timestamp: new Date().toISOString(),
    user_id: entry.actor?.userId ?? null,
    username: entry.actor?.username ?? null,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    field_name: entry.fieldName ?? null,
    old_value: asText(entry.oldValue),
    new_value: asText(entry.newValue),
    source: entry.source ?? "WEB_APP",
    notes: entry.notes ?? null,
  };
}

export async function recordAudit(entry: AuditInput, tx?: Transaction): Promise<void> {
  const args = argsFor(entry);
  if (tx) {
    await tx.execute({ sql: INSERT, args });
    return;
  }
  await run(INSERT, args);
}

/**
 * Compare a record before and after an edit and log one row per changed
 * field. Returns the fields that actually changed.
 */
export async function recordFieldChanges(
  actor: SessionUser,
  entityType: AuditInput["entityType"],
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string> = {},
  tx?: Transaction
): Promise<string[]> {
  const changed: string[] = [];
  for (const [key, next] of Object.entries(after)) {
    const prev = before[key];
    if (asText(prev) === asText(next)) continue;
    changed.push(key);
    await recordAudit(
      {
        actor,
        action: `UPDATE_${labels[key] ?? key.toUpperCase()}`,
        entityType,
        entityId,
        fieldName: key,
        oldValue: prev,
        newValue: next,
      },
      tx
    );
  }
  return changed;
}
