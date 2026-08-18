"use client";

import { useEffect, useMemo, useState } from "react";
import { completenessChecks } from "@/lib/completeness";
import { shortDate } from "./flow/ProjectNode";
import type {
  Connection,
  ConnectionType,
  Department,
  Project,
  StatusConfig,
} from "@/lib/types";

/**
 * Project detail panel.
 *
 * Read-only unless the sheet is in Edit mode AND this user may edit this
 * project. Incoming and outgoing information are listed separately (§20) —
 * that split is what makes the Phase 2 integration conversation possible.
 */

interface Props {
  project: Project;
  department: Department | undefined;
  statuses: StatusConfig[];
  connectionTypes: ConnectionType[];
  connections: Connection[];
  projects: Map<string, Project>;
  editable: boolean;
  editing: boolean;
  onClose: () => void;
  onSaved: () => void;
  onSelectConnection: (connectionId: string) => void;
  onSelectProject: (projectId: string) => void;
}

const REVIEW_LABEL: Record<string, string> = {
  NOT_REVIEWED: "Not reviewed",
  AI_REVIEWED: "AI reviewed",
  HUMAN_REVIEWED: "Human reviewed",
  CONFIRMED: "Confirmed",
};

export default function ProjectInspector({
  project,
  department,
  statuses,
  connections,
  projects,
  editable,
  editing,
  onClose,
  onSaved,
  onSelectConnection,
  onSelectProject,
}: Props) {
  const canEdit = editable && editing;

  const [draft, setDraft] = useState(() => toDraft(project));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    setDraft(toDraft(project));
    setError(null);
    setWarnings([]);
  }, [project]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(toDraft(project)),
    [draft, project]
  );

  const incoming = connections.filter(
    (c) =>
      c.target_project_id === project.project_id ||
      (c.direction === "BIDIRECTIONAL" && c.source_project_id === project.project_id)
  );
  const outgoing = connections.filter(
    (c) =>
      c.source_project_id === project.project_id ||
      (c.direction === "BIDIRECTIONAL" && c.target_project_id === project.project_id)
  );

  const checks = completenessChecks(project, incoming.length + outgoing.length);
  const completeness = Math.round(
    (checks.filter((c) => c.ok).length / checks.length) * 100
  );

  async function save() {
    setSaving(true);
    setError(null);
    setWarnings([]);
    try {
      const response = await fetch(`/api/projects/${project.project_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status_id: draft.status_id,
          progress_percent: Number(draft.progress_percent),
          next_step: draft.next_step,
          objective: draft.objective,
          notes: draft.notes,
          use_checkpoints: draft.use_checkpoints,
          checkpoint_due_date: draft.use_checkpoints ? draft.checkpoint_due_date || null : null,
          final_due_date: draft.final_due_date || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setWarnings(data.warnings ?? []);
      onSaved();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* header */}
      <div className="border-b-2 border-ink shrink-0">
        <div style={{ height: 5, background: department?.color ?? "var(--color-ink)" }} />
        <div className="px-3.5 py-2.5 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="partno">{project.project_id}</span>
              {project.project_type === "FUTURE_ADDON" && (
                <span className="anno border border-dashed border-ink-soft px-1.5 py-px">
                  Future add-on
                </span>
              )}
            </div>
            <h2 className="text-[15px] font-semibold leading-tight mt-1">
              {project.project_name}
            </h2>
            <p className="anno mt-1 truncate">
              {department ? `${department.dept_code} · ${department.dept_name_en}` : project.dept_code}
            </p>
          </div>
          <button onClick={onClose} className="btn btn-quiet shrink-0" aria-label="Close panel">
            Close
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        {/* ---- status & progress ---- */}
        <Block title="Status and progress">
          {canEdit ? (
            <div className="space-y-3">
              <div>
                <label htmlFor="p-status" className="anno block mb-1">
                  Status
                </label>
                <select
                  id="p-status"
                  className="field"
                  value={draft.status_id}
                  onChange={(e) => setDraft({ ...draft, status_id: e.target.value })}
                >
                  {statuses.map((s) => (
                    <option key={s.status_id} value={s.status_id}>
                      {s.status_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="p-progress" className="anno block mb-1">
                  Progress · {draft.progress_percent}%
                </label>
                <input
                  id="p-progress"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  className="w-full accent-[#16202a]"
                  value={draft.progress_percent}
                  onChange={(e) =>
                    setDraft({ ...draft, progress_percent: Number(e.target.value) })
                  }
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <StatusBadge project={project} statuses={statuses} />
              <div className="scale flex-1">
                <div className="scale-fill" style={{ width: `${project.progress_percent}%` }} />
              </div>
              <span className="data font-bold">{project.progress_percent}%</span>
            </div>
          )}

          {project.status_original && (
            <p className="note mt-2.5">
              Original sheet status: <span className="font-semibold">{project.status_original}</span>
            </p>
          )}
        </Block>

        {/* ---- ownership ---- */}
        <Block title="Ownership">
          <Row label="Project owner" value={project.owner_name ?? "Not set"} />
          <Row label="Data owner" value={project.data_owner ?? "Not set"} muted={!project.data_owner} />
          <Row
            label="System owner"
            value={project.system_owner ?? "Not set"}
            muted={!project.system_owner}
          />
          <p className="note mt-2">
            Delivery, data meaning and system upkeep can be the same person, but they stay separate
            responsibilities.
          </p>
        </Block>

        {/* ---- schedule ---- */}
        <Block title="Schedule">
          {canEdit ? (
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-[#16202a]"
                  checked={draft.use_checkpoints}
                  onChange={(e) => setDraft({ ...draft, use_checkpoints: e.target.checked })}
                />
                <span className="anno">This project uses a checkpoint</span>
              </label>
              {draft.use_checkpoints && (
                <div>
                  <label htmlFor="p-checkpoint" className="anno block mb-1">
                    Checkpoint date
                  </label>
                  <input
                    id="p-checkpoint"
                    type="date"
                    className="field"
                    value={draft.checkpoint_due_date}
                    onChange={(e) => setDraft({ ...draft, checkpoint_due_date: e.target.value })}
                  />
                </div>
              )}
              <div>
                <label htmlFor="p-due" className="anno block mb-1">
                  Final due date
                </label>
                <input
                  id="p-due"
                  type="date"
                  className="field"
                  value={draft.final_due_date}
                  onChange={(e) => setDraft({ ...draft, final_due_date: e.target.value })}
                />
                <p className="note mt-1">Leave blank if no date is confirmed yet.</p>
              </div>
            </div>
          ) : (
            <>
              <Row
                label="Checkpoint"
                value={
                  project.use_checkpoints
                    ? shortDate(project.checkpoint_due_date) ?? "Not set"
                    : "Not used"
                }
                muted={!project.use_checkpoints || !project.checkpoint_due_date}
              />
              <Row
                label="Final due"
                value={shortDate(project.final_due_date) ?? "Not confirmed"}
                muted={!project.final_due_date}
              />
            </>
          )}
        </Block>

        {/* ---- detail ---- */}
        <Block title="Detail">
          {canEdit ? (
            <div className="space-y-3">
              <TextArea
                id="p-objective"
                label="Objective"
                rows={2}
                value={draft.objective}
                onChange={(v) => setDraft({ ...draft, objective: v })}
              />
              <TextArea
                id="p-next"
                label="Next step"
                rows={2}
                value={draft.next_step}
                onChange={(v) => setDraft({ ...draft, next_step: v })}
              />
              <TextArea
                id="p-notes"
                label="Notes"
                rows={2}
                value={draft.notes}
                onChange={(v) => setDraft({ ...draft, notes: v })}
              />
            </div>
          ) : (
            <div className="space-y-2.5">
              <Field label="Objective" value={project.objective} />
              <Field label="Brief from the 1-on-1" value={project.brief} />
              <Field label="Next step" value={project.next_step} />
              <Field label="Notes" value={project.notes} />
            </div>
          )}
        </Block>

        {/* ---- incoming / outgoing (§20) ---- */}
        <Block title={`Incoming · ${incoming.length}`}>
          <p className="note mb-2">Information this project receives.</p>
          <ConnectionList
            connections={incoming}
            project={project}
            projects={projects}
            direction="in"
            onSelect={onSelectConnection}
            onSelectProject={onSelectProject}
          />
        </Block>

        <Block title={`Outgoing · ${outgoing.length}`}>
          <p className="note mb-2">Information this project produces or sends.</p>
          <ConnectionList
            connections={outgoing}
            project={project}
            projects={projects}
            direction="out"
            onSelect={onSelectConnection}
            onSelectProject={onSelectProject}
          />
        </Block>

        {/* ---- data completeness (§36) ---- */}
        <Block title={`Data completeness · ${completeness}%`}>
          <p className="note mb-2">
            How much we know about this project. Not the same as progress, which is how far the work
            has got.
          </p>
          <div className="scale mb-2.5">
            <div className="scale-fill" style={{ width: `${completeness}%` }} />
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {checks.map((check) => (
              <li key={check.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="w-3 text-center data font-bold"
                  style={{ color: check.ok ? "var(--color-ink)" : "var(--color-stamp)" }}
                >
                  {check.ok ? "✓" : "—"}
                </span>
                <span className="text-[11px]">{check.label}</span>
              </li>
            ))}
          </ul>
          <Row
            label="Connection review"
            value={REVIEW_LABEL[project.connection_review_status] ?? project.connection_review_status}
          />
        </Block>

        <Block title="Record">
          <Row label="Phase" value={project.phase.replace("_", " ")} />
          <Row label="Priority" value={project.priority ? String(project.priority) : "Not set"} />
          <Row label="Source row" value={project.source_seq ? `#${project.source_seq}` : "—"} />
          <Row
            label="Last updated"
            value={`${new Date(project.updated_at).toLocaleString()}${
              project.updated_by ? ` · ${project.updated_by}` : ""
            }`}
          />
        </Block>
      </div>

      {/* ---- save bar ---- */}
      {canEdit && (
        <div className="border-t-2 border-ink p-3 shrink-0 bg-sheet-raised">
          {error && (
            <p role="alert" className="text-[12px] text-stamp border-l-2 border-stamp pl-2 mb-2">
              {error}
            </p>
          )}
          {warnings.map((warning) => (
            <p key={warning} className="note border-l-2 border-rule-strong pl-2 mb-2">
              {warning}
            </p>
          ))}
          <div className="flex gap-2">
            <button className="btn btn-solid flex-1" disabled={!dirty || saving} onClick={save}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              className="btn btn-quiet"
              disabled={!dirty || saving}
              onClick={() => setDraft(toDraft(project))}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {editable && !editing && (
        <div className="border-t border-rule p-2.5 shrink-0">
          <p className="note">Switch to Edit mode to change this project.</p>
        </div>
      )}
    </div>
  );
}

function toDraft(project: Project) {
  return {
    status_id: project.status_id,
    progress_percent: project.progress_percent,
    next_step: project.next_step ?? "",
    objective: project.objective ?? "",
    notes: project.notes ?? "",
    use_checkpoints: !!project.use_checkpoints,
    checkpoint_due_date: project.checkpoint_due_date ?? "",
    final_due_date: project.final_due_date ?? "",
  };
}

function StatusBadge({ project, statuses }: { project: Project; statuses: StatusConfig[] }) {
  const status = statuses.find((s) => s.status_id === project.status_id);
  if (!status) return null;
  return (
    <span className="badge" style={{ background: status.color }}>
      {status.status_name}
    </span>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-rule px-3.5 py-3">
      <h3 className="anno mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 py-[3px]">
      <span className="anno w-[104px] shrink-0">{label}</span>
      <span
        className="text-[12px] min-w-0 break-words"
        style={muted ? { color: "var(--color-ink-faint)" } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="anno mb-0.5">{label}</div>
      {value ? (
        <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{value}</p>
      ) : (
        <p className="text-[12px]" style={{ color: "var(--color-ink-faint)" }}>
          Not recorded
        </p>
      )}
    </div>
  );
}

function TextArea({
  id,
  label,
  rows,
  value,
  onChange,
}: {
  id: string;
  label: string;
  rows: number;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="anno block mb-1">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        className="field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function ConnectionList({
  connections,
  project,
  projects,
  direction,
  onSelect,
  onSelectProject,
}: {
  connections: Connection[];
  project: Project;
  projects: Map<string, Project>;
  direction: "in" | "out";
  onSelect: (id: string) => void;
  onSelectProject: (id: string) => void;
}) {
  if (connections.length === 0) {
    return (
      <p className="text-[12px]" style={{ color: "var(--color-ink-faint)" }}>
        {project.connection_review_status === "NOT_REVIEWED"
          ? "Not yet reviewed — this is not the same as having no connections."
          : "None found."}
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {connections.map((connection) => {
        const otherId =
          connection.source_project_id === project.project_id
            ? connection.target_project_id
            : connection.source_project_id;
        const other = projects.get(otherId);
        return (
          <li key={connection.connection_id}>
            <div className="border border-rule hover:border-ink transition-colors">
              <button
                onClick={() => onSelect(connection.connection_id)}
                className="w-full text-left px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span aria-hidden className="data">
                    {connection.direction === "BIDIRECTIONAL" ? "↔" : direction === "in" ? "←" : "→"}
                  </span>
                  <span className="anno truncate">{connection.connection_label}</span>
                  {connection.connection_status === "AI_SUGGESTED" && (
                    <span className="anno ml-auto shrink-0" style={{ color: "var(--color-stamp)" }}>
                      AI
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="partno">{otherId}</span>
                  <span className="text-[11px] truncate" style={{ color: "var(--color-ink-soft)" }}>
                    {other?.project_name ?? "Unknown project"}
                  </span>
                </div>
              </button>
              <button
                onClick={() => onSelectProject(otherId)}
                className="anno w-full text-left px-2 py-1 border-t border-rule hover:bg-[rgba(147,163,174,0.14)]"
              >
                Open {otherId}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
