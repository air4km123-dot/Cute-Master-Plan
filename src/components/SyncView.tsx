"use client";

import { useEffect, useState } from "react";
import type { SyncPlan, SyncStatus, SyncRunRecord } from "@/lib/googleSheetsSync";

/**
 * Google Sheet sync console.
 *
 * Check is a preview and writes nothing. Apply writes only the safe subset, and
 * the button says so. Critical conflicts are shown above everything else because
 * they are the one thing that stops a project from being updated at all.
 */

export default function SyncView({
  initialStatus,
  canSync,
}: {
  initialStatus: SyncStatus;
  canSync: boolean;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [busy, setBusy] = useState<"check" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  async function run(kind: "check" | "apply") {
    setBusy(kind);
    setError(null);
    setApplied(null);
    try {
      const response = await fetch(`/api/sync/google-sheet/${kind}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "The sync request failed.");
        return;
      }
      setPlan(body.plan);
      if (body.status) setStatus(body.status);
      if (kind === "apply") {
        setApplied(
          `Applied ${body.appliedFields} field change${body.appliedFields === 1 ? "" : "s"} ` +
            `across ${body.appliedProjects} project${body.appliedProjects === 1 ? "" : "s"}.` +
            (body.skippedBlocked
              ? ` ${body.skippedBlocked} project(s) skipped — blocked by a critical conflict.`
              : "")
        );
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const critical = plan?.conflicts.filter((c) => c.severity === "CRITICAL") ?? [];
  const warnings = plan?.conflicts.filter((c) => c.severity === "WARNING") ?? [];
  const changedProjects = plan?.projects.filter((p) => p.state === "CHANGED") ?? [];
  const blockedProjects = plan?.projects.filter((p) => p.state === "BLOCKED") ?? [];

  return (
    <div className="h-full overflow-y-auto thin-scroll">
      <div className="max-w-[1180px] mx-auto p-6">
        <header className="mb-5">
          <h1 className="anno-lg text-[17px]">Google Sheet sync</h1>
          <p className="note mt-1 max-w-[74ch]">
            The sheet is the source of truth for project name, priority, owner, brief, status
            text, notes and source department. Everything Air4 decides here — progress,
            checkpoints, due dates, data and system owner, connections, reviews, layout and audit
            history — is never touched by a sync. One engine covers all twelve departments in a
            single pass.
          </p>
        </header>

        {/* ---------------- source + last sync ---------------- */}
        <div className="panel mb-4">
          <div className="px-3 py-2 border-b border-rule flex items-center gap-3">
            <span className="anno-lg">Source</span>
            <div className="flex-1" />
            <span className="anno">
              {status.configured ? `auth · ${status.sourceMode}` : "not configured"}
            </span>
          </div>

          <div className="p-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Field label="Spreadsheet">
              <span className="data break-all">{status.spreadsheetId}</span>
            </Field>
            <Field label="Tab">
              <span className="text-[12px]">{status.tab}</span>{" "}
              <span className="data">· gid {status.gid}</span>
            </Field>
            <Field label="Last checked">
              <RunStamp run={status.lastCheck} />
            </Field>
            <Field label="Last applied">
              <RunStamp run={status.lastApply} />
            </Field>
          </div>

          {!status.configured && (
            <p className="note px-3 pb-3" style={{ color: "var(--color-stamp)" }}>
              {status.problem}
            </p>
          )}

          {status.lastApply && (
            <div className="px-3 pb-3 flex flex-wrap gap-x-5 gap-y-1">
              <Stat label="Projects changed" value={status.lastApply.applied_projects} />
              <Stat label="Fields written" value={status.lastApply.applied_fields} />
              <Stat label="Warnings" value={status.lastApply.warning_count} />
              <Stat label="Conflicts" value={status.lastApply.conflict_count} stamp />
              <Stat label="New rows" value={status.lastApply.new_count} />
            </div>
          )}
        </div>

        {/* ---------------- actions ---------------- */}
        {canSync ? (
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <button
              className="btn btn-solid"
              onClick={() => run("check")}
              disabled={busy !== null || !status.configured}
            >
              {busy === "check" ? "Checking…" : "Check Google Sheet updates"}
            </button>
            <button
              className="btn btn-stamp"
              onClick={() => run("apply")}
              disabled={busy !== null || !plan || plan.summary.fieldChanges + plan.summary.missing === 0}
              title={
                plan
                  ? "Applies safe source fields only. Conflicts are skipped."
                  : "Run a check first."
              }
            >
              {busy === "apply" ? "Applying…" : "Apply safe updates"}
            </button>
            {plan && (
              <span className="note">
                Preview generated <LocalTime iso={plan.generatedAt} /> · read-only
              </span>
            )}
          </div>
        ) : (
          <p className="note mb-4">
            Only an admin can run a sync. The report below is visible to everyone.
          </p>
        )}

        {error && (
          <div className="panel p-3 mb-4" style={{ borderColor: "var(--color-stamp)" }}>
            <span className="anno" style={{ color: "var(--color-stamp)" }}>
              Sync failed
            </span>
            <p className="text-[12px] mt-1">{error}</p>
          </div>
        )}

        {applied && (
          <div className="panel p-3 mb-4">
            <span className="anno">Applied</span>
            <p className="text-[12px] mt-1">{applied}</p>
          </div>
        )}

        {/* ---------------- summary ---------------- */}
        {plan && (
          <>
            <div className="panel mb-4">
              <div className="px-3 py-2 border-b border-rule">
                <span className="anno-lg">Update check</span>
              </div>
              <div className="p-3 flex flex-wrap gap-x-7 gap-y-2">
                <Stat label="Rows read" value={plan.summary.rowsRead} />
                <Stat label="Changed projects" value={plan.summary.changed} />
                <Stat label="Unchanged" value={plan.summary.unchanged} />
                <Stat label="New source rows" value={plan.summary.newRows} />
                <Stat label="Missing source rows" value={plan.summary.missing} />
                <Stat label="Warnings" value={plan.summary.warnings} />
                <Stat label="Conflicts" value={plan.summary.conflicts} stamp />
                <Stat label="Fields to write" value={plan.summary.fieldChanges} />
              </div>
            </div>

            {/* Critical first — these block a project entirely. */}
            {critical.length > 0 && (
              <Section title={`Critical conflicts · ${critical.length}`} stamp>
                <p className="note px-3 pt-2">
                  Never applied automatically. Each one blocks every update to the project it
                  names until a human decides.
                </p>
                <ConflictTable rows={critical} />
              </Section>
            )}

            {changedProjects.length > 0 && (
              <Section title={`Changes to apply · ${changedProjects.length} projects`}>
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Field</th>
                        <th>Current</th>
                        <th>Sheet</th>
                        <th>Row</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changedProjects.flatMap((project) =>
                        project.changes.map((change, index) => (
                          <tr key={`${project.projectId}-${change.field}`}>
                            <td className="whitespace-nowrap">
                              {index === 0 ? (
                                <>
                                  <span className="partno">{project.projectId}</span>
                                  <div className="note max-w-[190px] truncate">
                                    {project.projectName}
                                  </div>
                                </>
                              ) : null}
                            </td>
                            <td className="anno whitespace-nowrap">
                              {change.label}
                              {!change.safe && (
                                <div className="note" style={{ color: "var(--color-stamp)" }}>
                                  not applied
                                </div>
                              )}
                            </td>
                            <td className="max-w-[290px] text-[12px] align-top">
                              {change.before ?? <span className="note">— empty —</span>}
                            </td>
                            <td className="max-w-[290px] text-[12px] align-top font-bold">
                              {change.after ?? <span className="note">— empty —</span>}
                            </td>
                            <td className="data">{project.sourceRow ?? "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {blockedProjects.length > 0 && (
              <Section title={`Blocked projects · ${blockedProjects.length}`} stamp>
                <p className="note px-3 py-2">
                  These have sheet changes waiting, but a critical conflict means nothing is
                  written to them. Resolve the conflict, then check again.
                </p>
                <ul className="px-3 pb-3 space-y-1">
                  {blockedProjects.map((project) => (
                    <li key={project.projectId} className="text-[12px]">
                      <span className="partno">{project.projectId}</span> {project.projectName}
                      <span className="note"> · {project.changes.length} field(s) held</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {plan.newRows.length > 0 && (
              <Section title={`New source rows · ${plan.newRows.length}`}>
                <p className="note px-3 pt-2">
                  Held for admin review. Nothing is created, no Project ID is issued and nothing
                  is approved — a new row may equally be a rename, a duplicate or a row typed in
                  the wrong place.
                </p>
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Dept</th>
                        <th>Name</th>
                        <th>Priority</th>
                        <th>Owner</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.newRows.map((row) => (
                        <tr key={row.sourceRow}>
                          <td className="data">{row.sourceRow}</td>
                          <td>
                            <span className="partno">{row.sourceDept || "—"}</span>
                          </td>
                          <td className="text-[12px]">{row.name}</td>
                          <td className="data">{row.priority ?? "—"}</td>
                          <td className="text-[12px]">{row.ownerName || "—"}</td>
                          <td className="text-[12px]">{row.statusOriginal || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {plan.missing.length > 0 && (
              <Section title={`Missing source rows · ${plan.missing.length}`}>
                <p className="note px-3 pt-2">
                  Flagged, never deleted. Connections, progress, reviews and audit history stay
                  exactly as they are.
                </p>
                <ul className="px-3 py-2 space-y-1">
                  {plan.missing.map((project) => (
                    <li key={project.projectId} className="text-[12px]">
                      <span className="partno">{project.projectId}</span> {project.projectName}
                      <span className="note">
                        {" "}
                        · {project.alreadyFlagged ? "already flagged" : "newly missing"}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {warnings.length > 0 && (
              <Section title={`Warnings · ${warnings.length}`}>
                <ConflictTable rows={warnings} />
              </Section>
            )}

            {plan.summary.changed === 0 &&
              plan.summary.conflicts === 0 &&
              plan.summary.newRows === 0 &&
              plan.summary.missing === 0 && (
                <div className="panel p-4 mb-4">
                  <span className="anno">In step</span>
                  <p className="text-[12px] mt-1">
                    All {plan.summary.unchanged} projects match the sheet. Nothing was written and
                    no audit rows were created.
                  </p>
                </div>
              )}
          </>
        )}

        {/* ---------------- run history ---------------- */}
        {status.recent.length > 0 && (
          <Section title="Sync history">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Mode</th>
                    <th>By</th>
                    <th>Rows</th>
                    <th>Changed</th>
                    <th>Applied</th>
                    <th>Warn</th>
                    <th>Conflict</th>
                  </tr>
                </thead>
                <tbody>
                  {status.recent.map((run) => (
                    <tr key={run.run_id}>
                      <td className="data whitespace-nowrap">
                        <LocalTime iso={run.started_at} />
                      </td>
                      <td className="anno">{run.mode}</td>
                      <td className="text-[12px]">{run.actor_username ?? "—"}</td>
                      <td className="data">{run.rows_read}</td>
                      <td className="data">{run.changed_count}</td>
                      <td className="data">{run.applied_fields}</td>
                      <td className="data">{run.warning_count}</td>
                      <td className="data">{run.conflict_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Section({
  title,
  children,
  stamp,
}: {
  title: string;
  children: React.ReactNode;
  stamp?: boolean;
}) {
  return (
    <div className="panel mb-4" style={stamp ? { borderColor: "var(--color-stamp)" } : undefined}>
      <div className="px-3 py-2 border-b border-rule">
        <span className="anno-lg" style={stamp ? { color: "var(--color-stamp)" } : undefined}>
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function ConflictTable({
  rows,
}: {
  rows: {
    type: string;
    projectId: string | null;
    sourceRow: number | null;
    message: string;
  }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>Type</th>
            <th>Project</th>
            <th>Row</th>
            <th>What a human has to decide</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.type}-${row.projectId}-${row.sourceRow}-${index}`}>
              <td className="anno whitespace-nowrap">{row.type.replace(/_/g, " ")}</td>
              <td className="whitespace-nowrap">
                {row.projectId ? <span className="partno">{row.projectId}</span> : "—"}
              </td>
              <td className="data">{row.sourceRow ?? "—"}</td>
              <td className="text-[12px] max-w-[620px]">{row.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A timestamp formatted in the reader's locale and time zone.
 *
 * `toLocaleString` resolves differently on the server than in the browser, so
 * rendering it directly makes the server and client markup disagree and React
 * reports a hydration failure. The value is deliberately client-only: the server
 * emits the raw ISO string and the browser replaces it on mount, which is
 * exactly what `suppressHydrationWarning` is for.
 */
function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState(iso);
  useEffect(() => setText(new Date(iso).toLocaleString()), [iso]);
  return <span suppressHydrationWarning>{text}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="anno">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function Stat({ label, value, stamp }: { label: string; value: number; stamp?: boolean }) {
  return (
    <div>
      <div className="anno">{label}</div>
      <div
        className="data text-[15px] font-bold"
        style={stamp && value > 0 ? { color: "var(--color-stamp)" } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function RunStamp({ run }: { run: SyncRunRecord | null }) {
  if (!run) return <span className="note">Never synced</span>;
  return (
    <span className="data">
      <LocalTime iso={run.started_at} />
      {run.actor_username ? <span className="note"> · {run.actor_username}</span> : null}
    </span>
  );
}
