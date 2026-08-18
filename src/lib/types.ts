/** Shared domain types. Mirrors src/lib/schema.sql. */

export type Role = "ADMIN" | "OWNER" | "VIEWER";

export type ProjectType = "APPROVED" | "FUTURE_ADDON";

export type ConnectionStatus =
  | "NOT_REVIEWED"
  | "AI_SUGGESTED"
  | "APPROVED"
  | "EDITED"
  | "REJECTED";

export type ConnectionReviewStatus =
  | "NOT_REVIEWED"
  | "AI_REVIEWED"
  | "HUMAN_REVIEWED"
  | "CONFIRMED";

export type Direction = "ONE_WAY" | "BIDIRECTIONAL";

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface SessionUser {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
  departmentId: string | null;
}

export interface Department {
  dept_code: string;
  dept_name_th: string;
  dept_name_en: string;
  color: string;
  head_name: string | null;
  display_order: number;
  active: number;
}

export interface StatusConfig {
  status_id: string;
  status_name: string;
  display_order: number;
  color: string;
  active: number;
}

export interface ConnectionType {
  type_id: string;
  type_name: string;
  color: string;
  display_order: number;
  active: number;
}

export interface Project {
  project_id: string;
  source_seq: number | null;
  dept_code: string;
  project_name: string;
  project_type: ProjectType;
  phase: string;
  priority: number | null;
  owner_user_id: string | null;
  owner_name: string | null;
  data_owner: string | null;
  system_owner: string | null;
  objective: string | null;
  brief: string | null;
  notes: string | null;
  status_id: string;
  status_original: string | null;
  next_step: string | null;
  progress_percent: number;
  use_checkpoints: number;
  checkpoint_due_date: string | null;
  final_due_date: string | null;
  connection_review_status: ConnectionReviewStatus;
  layout_x: number | null;
  layout_y: number | null;
  active: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;

  // Google Sheet source-row identity. See src/lib/googleSheetsSync.ts.
  source_sheet_id: string | null;
  source_tab: string | null;
  source_row_number: number | null;
  source_dept: string | null;
  source_state: SourceState;
  source_last_seen_at: string | null;
  source_updated_at: string | null;
}

/**
 * PRESENT        matched to a row in the sheet at the last sync
 * SOURCE_MISSING its row has disappeared — flagged, never deleted
 * MANUAL         created in the app (future add-on); has no source row
 */
export type SourceState = "PRESENT" | "SOURCE_MISSING" | "MANUAL";

export interface Connection {
  connection_id: string;
  source_project_id: string;
  target_project_id: string;
  direction: Direction;
  connection_type: string;
  connection_label: string;
  detailed_description: string | null;
  data_or_process_name: string | null;
  connection_status: ConnectionStatus;
  proposed_by: string | null;
  reviewed_by: string | null;
  review_date: string | null;
  confidence: Confidence | null;
  reason: string | null;
  active: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface AuditEntry {
  audit_id: number;
  timestamp: string;
  user_id: string | null;
  username: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  source: string;
  notes: string | null;
}

export interface AppUser {
  user_id: string;
  username: string;
  display_name: string;
  role: Role;
  department_id: string | null;
  must_set_password: number;
  active: number;
  created_at: string;
  last_login: string | null;
}

/** Everything the Master Plan screen needs in one payload. */
export interface MasterPlanData {
  departments: Department[];
  statuses: StatusConfig[];
  connectionTypes: ConnectionType[];
  projects: Project[];
  connections: Connection[];
  editableProjectIds: string[];
}
