import "server-only";
import { all, get } from "./db";
import { editableProjectIds } from "./permissions";
import { completenessPercent, isOverdue, isStale } from "./completeness";
import type {
  Connection,
  ConnectionType,
  Department,
  MasterPlanData,
  Project,
  SessionUser,
  StatusConfig,
} from "./types";

export function getDepartments(): Department[] {
  return all<Department>(
    `SELECT * FROM departments WHERE active = 1 ORDER BY display_order`
  );
}

export function getStatuses(): StatusConfig[] {
  return all<StatusConfig>(
    `SELECT * FROM status_config WHERE active = 1 ORDER BY display_order`
  );
}

export function getConnectionTypes(): ConnectionType[] {
  return all<ConnectionType>(
    `SELECT * FROM connection_types WHERE active = 1 ORDER BY display_order`
  );
}

export function getProjects(): Project[] {
  return all<Project>(
    `SELECT * FROM projects WHERE active = 1
      ORDER BY dept_code, CAST(SUBSTR(project_id, INSTR(project_id, '-') + 1) AS INTEGER)`
  );
}

export function getProject(projectId: string): Project | undefined {
  return get<Project>(`SELECT * FROM projects WHERE project_id = ?`, [projectId]);
}

/** Rejected connections stay in the database but leave the working diagram. */
export function getConnections(): Connection[] {
  return all<Connection>(
    `SELECT * FROM connections WHERE active = 1 ORDER BY connection_id`
  );
}

export function getConnection(connectionId: string): Connection | undefined {
  return get<Connection>(`SELECT * FROM connections WHERE connection_id = ?`, [connectionId]);
}

export function masterPlanData(session: SessionUser): MasterPlanData {
  return {
    departments: getDepartments(),
    statuses: getStatuses(),
    connectionTypes: getConnectionTypes(),
    projects: getProjects(),
    connections: getConnections(),
    editableProjectIds: editableProjectIds(session),
  };
}

/** Next free sequential number for a department, e.g. AF-008. (§3, §6) */
export function nextProjectId(deptCode: string): string {
  const row = get<{ maxNum: number | null }>(
    `SELECT MAX(CAST(SUBSTR(project_id, INSTR(project_id, '-') + 1) AS INTEGER)) AS maxNum
       FROM projects WHERE dept_code = ?`,
    [deptCode]
  );
  const next = (row?.maxNum ?? 0) + 1;
  return `${deptCode}-${String(next).padStart(3, "0")}`;
}

export function nextConnectionId(): string {
  const row = get<{ maxNum: number | null }>(
    `SELECT MAX(CAST(SUBSTR(connection_id, 5) AS INTEGER)) AS maxNum FROM connections`
  );
  return `CON-${String((row?.maxNum ?? 0) + 1).padStart(3, "0")}`;
}

export function connectionCountByProject(): Map<string, number> {
  const counts = new Map<string, number>();
  const rows = all<{ source_project_id: string; target_project_id: string }>(
    `SELECT source_project_id, target_project_id FROM connections
      WHERE active = 1 AND connection_status <> 'REJECTED'`
  );
  for (const row of rows) {
    counts.set(row.source_project_id, (counts.get(row.source_project_id) ?? 0) + 1);
    counts.set(row.target_project_id, (counts.get(row.target_project_id) ?? 0) + 1);
  }
  return counts;
}

export interface GovernanceRow {
  project: Project;
  completeness: number;
  connections: number;
  overdue: boolean;
  stale: boolean;
}

export interface GovernanceSummary {
  rows: GovernanceRow[];
  totals: {
    projects: number;
    averageCompleteness: number;
    withoutOwner: number;
    withoutDataOwner: number;
    withoutSystemOwner: number;
    withoutDueDate: number;
    connectionsNotReviewed: number;
    blocked: number;
    overdue: number;
    stale: number;
    isolated: number;
    aiSuggestionsPending: number;
    approvedConnections: number;
  };
}

/** Architecture audit indicators for the executive view (§37). */
export function governanceSummary(): GovernanceSummary {
  const projects = getProjects();
  const counts = connectionCountByProject();

  const rows: GovernanceRow[] = projects.map((project) => ({
    project,
    completeness: completenessPercent(project, counts.get(project.project_id) ?? 0),
    connections: counts.get(project.project_id) ?? 0,
    overdue: isOverdue(project),
    stale: isStale(project),
  }));

  const pending =
    get<{ n: number }>(
      `SELECT COUNT(*) n FROM connections WHERE active = 1 AND connection_status = 'AI_SUGGESTED'`
    )?.n ?? 0;
  const approved =
    get<{ n: number }>(
      `SELECT COUNT(*) n FROM connections WHERE active = 1 AND connection_status IN ('APPROVED','EDITED')`
    )?.n ?? 0;

  return {
    rows,
    totals: {
      projects: projects.length,
      averageCompleteness: rows.length
        ? Math.round(rows.reduce((sum, r) => sum + r.completeness, 0) / rows.length)
        : 0,
      withoutOwner: projects.filter((p) => !p.owner_user_id && !p.owner_name).length,
      withoutDataOwner: projects.filter((p) => !p.data_owner).length,
      withoutSystemOwner: projects.filter((p) => !p.system_owner).length,
      withoutDueDate: projects.filter((p) => !p.final_due_date && !p.checkpoint_due_date).length,
      connectionsNotReviewed: projects.filter(
        (p) =>
          p.connection_review_status !== "HUMAN_REVIEWED" &&
          p.connection_review_status !== "CONFIRMED"
      ).length,
      blocked: projects.filter((p) => p.status_id === "BLOCKED").length,
      overdue: rows.filter((r) => r.overdue).length,
      stale: rows.filter((r) => r.stale).length,
      isolated: rows.filter((r) => r.connections === 0).length,
      aiSuggestionsPending: pending,
      approvedConnections: approved,
    },
  };
}
