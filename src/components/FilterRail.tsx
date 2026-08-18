"use client";

import { useState } from "react";
import type { ConnectionType, Department, StatusConfig } from "@/lib/types";

/**
 * Diagram controls (§19).
 *
 * With 44 projects and dozens of connections, showing everything at once is
 * the failure mode the spec calls a spaghetti diagram. These controls exist to
 * make the sheet legible by subtraction.
 */

export type ConnectionView = "ALL" | "CONFIRMED" | "SUGGESTED" | "NONE";
export type FocusScope = "DIRECT" | "UPSTREAM" | "DOWNSTREAM" | "ALL";

export interface Filters {
  search: string;
  departments: Set<string>;
  statuses: Set<string>;
  types: Set<string>;
  connectionView: ConnectionView;
  showApprovedOnly: boolean;
  futureOnly: boolean;
}

export const EMPTY_FILTERS: Filters = {
  search: "",
  departments: new Set(),
  statuses: new Set(),
  types: new Set(),
  // Start by showing everything: with no connection approved yet, defaulting
  // to "approved only" would open on an empty sheet.
  connectionView: "ALL",
  showApprovedOnly: false,
  futureOnly: false,
};

const CONNECTION_VIEWS: { value: ConnectionView; label: string; hint: string }[] = [
  { value: "ALL", label: "Show all", hint: "Every connection, reviewed or not" },
  { value: "CONFIRMED", label: "Approved only", hint: "Confirmed architecture" },
  { value: "SUGGESTED", label: "AI suggestions", hint: "Waiting for review" },
  { value: "NONE", label: "Hide connections", hint: "Cards only" },
];

export default function FilterRail({
  departments,
  statuses,
  connectionTypes,
  filters,
  onChange,
  focusScope,
  onFocusScopeChange,
  hasSelection,
  counts,
}: {
  departments: Department[];
  statuses: StatusConfig[];
  connectionTypes: ConnectionType[];
  filters: Filters;
  onChange: (next: Filters) => void;
  focusScope: FocusScope;
  onFocusScopeChange: (scope: FocusScope) => void;
  hasSelection: boolean;
  counts: { projects: number; totalProjects: number; edges: number; totalEdges: number };
}) {
  const [open, setOpen] = useState({ dept: true, status: true, type: false });

  function toggleSet(key: "departments" | "statuses" | "types", value: string) {
    const next = new Set(filters[key]);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange({ ...filters, [key]: next });
  }

  const anyFilter =
    filters.search ||
    filters.departments.size ||
    filters.statuses.size ||
    filters.types.size ||
    filters.futureOnly;

  return (
    <aside className="w-[236px] shrink-0 border-r border-rule bg-sheet-raised flex flex-col overflow-hidden hide-when-presenting">
      <div className="px-3 py-2.5 border-b border-rule">
        <label htmlFor="plan-search" className="anno block mb-1.5">
          Search
        </label>
        <input
          id="plan-search"
          className="field"
          placeholder="Name, ID, owner, brief"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
        <p className="data mt-2" style={{ color: "var(--color-ink-soft)" }}>
          {counts.projects}/{counts.totalProjects} projects · {counts.edges}/{counts.totalEdges}{" "}
          connections
        </p>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        {hasSelection && (
          <Section title="Focus">
            <div className="grid grid-cols-2 gap-1">
              {(
                [
                  ["DIRECT", "Direct"],
                  ["UPSTREAM", "Upstream"],
                  ["DOWNSTREAM", "Downstream"],
                  ["ALL", "All dependencies"],
                ] as [FocusScope, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => onFocusScopeChange(value)}
                  aria-pressed={focusScope === value}
                  className="anno px-2 py-1.5 border text-left"
                  style={
                    focusScope === value
                      ? { background: "var(--color-ink)", color: "#fff", borderColor: "var(--color-ink)" }
                      : { borderColor: "var(--color-rule)" }
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="Connections">
          <div className="space-y-1">
            {CONNECTION_VIEWS.map((view) => (
              <label
                key={view.value}
                className="flex items-start gap-2 cursor-pointer py-0.5"
                title={view.hint}
              >
                <input
                  type="radio"
                  name="connection-view"
                  className="mt-0.5 accent-[#16202a]"
                  checked={filters.connectionView === view.value}
                  onChange={() => onChange({ ...filters, connectionView: view.value })}
                />
                <span className="anno">{view.label}</span>
              </label>
            ))}
          </div>
        </Section>

        <Section
          title={`Connection type${filters.types.size ? ` · ${filters.types.size}` : ""}`}
          collapsible
          isOpen={open.type}
          onToggle={() => setOpen((o) => ({ ...o, type: !o.type }))}
        >
          {connectionTypes.map((type) => (
            <Check
              key={type.type_id}
              checked={filters.types.has(type.type_id)}
              onChange={() => toggleSet("types", type.type_id)}
              label={type.type_name}
            />
          ))}
        </Section>

        <Section
          title={`Department${filters.departments.size ? ` · ${filters.departments.size}` : ""}`}
          collapsible
          isOpen={open.dept}
          onToggle={() => setOpen((o) => ({ ...o, dept: !o.dept }))}
        >
          {departments.map((dept) => (
            <Check
              key={dept.dept_code}
              checked={filters.departments.has(dept.dept_code)}
              onChange={() => toggleSet("departments", dept.dept_code)}
              label={dept.dept_name_en}
              prefix={dept.dept_code}
              swatch={dept.color}
            />
          ))}
        </Section>

        <Section
          title={`Status${filters.statuses.size ? ` · ${filters.statuses.size}` : ""}`}
          collapsible
          isOpen={open.status}
          onToggle={() => setOpen((o) => ({ ...o, status: !o.status }))}
        >
          {statuses.map((status) => (
            <Check
              key={status.status_id}
              checked={filters.statuses.has(status.status_id)}
              onChange={() => toggleSet("statuses", status.status_id)}
              label={status.status_name}
              swatch={status.color}
            />
          ))}
        </Section>

        <Section title="Project type">
          <Check
            checked={filters.futureOnly}
            onChange={() => onChange({ ...filters, futureOnly: !filters.futureOnly })}
            label="Future add-ons only"
          />
        </Section>
      </div>

      <div className="border-t border-rule p-2.5">
        <button
          className="btn btn-quiet w-full"
          disabled={!anyFilter}
          onClick={() =>
            onChange({ ...EMPTY_FILTERS, connectionView: filters.connectionView })
          }
        >
          Clear filters
        </button>
      </div>
    </aside>
  );
}

function Section({
  title,
  children,
  collapsible,
  isOpen = true,
  onToggle,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
}) {
  return (
    <section className="border-b border-rule">
      {collapsible ? (
        <button
          onClick={onToggle}
          aria-expanded={isOpen}
          className="anno w-full px-3 py-2 flex items-center justify-between hover:bg-[rgba(147,163,174,0.12)]"
        >
          <span>{title}</span>
          <span aria-hidden>{isOpen ? "–" : "+"}</span>
        </button>
      ) : (
        <div className="anno px-3 pt-2.5 pb-1.5">{title}</div>
      )}
      {isOpen && <div className="px-3 pb-2.5 pt-0.5">{children}</div>}
    </section>
  );
}

function Check({
  checked,
  onChange,
  label,
  prefix,
  swatch,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  prefix?: string;
  swatch?: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer py-[3px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="accent-[#16202a] shrink-0"
      />
      {swatch && (
        <span
          className="w-2.5 h-2.5 shrink-0 border border-[rgba(0,0,0,0.25)]"
          style={{ background: swatch }}
          aria-hidden
        />
      )}
      {prefix && <span className="partno shrink-0">{prefix}</span>}
      <span className="text-[12px] truncate" title={label}>
        {label}
      </span>
    </label>
  );
}
