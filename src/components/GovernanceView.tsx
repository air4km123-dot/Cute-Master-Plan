"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { GovernanceSummary } from "@/lib/queries";
import type { Department, StatusConfig } from "@/lib/types";
import { shortDate } from "./flow/ProjectNode";

/**
 * Soft-audit readiness (§36, §37).
 *
 * Data completeness answers "do we know enough about this project?" and is
 * deliberately kept apart from progress, which answers "how far has the work
 * got?". The indicator strip is the list of things a director would otherwise
 * have to ask for one project at a time.
 */

type Indicator =
  | "ALL"
  | "NO_OWNER"
  | "NO_DATA_OWNER"
  | "NO_SYSTEM_OWNER"
  | "NO_DUE_DATE"
  | "NOT_REVIEWED"
  | "BLOCKED"
  | "OVERDUE"
  | "STALE"
  | "ISOLATED";

export default function GovernanceView({
  summary,
  departments,
  statuses,
}: {
  summary: GovernanceSummary;
  departments: Department[];
  statuses: StatusConfig[];
}) {
  const [indicator, setIndicator] = useState<Indicator>("ALL");
  const [sort, setSort] = useState<"completeness" | "project" | "progress">("completeness");

  const deptByCode = useMemo(
    () => new Map(departments.map((d) => [d.dept_code, d])),
    [departments]
  );
  const statusById = useMemo(
    () => new Map(statuses.map((s) => [s.status_id, s])),
    [statuses]
  );

  const rows = useMemo(() => {
    const filtered = summary.rows.filter(({ project, overdue, stale, connections }) => {
      switch (indicator) {
        case "NO_OWNER":
          return !project.owner_user_id && !project.owner_name;
        case "NO_DATA_OWNER":
          return !project.data_owner;
        case "NO_SYSTEM_OWNER":
          return !project.system_owner;
        case "NO_DUE_DATE":
          return !project.final_due_date && !project.checkpoint_due_date;
        case "NOT_REVIEWED":
          return (
            project.connection_review_status !== "HUMAN_REVIEWED" &&
            project.connection_review_status !== "CONFIRMED"
          );
        case "BLOCKED":
          return project.status_id === "BLOCKED";
        case "OVERDUE":
          return overdue;
        case "STALE":
          return stale;
        case "ISOLATED":
          return connections === 0;
        default:
          return true;
      }
    });

    return [...filtered].sort((a, b) => {
      if (sort === "project") return a.project.project_id.localeCompare(b.project.project_id);
      if (sort === "progress") return b.project.progress_percent - a.project.progress_percent;
      return a.completeness - b.completeness;
    });
  }, [summary.rows, indicator, sort]);

  const t = summary.totals;

  return (
    <div className="h-full overflow-y-auto thin-scroll">
      <div className="max-w-[1180px] mx-auto p-6">
        <header className="mb-5">
          <h1 className="anno-lg text-[17px]">Architecture audit</h1>
          <p className="note mt-1 max-w-[62ch]">
            Where the Master Plan is thin. Data completeness measures how much we know about a
            project — it is not the same number as progress, which measures how far the work has
            got.
          </p>
        </header>

        {/* headline figures */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <BigStat label="Approved projects" value={t.projects} />
          <BigStat label="Average data completeness" value={`${t.averageCompleteness}%`} />
          <BigStat label="Connections approved" value={t.approvedConnections} />
          <BigStat
            label="AI suggestions awaiting review"
            value={t.aiSuggestionsPending}
            stamp={t.aiSuggestionsPending > 0}
          />
        </div>

        {/* indicators */}
        <div className="panel mb-5">
          <div className="anno px-3 py-2 border-b border-rule">Indicators — click to filter</div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            <Indicator
              current={indicator}
              value="ALL"
              onSelect={setIndicator}
              label="All projects"
              count={t.projects}
            />
            <Indicator
              current={indicator}
              value="NOT_REVIEWED"
              onSelect={setIndicator}
              label="Connections not reviewed"
              count={t.connectionsNotReviewed}
            />
            <Indicator
              current={indicator}
              value="NO_OWNER"
              onSelect={setIndicator}
              label="No owner"
              count={t.withoutOwner}
            />
            <Indicator
              current={indicator}
              value="NO_DATA_OWNER"
              onSelect={setIndicator}
              label="No data owner"
              count={t.withoutDataOwner}
            />
            <Indicator
              current={indicator}
              value="NO_SYSTEM_OWNER"
              onSelect={setIndicator}
              label="No system owner"
              count={t.withoutSystemOwner}
            />
            <Indicator
              current={indicator}
              value="NO_DUE_DATE"
              onSelect={setIndicator}
              label="No due date"
              count={t.withoutDueDate}
            />
            <Indicator
              current={indicator}
              value="BLOCKED"
              onSelect={setIndicator}
              label="Blocked"
              count={t.blocked}
            />
            <Indicator
              current={indicator}
              value="OVERDUE"
              onSelect={setIndicator}
              label="Overdue"
              count={t.overdue}
            />
            <Indicator
              current={indicator}
              value="STALE"
              onSelect={setIndicator}
              label="Not updated in 90 days"
              count={t.stale}
            />
            <Indicator
              current={indicator}
              value="ISOLATED"
              onSelect={setIndicator}
              label="No relationships"
              count={t.isolated}
            />
          </div>
        </div>

        {/* table */}
        <div className="panel">
          <div className="flex items-center gap-3 px-3 py-2 border-b border-rule">
            <span className="anno">
              {rows.length} {rows.length === 1 ? "project" : "projects"}
            </span>
            <div className="flex-1" />
            <label htmlFor="gov-sort" className="anno">
              Sort
            </label>
            <select
              id="gov-sort"
              className="field w-auto py-1"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
            >
              <option value="completeness">Least complete first</option>
              <option value="project">Project ID</option>
              <option value="progress">Progress</option>
            </select>
          </div>

          {rows.length === 0 ? (
            <p className="note p-4">No projects match this indicator. Nothing to chase here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Department</th>
                    <th>Owner</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th>Data completeness</th>
                    <th>Links</th>
                    <th>Due</th>
                    <th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ project, completeness, connections, overdue, stale }) => {
                    const dept = deptByCode.get(project.dept_code);
                    const status = statusById.get(project.status_id);
                    return (
                      <tr key={project.project_id}>
                        <td>
                          <Link href="/" className="partno underline underline-offset-2">
                            {project.project_id}
                          </Link>
                          <div className="text-[12px] mt-0.5 max-w-[240px]">
                            {project.project_name}
                          </div>
                        </td>
                        <td>
                          <span className="flex items-center gap-1.5">
                            <span
                              className="w-2.5 h-2.5 border border-[rgba(0,0,0,0.2)] shrink-0"
                              style={{ background: dept?.color }}
                              aria-hidden
                            />
                            <span className="partno">{project.dept_code}</span>
                          </span>
                        </td>
                        <td className="text-[12px]">
                          {project.owner_name ?? (
                            <span style={{ color: "var(--color-stamp)" }}>Not set</span>
                          )}
                        </td>
                        <td>
                          {status && (
                            <span className="badge" style={{ background: status.color }}>
                              {status.status_name}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className="flex items-center gap-1.5">
                            <span className="scale w-[54px]">
                              <span
                                className="scale-fill block h-full"
                                style={{ width: `${project.progress_percent}%` }}
                              />
                            </span>
                            <span className="data">{project.progress_percent}%</span>
                          </span>
                        </td>
                        <td>
                          <span className="flex items-center gap-1.5">
                            <span className="scale w-[54px]">
                              <span
                                className="scale-fill block h-full"
                                style={{ width: `${completeness}%` }}
                              />
                            </span>
                            <span className="data">{completeness}%</span>
                          </span>
                        </td>
                        <td className="data">{connections}</td>
                        <td className="data">
                          {shortDate(project.final_due_date) ?? (
                            <span style={{ color: "var(--color-ink-faint)" }}>—</span>
                          )}
                        </td>
                        <td>
                          <span className="flex flex-wrap gap-1">
                            {overdue && <Flag>Overdue</Flag>}
                            {stale && <Flag>Stale</Flag>}
                            {connections === 0 && <Flag>Isolated</Flag>}
                            {project.project_type === "FUTURE_ADDON" && <Flag>Future</Flag>}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BigStat({
  label,
  value,
  stamp,
}: {
  label: string;
  value: string | number;
  stamp?: boolean;
}) {
  return (
    <div className="panel ticked px-3.5 py-3">
      <div className="anno">{label}</div>
      <div
        className="mt-1 text-[26px] font-bold leading-none"
        style={{ fontFamily: "var(--font-data)", color: stamp ? "var(--color-stamp)" : undefined }}
      >
        {value}
      </div>
    </div>
  );
}

function Indicator({
  current,
  value,
  onSelect,
  label,
  count,
}: {
  current: Indicator;
  value: Indicator;
  onSelect: (value: Indicator) => void;
  label: string;
  count: number;
}) {
  const active = current === value;
  const attention = count > 0 && value !== "ALL";
  return (
    <button
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className="text-left px-3 py-2.5 border-r border-b border-rule hover:bg-[rgba(147,163,174,0.12)] transition-colors"
      style={active ? { background: "var(--color-ink)", color: "#fff" } : undefined}
    >
      <div
        className="text-[19px] font-bold leading-none"
        style={{
          fontFamily: "var(--font-data)",
          color: active ? "#fff" : attention ? "var(--color-stamp)" : "var(--color-ink)",
        }}
      >
        {count}
      </div>
      <div className="anno mt-1" style={active ? { color: "#fff" } : undefined}>
        {label}
      </div>
    </button>
  );
}

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <span className="anno border border-stamp px-1 py-px" style={{ color: "var(--color-stamp)" }}>
      {children}
    </span>
  );
}
