"use client";

import { useState } from "react";
import type { Department, StatusConfig } from "@/lib/types";

/**
 * The title block (§27).
 *
 * Every engineering drawing carries a title block in the bottom right holding
 * the sheet's identity and its key. This one does both jobs: sheet metadata,
 * and the legend the spec requires always be easy to reach. It collapses to a
 * tab but never leaves the sheet.
 *
 * The legend draws real marks rather than describing them — a solid card edge,
 * a dashed one, an actual arrow with a label on it — so the key and the diagram
 * cannot drift apart.
 */

export default function TitleBlock({
  departments,
  statuses,
  drawnBy,
  projectCount,
  approvedConnections,
  pendingSuggestions,
}: {
  departments: Department[];
  statuses: StatusConfig[];
  drawnBy: string;
  projectCount: number;
  approvedConnections: number;
  pendingSuggestions: number;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="titleblock absolute bottom-4 right-4 px-3 py-2 anno hover:bg-[rgba(147,163,174,0.14)]"
        aria-expanded={false}
      >
        Legend + sheet info
      </button>
    );
  }

  return (
    <div
      className="titleblock absolute bottom-4 right-4 w-[452px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-9rem)] overflow-y-auto thin-scroll"
      role="region"
      aria-label="Legend and sheet information"
    >
      {/* ---- sheet identity ---- */}
      <div className="tb-row" style={{ gridTemplateColumns: "1fr auto" }}>
        <div className="tb-cell">
          <div className="anno">Air4 Integrated Business System</div>
          <div className="anno-lg mt-0.5">Master Plan — Phase 1</div>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="tb-cell anno hover:bg-[rgba(147,163,174,0.14)]"
          aria-label="Collapse legend"
        >
          Close
        </button>
      </div>

      <div className="tb-row" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <Cell label="Sheet" value="01 of 01" />
        <Cell label="Rev" value="V2" />
        <Cell label="Projects" value={String(projectCount)} />
        <Cell label="Drawn by" value={drawnBy} />
      </div>

      <div className="tb-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Cell label="Connections approved" value={String(approvedConnections)} />
        <Cell label="AI suggestions pending review" value={String(pendingSuggestions)} />
      </div>

      {/* ---- the key ---- */}
      <Key title="Project card">
        <div className="flex items-start gap-4">
          <Sample caption="Approved">
            <div className="w-[74px] h-[38px] bg-white" style={{ border: "1.5px solid var(--color-ink)" }}>
              <div style={{ height: 4, background: departments[0]?.color ?? "#2563eb" }} />
            </div>
          </Sample>
          <Sample caption="Future add-on">
            <div
              className="w-[74px] h-[38px] bg-white"
              style={{ border: "1.5px dashed var(--color-ink-soft)" }}
            >
              <div style={{ height: 4, background: departments[0]?.color ?? "#2563eb" }} />
            </div>
          </Sample>
          <Sample caption="Blocked">
            <div
              className="w-[74px] h-[38px] bg-white card--blocked"
              style={{ border: "1.5px solid var(--color-ink)" }}
            >
              <div style={{ height: 4, background: departments[0]?.color ?? "#2563eb" }} />
            </div>
          </Sample>
        </div>
        <p className="note mt-2">
          Border style shows project type. It never shows status — those are separate meanings.
        </p>
      </Key>

      <Key title="Accent colour = department">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {departments.map((dept) => (
            <span key={dept.dept_code} className="flex items-center gap-1.5">
              <span
                className="w-3 h-2 border border-[rgba(0,0,0,0.2)]"
                style={{ background: dept.color }}
                aria-hidden
              />
              <span className="partno">{dept.dept_code}</span>
            </span>
          ))}
        </div>
      </Key>

      <Key title="Badge colour = status">
        <div className="flex flex-wrap gap-1.5">
          {statuses.map((status) => (
            <span key={status.status_id} className="badge" style={{ background: status.color }}>
              {status.status_name}
            </span>
          ))}
        </div>
      </Key>

      <Key title="Scale = progress">
        <div className="flex items-center gap-2">
          <div className="scale w-[120px]">
            <div className="scale-fill" style={{ width: "65%" }} />
            <span className="scale-tick" style={{ left: "25%" }} />
            <span className="scale-tick" style={{ left: "50%" }} />
            <span className="scale-tick" style={{ left: "75%" }} />
          </div>
          <span className="data font-bold">65%</span>
          <span className="note">0–100% of project work done</span>
        </div>
      </Key>

      <Key title="Arrow = direction · label = what is transferred">
        <svg width="100%" height="46" viewBox="0 0 400 46" aria-hidden>
          <defs>
            <marker
              id="tb-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-ink)" />
            </marker>
          </defs>
          <rect x="1" y="12" width="76" height="22" fill="#fff" stroke="var(--color-ink)" strokeWidth="1.5" />
          <text x="39" y="27" textAnchor="middle" className="partno" fill="var(--color-ink)" fontSize="10">
            PM-002
          </text>
          <line
            x1="79"
            y1="23"
            x2="317"
            y2="23"
            stroke="var(--color-ink)"
            strokeWidth="1.5"
            markerEnd="url(#tb-arrow)"
          />
          <rect x="140" y="14" width="116" height="18" fill="#fff" stroke="var(--color-rule)" />
          <text
            x="198"
            y="26"
            textAnchor="middle"
            fill="var(--color-ink)"
            fontSize="9"
            fontFamily="var(--font-draft)"
            letterSpacing="1"
          >
            PRODUCTION VOLUME
          </text>
          <rect x="322" y="12" width="76" height="22" fill="#fff" stroke="var(--color-ink)" strokeWidth="1.5" />
          <text x="360" y="27" textAnchor="middle" className="partno" fill="var(--color-ink)" fontSize="10">
            AF-007
          </text>
        </svg>
        <p className="note">
          An arrowhead at both ends means information moves both ways.
        </p>
      </Key>

      <Key title="Line style = review status">
        <div className="space-y-1.5">
          <LineSample dash={undefined} width={1.5} label="Approved — confirmed architecture" />
          <LineSample dash="6 4" width={1.25} label="AI suggested — waiting for a human decision" />
          <LineSample dash="2 4" width={1.25} label="Not reviewed" />
        </div>
        <p className="note mt-2">
          Rejected connections are kept in the record but leave the sheet.
        </p>
      </Key>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="tb-cell">
      <div className="anno">{label}</div>
      <div className="data font-bold mt-0.5 truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

function Key({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tb-row" style={{ gridTemplateColumns: "1fr" }}>
      <div className="tb-cell">
        <div className="anno mb-1.5">{title}</div>
        {children}
      </div>
    </div>
  );
}

function Sample({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div>
      {children}
      <div className="anno mt-1">{caption}</div>
    </div>
  );
}

function LineSample({
  dash,
  width,
  label,
}: {
  dash: string | undefined;
  width: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="62" height="10" aria-hidden>
        <line
          x1="0"
          y1="5"
          x2="62"
          y2="5"
          stroke={dash ? "var(--color-ink-soft)" : "var(--color-ink)"}
          strokeWidth={width}
          strokeDasharray={dash}
        />
      </svg>
      <span className="note">{label}</span>
    </div>
  );
}
