"use client";

import { useMemo, useState } from "react";
import Dialog from "./Dialog";
import type { Department, Project, StatusConfig } from "@/lib/types";

/**
 * Add a project (§5, §6).
 *
 * A future add-on takes the next number in its department's sequence, exactly
 * like an approved project — the ID stays simple and permanent, and the
 * "future" meaning is carried by project type and the dashed border, not by
 * the identifier.
 */
export default function NewProjectDialog({
  departments,
  statuses,
  projects,
  onClose,
  onCreated,
}: {
  departments: Department[];
  statuses: StatusConfig[];
  projects: Project[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [deptCode, setDeptCode] = useState(departments[0]?.dept_code ?? "");
  const [name, setName] = useState("");
  const [projectType, setProjectType] = useState<"FUTURE_ADDON" | "APPROVED">("FUTURE_ADDON");
  const [statusId, setStatusId] = useState("NOT_STARTED");
  const [ownerName, setOwnerName] = useState("");
  const [objective, setObjective] = useState("");
  const [finalDue, setFinalDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview of the ID this project will be issued.
  const nextId = useMemo(() => {
    const numbers = projects
      .filter((p) => p.dept_code === deptCode)
      .map((p) => Number(p.project_id.split("-")[1]))
      .filter((n) => Number.isFinite(n));
    const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
    return `${deptCode}-${String(next).padStart(3, "0")}`;
  }, [deptCode, projects]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dept_code: deptCode,
          project_name: name.trim(),
          project_type: projectType,
          status_id: statusId,
          owner_name: ownerName.trim() || null,
          objective: objective.trim() || null,
          final_due_date: finalDue || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not create the project.");
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
    <Dialog title="Add project" onClose={onClose} width={500}>
      <div className="space-y-3.5">
        <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label htmlFor="np-dept" className="anno block mb-1">
              Department
            </label>
            <select
              id="np-dept"
              className="field"
              value={deptCode}
              onChange={(e) => setDeptCode(e.target.value)}
            >
              {departments.map((dept) => (
                <option key={dept.dept_code} value={dept.dept_code}>
                  {dept.dept_code} · {dept.dept_name_en}
                </option>
              ))}
            </select>
          </div>
          <div className="border border-rule px-3 py-[7px]">
            <div className="anno">Will be issued</div>
            <div className="partno mt-0.5">{nextId}</div>
          </div>
        </div>

        <div>
          <label htmlFor="np-name" className="anno block mb-1">
            Project name
          </label>
          <input
            id="np-name"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <fieldset>
          <legend className="anno mb-1.5">Project type</legend>
          <div className="grid grid-cols-2 gap-2">
            <TypeChoice
              checked={projectType === "FUTURE_ADDON"}
              onSelect={() => setProjectType("FUTURE_ADDON")}
              title="Future add-on"
              hint="Dashed border. Not yet approved."
              dashed
            />
            <TypeChoice
              checked={projectType === "APPROVED"}
              onSelect={() => setProjectType("APPROVED")}
              title="Approved"
              hint="Solid border. Official Air4 project."
            />
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="np-status" className="anno block mb-1">
              Status
            </label>
            <select
              id="np-status"
              className="field"
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
            >
              {statuses.map((status) => (
                <option key={status.status_id} value={status.status_id}>
                  {status.status_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="np-owner" className="anno block mb-1">
              Owner
            </label>
            <input
              id="np-owner"
              className="field"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="np-objective" className="anno block mb-1">
            Objective
          </label>
          <textarea
            id="np-objective"
            rows={2}
            className="field"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="np-due" className="anno block mb-1">
            Final due date
          </label>
          <input
            id="np-due"
            type="date"
            className="field"
            value={finalDue}
            onChange={(e) => setFinalDue(e.target.value)}
          />
          <p className="note mt-1">Optional. Leave blank if no date is confirmed.</p>
        </div>

        {error && (
          <p role="alert" className="text-[12px] text-stamp border-l-2 border-stamp pl-2.5">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button className="btn btn-solid flex-1" disabled={!name.trim() || busy} onClick={create}>
            {busy ? "Creating…" : `Create ${nextId}`}
          </button>
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function TypeChoice({
  checked,
  onSelect,
  title,
  hint,
  dashed,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
  dashed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={checked}
      className="text-left p-2.5"
      style={{
        border: `1.5px ${dashed ? "dashed" : "solid"} var(--color-ink)`,
        background: checked ? "var(--color-ink)" : "transparent",
        color: checked ? "#fff" : "var(--color-ink)",
      }}
    >
      <span className="anno-lg text-[11px] block">{title}</span>
      <span className="text-[11px] block mt-0.5 opacity-80">{hint}</span>
    </button>
  );
}
