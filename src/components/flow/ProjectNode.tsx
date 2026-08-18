"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CARD_H, CARD_W } from "@/lib/layout";
import type { Project, StatusConfig } from "@/lib/types";

/**
 * A project card on the sheet.
 *
 * Visual grammar (§32, §33) — each property means exactly one thing:
 *
 *   accent bar     department        (the only department signal, plus the ID prefix)
 *   badge colour   status
 *   scale + %      progress
 *   border style   project type: solid = approved, dashed = future add-on
 *   hatched fill   blocked
 */

export interface ProjectNodeData extends Record<string, unknown> {
  project: Project;
  status: StatusConfig | undefined;
  deptColor: string;
  selected: boolean;
  faded: boolean;
  editable: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(value: string | null): string | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return `${d} ${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

export default function ProjectNode({ data }: NodeProps) {
  const { project, status, deptColor, selected, faded } = data as unknown as ProjectNodeData;

  const isFuture = project.project_type === "FUTURE_ADDON";
  const isBlocked = project.status_id === "BLOCKED";
  const checkpoint = project.use_checkpoints ? shortDate(project.checkpoint_due_date) : null;
  const finalDue = shortDate(project.final_due_date);

  return (
    <div
      style={{ width: CARD_W, height: CARD_H }}
      className={[
        "card ticked flex flex-col",
        isFuture && "card--future",
        isBlocked && "card--blocked",
        selected && "card--selected",
        faded && "card--faded",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />

      {/* Department accent */}
      <div className="card-accent" style={{ background: deptColor }} />

      <div className="px-2.5 pt-2 pb-2 flex flex-col flex-1 min-h-0">
        <div className="flex items-start justify-between gap-2">
          <span className="partno">{project.project_id}</span>
          {status && (
            <span className="badge" style={{ background: status.color }}>
              {status.status_name}
            </span>
          )}
        </div>

        <h3
          className="mt-1.5 text-[13px] font-semibold leading-[1.25] line-clamp-2"
          title={project.project_name}
        >
          {project.project_name}
        </h3>

        <div className="anno mt-1 truncate">
          {project.owner_name ? `Owner · ${project.owner_name}` : "No owner"}
        </div>

        <div className="flex-1" />

        {/* Progress — bar and number, always both (§7) */}
        <div className="flex items-center gap-2">
          <div className="scale flex-1" role="img" aria-label={`Progress ${project.progress_percent}%`}>
            <div className="scale-fill" style={{ width: `${project.progress_percent}%` }} />
            <span className="scale-tick" style={{ left: "25%" }} />
            <span className="scale-tick" style={{ left: "50%" }} />
            <span className="scale-tick" style={{ left: "75%" }} />
          </div>
          <span className="data font-bold w-8 text-right">{project.progress_percent}%</span>
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-2">
          {checkpoint || finalDue ? (
            <>
              <span className="anno truncate">
                {checkpoint ? `CP ${checkpoint}` : " "}
              </span>
              <span className="anno truncate">{finalDue ? `Due ${finalDue}` : "No final due"}</span>
            </>
          ) : (
            <span className="anno" style={{ color: "var(--color-ink-faint)" }}>
              No due date set
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
