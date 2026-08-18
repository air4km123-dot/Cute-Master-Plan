"use client";

import { useState } from "react";
import Dialog from "./Dialog";
import type { ConnectionType, Project, SessionUser } from "@/lib/types";

/**
 * Draw a connection by hand (§13, §14, §15).
 *
 * Source and target are chosen by Project_ID, never by name, so renaming a
 * project can never break a relationship.
 */
export default function NewConnectionDialog({
  projects,
  connectionTypes,
  editableProjectIds,
  session,
  initialSource,
  onClose,
  onCreated,
}: {
  projects: Project[];
  connectionTypes: ConnectionType[];
  editableProjectIds: Set<string>;
  session: SessionUser;
  initialSource?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [source, setSource] = useState(initialSource ?? "");
  const [target, setTarget] = useState("");
  const [type, setType] = useState(connectionTypes[0]?.type_id ?? "DATA_FLOW");
  const [label, setLabel] = useState("");
  const [direction, setDirection] = useState("ONE_WAY");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const sorted = [...projects].sort((a, b) => a.project_id.localeCompare(b.project_id));
  const isAdmin = session.role === "ADMIN";

  const problem =
    !source || !target
      ? "Choose a source and a target project."
      : source === target
        ? "A project cannot connect to itself."
        : !label.trim()
          ? "Add a label describing what is transferred."
          : !isAdmin && !editableProjectIds.has(source) && !editableProjectIds.has(target)
            ? "One end must be a project you own."
            : null;

  async function create() {
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const response = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_project_id: source,
          target_project_id: target,
          connection_type: type,
          connection_label: label.trim(),
          direction,
          detailed_description: description.trim() || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not create the connection.");
        return;
      }
      if (data.warnings?.length) {
        setWarnings(data.warnings);
        onCreated();
        return;
      }
      onCreated();
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="New connection" onClose={onClose} width={520}>
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <ProjectSelect
            id="nc-source"
            label="Source — sends"
            value={source}
            onChange={setSource}
            projects={sorted}
          />
          <ProjectSelect
            id="nc-target"
            label="Target — receives"
            value={target}
            onChange={setTarget}
            projects={sorted}
          />
        </div>

        <div>
          <label htmlFor="nc-label" className="anno block mb-1">
            Edge label — what is transferred
          </label>
          <input
            id="nc-label"
            className="field"
            maxLength={60}
            placeholder="Production volume"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <p className="note mt-1">One to five words. Detail goes in the description below.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="nc-type" className="anno block mb-1">
              Connection type
            </label>
            <select
              id="nc-type"
              className="field"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {connectionTypes.map((t) => (
                <option key={t.type_id} value={t.type_id}>
                  {t.type_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="nc-direction" className="anno block mb-1">
              Direction
            </label>
            <select
              id="nc-direction"
              className="field"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="ONE_WAY">One way</option>
              <option value="BIDIRECTIONAL">Both ways</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="nc-desc" className="anno block mb-1">
            Detailed description
          </label>
          <textarea
            id="nc-desc"
            rows={3}
            className="field"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <p className="note border-l-2 border-rule-strong pl-2.5">
          {isAdmin
            ? "As an admin, this is recorded as approved architecture straight away."
            : "This is recorded as a proposal and waits for an admin to review it."}
        </p>

        {error && (
          <p role="alert" className="text-[12px] text-stamp border-l-2 border-stamp pl-2.5">
            {error}
          </p>
        )}
        {warnings.map((warning) => (
          <p key={warning} className="note border-l-2 border-stamp pl-2.5">
            Saved with a warning: {warning}
          </p>
        ))}

        <div className="flex gap-2 pt-1">
          <button className="btn btn-solid flex-1" disabled={!!problem || busy} onClick={create}>
            {busy ? "Creating…" : "Create connection"}
          </button>
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
        {problem && <p className="note">{problem}</p>}
      </div>
    </Dialog>
  );
}

function ProjectSelect({
  id,
  label,
  value,
  onChange,
  projects,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  projects: Project[];
}) {
  return (
    <div>
      <label htmlFor={id} className="anno block mb-1">
        {label}
      </label>
      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a project…</option>
        {projects.map((project) => (
          <option key={project.project_id} value={project.project_id}>
            {project.project_id} · {project.project_name}
          </option>
        ))}
      </select>
    </div>
  );
}
