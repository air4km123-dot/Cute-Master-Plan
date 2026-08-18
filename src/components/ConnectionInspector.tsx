"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  Connection,
  ConnectionType,
  Department,
  Project,
  SessionUser,
} from "@/lib/types";

/**
 * Connection detail panel (§18).
 *
 * Approving or rejecting is an admin decision. Anyone who can edit a project at
 * either end can change the content of a connection — and an edit to approved
 * architecture is recorded as Edited rather than quietly staying Approved.
 */

const STATUS_LABEL: Record<string, string> = {
  NOT_REVIEWED: "Not reviewed",
  AI_SUGGESTED: "AI suggested",
  APPROVED: "Approved",
  EDITED: "Edited",
  REJECTED: "Rejected",
};

interface Props {
  connection: Connection;
  projects: Map<string, Project>;
  departments: Map<string, Department>;
  connectionTypes: ConnectionType[];
  session: SessionUser;
  editable: boolean;
  editing: boolean;
  onClose: () => void;
  onChanged: () => void;
  onSelectProject: (projectId: string) => void;
}

export default function ConnectionInspector({
  connection,
  projects,
  departments,
  connectionTypes,
  session,
  editable,
  editing,
  onClose,
  onChanged,
  onSelectProject,
}: Props) {
  const canEdit = editable && editing;
  const canReview = session.role === "ADMIN";

  const [draft, setDraft] = useState(() => toDraft(connection));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    setDraft(toDraft(connection));
    setError(null);
    setWarnings([]);
  }, [connection]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(toDraft(connection)),
    [draft, connection]
  );

  const source = projects.get(connection.source_project_id);
  const target = projects.get(connection.target_project_id);
  const type = connectionTypes.find((t) => t.type_id === connection.connection_type);

  async function send(body: Record<string, unknown>, method: "PATCH" | "DELETE" = "PATCH") {
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const response = await fetch(`/api/connections/${connection.connection_id}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not save.");
        return false;
      }
      setWarnings(data.warnings ?? []);
      onChanged();
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b-2 border-ink shrink-0 px-3.5 py-2.5 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className="partno">{connection.connection_id}</span>
          <h2 className="text-[15px] font-semibold leading-tight mt-1">
            {connection.connection_label}
          </h2>
          <p className="anno mt-1">
            {STATUS_LABEL[connection.connection_status]}
            {connection.confidence ? ` · ${connection.confidence} confidence` : ""}
          </p>
        </div>
        <button onClick={onClose} className="btn btn-quiet shrink-0" aria-label="Close panel">
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        {/* ---- the flow ---- */}
        <section className="px-3.5 py-3 border-b border-rule">
          <Endpoint
            role="Source"
            project={source}
            department={source ? departments.get(source.dept_code) : undefined}
            onOpen={onSelectProject}
          />
          <div className="flex items-center gap-2 my-2 pl-1">
            <span className="data text-[15px] leading-none" aria-hidden>
              {connection.direction === "BIDIRECTIONAL" ? "↕" : "↓"}
            </span>
            <span className="anno">{connection.connection_label}</span>
          </div>
          <Endpoint
            role="Target"
            project={target}
            department={target ? departments.get(target.dept_code) : undefined}
            onOpen={onSelectProject}
          />
          <p className="note mt-2">
            {connection.direction === "BIDIRECTIONAL"
              ? "Information moves in both directions."
              : `${connection.source_project_id} sends to ${connection.target_project_id}.`}
          </p>
        </section>

        {/* ---- editable content ---- */}
        <section className="px-3.5 py-3 border-b border-rule space-y-3">
          <h3 className="anno">Content</h3>

          {canEdit ? (
            <>
              <div>
                <label htmlFor="c-label" className="anno block mb-1">
                  Edge label · what is transferred
                </label>
                <input
                  id="c-label"
                  className="field"
                  maxLength={60}
                  value={draft.connection_label}
                  onChange={(e) => setDraft({ ...draft, connection_label: e.target.value })}
                />
                <p className="note mt-1">Keep it to about one to five words.</p>
              </div>

              <div>
                <label htmlFor="c-type" className="anno block mb-1">
                  Connection type
                </label>
                <select
                  id="c-type"
                  className="field"
                  value={draft.connection_type}
                  onChange={(e) => setDraft({ ...draft, connection_type: e.target.value })}
                >
                  {connectionTypes.map((t) => (
                    <option key={t.type_id} value={t.type_id}>
                      {t.type_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="c-direction" className="anno block mb-1">
                  Direction
                </label>
                <select
                  id="c-direction"
                  className="field"
                  value={draft.direction}
                  onChange={(e) => setDraft({ ...draft, direction: e.target.value })}
                >
                  <option value="ONE_WAY">
                    One way · {connection.source_project_id} → {connection.target_project_id}
                  </option>
                  <option value="BIDIRECTIONAL">Both ways</option>
                </select>
              </div>

              <div>
                <label htmlFor="c-desc" className="anno block mb-1">
                  Detailed description
                </label>
                <textarea
                  id="c-desc"
                  rows={3}
                  className="field"
                  value={draft.detailed_description}
                  onChange={(e) => setDraft({ ...draft, detailed_description: e.target.value })}
                />
              </div>
            </>
          ) : (
            <>
              <Row label="Type" value={type?.type_name ?? connection.connection_type} />
              <Row label="Direction" value={connection.direction === "BIDIRECTIONAL" ? "Both ways" : "One way"} />
              <Row label="Data or process" value={connection.data_or_process_name ?? "—"} />
              {connection.detailed_description && (
                <p className="text-[12px] leading-relaxed whitespace-pre-wrap mt-1">
                  {connection.detailed_description}
                </p>
              )}
            </>
          )}
        </section>

        {/* ---- provenance ---- */}
        <section className="px-3.5 py-3 border-b border-rule">
          <h3 className="anno mb-2">Review</h3>
          <Row
            label="Origin"
            value={
              connection.proposed_by === "AI_ANALYSIS"
                ? "Proposed by AI analysis"
                : connection.proposed_by
                  ? `Created by ${connection.proposed_by}`
                  : "Unknown"
            }
          />
          <Row label="Status" value={STATUS_LABEL[connection.connection_status]} />
          <Row label="Reviewed by" value={connection.reviewed_by ?? "Not yet reviewed"} />
          <Row
            label="Review date"
            value={connection.review_date ? new Date(connection.review_date).toLocaleString() : "—"}
          />
          <Row
            label="Last updated"
            value={`${new Date(connection.updated_at).toLocaleString()}${
              connection.updated_by ? ` · ${connection.updated_by}` : ""
            }`}
          />

          {connection.reason && (
            <div className="mt-2.5 border-l-2 border-rule-strong pl-2.5">
              <div className="anno mb-1">Why this was suggested</div>
              <p className="text-[12px] leading-relaxed">{connection.reason}</p>
            </div>
          )}

          {connection.connection_status === "AI_SUGGESTED" && (
            <p className="note mt-2.5">
              This is a suggestion. It is not part of Air4 architecture until an admin approves it.
            </p>
          )}
        </section>
      </div>

      {/* ---- actions ---- */}
      <div className="border-t-2 border-ink p-3 shrink-0 bg-sheet-raised space-y-2">
        {error && (
          <p role="alert" className="text-[12px] text-stamp border-l-2 border-stamp pl-2">
            {error}
          </p>
        )}
        {warnings.map((warning) => (
          <p key={warning} className="note border-l-2 border-rule-strong pl-2">
            {warning}
          </p>
        ))}

        {canEdit && dirty && (
          <div className="flex gap-2">
            <button
              className="btn btn-solid flex-1"
              disabled={busy}
              onClick={() => send(draft)}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
            <button
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => setDraft(toDraft(connection))}
            >
              Discard
            </button>
          </div>
        )}

        {canReview && editing && !dirty && (
          <div className="flex gap-2">
            {connection.connection_status !== "APPROVED" &&
              connection.connection_status !== "EDITED" && (
                <button
                  className="btn btn-solid flex-1"
                  disabled={busy}
                  onClick={() => send({ action: "approve" })}
                >
                  Approve
                </button>
              )}
            {connection.connection_status !== "REJECTED" && (
              <button
                className="btn btn-stamp flex-1"
                disabled={busy}
                onClick={() => send({ action: "reject" })}
              >
                Reject
              </button>
            )}
          </div>
        )}

        {canEdit && !dirty && (
          <button
            className="btn btn-quiet w-full"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  `Remove ${connection.connection_id} from the diagram? The record is kept for the audit trail.`
                )
              ) {
                send({}, "DELETE").then((ok) => ok && onClose());
              }
            }}
          >
            Delete connection
          </button>
        )}

        {!editing && (
          <p className="note">Switch to Edit mode to review or change this connection.</p>
        )}
      </div>
    </div>
  );
}

function toDraft(connection: Connection) {
  return {
    connection_label: connection.connection_label,
    connection_type: connection.connection_type,
    direction: connection.direction as string,
    detailed_description: connection.detailed_description ?? "",
  };
}

function Endpoint({
  role,
  project,
  department,
  onOpen,
}: {
  role: string;
  project: Project | undefined;
  department: Department | undefined;
  onOpen: (id: string) => void;
}) {
  if (!project) {
    return <p className="note">{role}: project not found.</p>;
  }
  return (
    <button
      onClick={() => onOpen(project.project_id)}
      className="w-full text-left border border-rule hover:border-ink transition-colors flex"
    >
      <span style={{ width: 5, background: department?.color ?? "var(--color-ink)" }} aria-hidden />
      <span className="px-2.5 py-2 min-w-0">
        <span className="anno block">{role}</span>
        <span className="flex items-center gap-2 mt-0.5">
          <span className="partno">{project.project_id}</span>
          <span className="text-[12px] font-semibold truncate">{project.project_name}</span>
        </span>
        <span className="anno block mt-0.5 truncate">
          {department ? department.dept_name_en : project.dept_code}
        </span>
      </span>
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 py-[3px]">
      <span className="anno w-[96px] shrink-0">{label}</span>
      <span className="text-[12px] min-w-0 break-words">{value}</span>
    </div>
  );
}
