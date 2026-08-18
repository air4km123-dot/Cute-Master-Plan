import "server-only";
import { db } from "./db";
import type { SessionUser } from "./types";

/**
 * Append-only change history (Addendum V2 §23, §24).
 *
 * The application never exposes an UPDATE or DELETE path for audit_log, so a
 * normal user cannot rewrite history. One row is written per changed field so
 * "45 → 60" style questions can be answered directly.
 */

const insert = db.prepare(`
  INSERT INTO audit_log (timestamp, user_id, username, action, entity_type, entity_id,
                         field_name, old_value, new_value, source, notes)
  VALUES (@timestamp, @user_id, @username, @action, @entity_type, @entity_id,
          @field_name, @old_value, @new_value, @source, @notes)
`);

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

export function recordAudit(entry: AuditInput): void {
  insert.run({
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
  });
}

/**
 * Compare a record before and after an edit and log one row per changed
 * field. Returns the fields that actually changed.
 */
export function recordFieldChanges(
  actor: SessionUser,
  entityType: AuditInput["entityType"],
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string> = {}
): string[] {
  const changed: string[] = [];
  for (const [key, next] of Object.entries(after)) {
    const prev = before[key];
    if (asText(prev) === asText(next)) continue;
    changed.push(key);
    recordAudit({
      actor,
      action: `UPDATE_${labels[key] ?? key.toUpperCase()}`,
      entityType,
      entityId,
      fieldName: key,
      oldValue: prev,
      newValue: next,
    });
  }
  return changed;
}
