"use client";

import { useMemo, useState } from "react";
import type { AuditEntry } from "@/lib/types";

/**
 * Change history (§23, §24).
 *
 * Read-only by construction — the application exposes no route that updates or
 * deletes an audit row, so there is nothing to render here but the record.
 */

const ENTITY_TYPES = ["ALL", "PROJECT", "CONNECTION", "USER", "SESSION", "SYSTEM"] as const;

export default function AuditView({
  entries,
  total,
}: {
  entries: AuditEntry[];
  total: number;
}) {
  const [entityType, setEntityType] = useState<(typeof ENTITY_TYPES)[number]>("ALL");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (entityType !== "ALL" && entry.entity_type !== entityType) return false;
      if (!needle) return true;
      return [entry.username, entry.action, entry.entity_id, entry.field_name, entry.notes]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [entries, entityType, search]);

  return (
    <div className="h-full overflow-y-auto thin-scroll">
      <div className="max-w-[1180px] mx-auto p-6">
        <header className="mb-5">
          <h1 className="anno-lg text-[17px]">Audit log</h1>
          <p className="note mt-1 max-w-[62ch]">
            Every change to a project, connection or account. Records cannot be edited or removed
            from the application. Showing the {entries.length} most recent of {total}.
          </p>
        </header>

        <div className="panel">
          <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-rule">
            <div className="flex items-stretch border border-rule">
              {ENTITY_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => setEntityType(type)}
                  aria-pressed={entityType === type}
                  className="anno px-2.5 py-1.5 border-r border-rule last:border-r-0"
                  style={
                    entityType === type ? { background: "var(--color-ink)", color: "#fff" } : undefined
                  }
                >
                  {type === "ALL" ? "All" : type.toLowerCase()}
                </button>
              ))}
            </div>
            <input
              className="field w-[240px]"
              placeholder="Filter by user, action or ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Filter audit entries"
            />
            <div className="flex-1" />
            <span className="anno">{rows.length} shown</span>
          </div>

          {rows.length === 0 ? (
            <p className="note p-4">No entries match that filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Change</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <tr key={entry.audit_id}>
                      <td className="data whitespace-nowrap">
                        {new Date(entry.timestamp).toLocaleString()}
                      </td>
                      <td className="text-[12px] whitespace-nowrap">{entry.username ?? "—"}</td>
                      <td>
                        <span className="anno">{entry.action.replace(/_/g, " ")}</span>
                      </td>
                      <td className="whitespace-nowrap">
                        {entry.entity_id ? (
                          <span className="partno">{entry.entity_id}</span>
                        ) : (
                          <span className="anno">{entry.entity_type}</span>
                        )}
                      </td>
                      <td className="max-w-[400px]">
                        {entry.field_name ? (
                          <span className="text-[12px]">
                            <span className="anno">{entry.field_name}</span>{" "}
                            <span className="data">{entry.old_value ?? "—"}</span>
                            <span aria-hidden> → </span>
                            <span className="data font-bold">{entry.new_value ?? "—"}</span>
                          </span>
                        ) : (
                          <span className="text-[12px]">{entry.notes ?? "—"}</span>
                        )}
                        {entry.field_name && entry.notes && (
                          <div className="note mt-0.5">{entry.notes}</div>
                        )}
                      </td>
                      <td className="anno">{entry.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
