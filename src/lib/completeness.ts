import type { Project } from "./types";

/**
 * Data Completeness (Addendum V2 §36).
 *
 * This measures whether we know enough ABOUT a project — it is deliberately
 * not the same number as Progress, which measures how far the work has got.
 * A project can be 80% built and 30% documented.
 */

export interface CompletenessCheck {
  key: string;
  label: string;
  ok: boolean;
}

const STALE_AFTER_DAYS = 90;

export function completenessChecks(
  project: Project,
  connectionCount: number
): CompletenessCheck[] {
  const daysSinceUpdate =
    (Date.now() - new Date(project.updated_at).getTime()) / (1000 * 60 * 60 * 24);

  return [
    { key: "project_id", label: "Project ID", ok: !!project.project_id },
    { key: "owner", label: "Owner", ok: !!project.owner_user_id || !!project.owner_name },
    { key: "status", label: "Status", ok: !!project.status_id },
    {
      key: "progress",
      label: "Progress",
      // A genuine 0% on a Not Started project counts as recorded.
      ok: project.progress_percent > 0 || project.status_id === "NOT_STARTED",
    },
    {
      key: "due_date",
      label: "Due date",
      ok: !!project.final_due_date || !!project.checkpoint_due_date,
    },
    { key: "data_owner", label: "Data owner", ok: !!project.data_owner },
    { key: "system_owner", label: "System owner", ok: !!project.system_owner },
    {
      key: "connections_reviewed",
      label: "Connections reviewed",
      ok:
        project.connection_review_status === "HUMAN_REVIEWED" ||
        project.connection_review_status === "CONFIRMED",
    },
    { key: "objective", label: "Objective", ok: !!project.objective?.trim() },
    {
      key: "recently_updated",
      label: "Updated recently",
      ok: daysSinceUpdate <= STALE_AFTER_DAYS,
    },
    {
      key: "has_relationships",
      label: "Has relationships",
      ok: connectionCount > 0,
    },
  ];
}

export function completenessPercent(project: Project, connectionCount: number): number {
  const checks = completenessChecks(project, connectionCount);
  const passed = checks.filter((c) => c.ok).length;
  return Math.round((passed / checks.length) * 100);
}

export function isStale(project: Project): boolean {
  const days = (Date.now() - new Date(project.updated_at).getTime()) / (1000 * 60 * 60 * 24);
  return days > STALE_AFTER_DAYS;
}

export function isOverdue(project: Project): boolean {
  if (!project.final_due_date) return false;
  if (project.status_id === "LIVE" || project.status_id === "INTEGRATED") return false;
  return project.final_due_date < new Date().toISOString().slice(0, 10);
}
