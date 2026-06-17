// Typed wrappers over the Tauri command bridge. Each function calls a Rust
// `#[tauri::command]`; rejections carry the structured ApiError { code, message }.
import { invoke } from "@tauri-apps/api/core";

export type SslMode =
  | "disable"
  | "allow"
  | "prefer"
  | "require"
  | "verify-ca"
  | "verify-full";
export type EnvLabel = "local" | "staging" | "production";
export type RelationKind =
  | "table"
  | "view"
  | "materialized_view"
  | "partitioned_table"
  | "foreign_table"
  | "other";

export interface ConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl_mode: SslMode;
  env_label: EnvLabel;
  read_only: boolean;
}

export interface ConnectionInput {
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl_mode?: SslMode;
  env_label?: EnvLabel;
  read_only?: boolean;
  password?: string;
}

export interface TestResult {
  server_version: string;
  ssl: boolean;
}
export interface DatabaseInfo {
  name: string;
  owner: string;
  size_bytes: number;
  allow_conn: boolean;
}
export interface SchemaInfo {
  name: string;
  owner: string;
}
export interface RelationInfo {
  schema: string;
  name: string;
  kind: RelationKind;
  owner: string;
  total_size_bytes: number;
  comment: string | null;
}
export interface ColumnMeta {
  name: string;
  type_oid: number;
  type_name: string;
}
export interface QueryResult {
  columns: ColumnMeta[];
  rows: (string | null)[][];
  row_count: number;
  truncated: boolean;
  duration_ms: number;
}

export interface ColumnDef {
  name: string;
  type_oid: number;
  format_type: string;
  not_null: boolean;
}

export interface ColumnBrief {
  name: string;
  data_type: string;
}
export interface RelationColumns {
  schema: string;
  name: string;
  kind: RelationKind;
  columns: ColumnBrief[];
}
/** Compact schema model that backs schema-aware autocomplete. */
export interface CompletionModel {
  schemas: string[];
  relations: RelationColumns[];
  functions: string[];
}

// --- Production Safety Mode (risk scan) ---
export type RiskLevel = "none" | "low" | "medium" | "high";
export type ConfirmTier = "allow" | "confirm" | "type_to_confirm";
export interface RiskFinding {
  level: RiskLevel;
  kind: string;
  statement_index: number;
  message: string;
  object: string | null;
}
export interface RiskReport {
  level: RiskLevel;
  statement_count: number;
  findings: RiskFinding[];
  parsed: boolean;
  confirm_tier: ConfirmTier;
  confirm_phrase: string | null;
}

// --- AI v1 ---
export type AiProviderKind = "anthropic" | "open_ai_compatible" | "ollama";
export type AiFeature = "nl_to_sql" | "explain_sql" | "explain_error";
export interface AiSettings {
  provider: AiProviderKind;
  model?: string | null;
  api_key?: string | null;
  base_url?: string | null;
}
export interface AiInput {
  feature: AiFeature;
  prompt: string;
  error?: string | null;
}
export interface AiMessage {
  role: string;
  content: string;
}
export interface AiPayload {
  system: string;
  messages: AiMessage[];
  includes_data: boolean;
}
export interface AiResponse {
  text: string;
  provider: string;
  model: string;
}

// --- Data IO ---
export interface ImportOutcome {
  rows: number;
}

// --- Managed local PostgreSQL instances ---
export interface InstanceInfo {
  id: string;
  name: string;
  port: number;
  database: string;
  superuser: string;
  pg_version: string;
  url: string;
  running: boolean;
  connection_id: string | null;
}
export interface ActiveSessionDto {
  session_id: string;
  connection_id: string;
  name: string;
  env_label: EnvLabel;
  read_only: boolean;
}

// --- Licensing (open-core) ---
export type Plan = "free" | "pro" | "team";
export type Feature =
  | "schema_diff"
  | "erd_export"
  | "managed_ai"
  | "advanced_monitoring"
  | "table_designer"
  | "multi_workspace"
  | "backup_scheduling";
export interface Entitlements {
  plan: Plan;
  email: string | null;
  features: Feature[];
  expired: boolean;
}

/** A page of table data plus the identity the editable grid needs. */
export interface TableData {
  columns: ColumnMeta[];
  rows: (string | null)[][];
  /** Per-row captured xmin (parallel to rows); empty when not editable. */
  row_xmins: (string | null)[];
  editable: boolean;
  key_columns: string[];
  readonly_reason: string | null;
  truncated: boolean;
}

export interface CellValue {
  column: string;
  value: string | null;
}

/** One staged grid edit; mirrors the tagged Rust `RowEdit` enum. */
export type RowEdit =
  | {
      kind: "update";
      schema: string;
      table: string;
      key: CellValue[];
      xmin: string;
      set: CellValue[];
    }
  | { kind: "insert"; schema: string; table: string; values: CellValue[] }
  | { kind: "delete"; schema: string; table: string; key: CellValue[]; xmin: string };

export interface EditStatement {
  sql: string;
  params: (string | null)[];
  expect_rows: number;
}

export interface ApplyOutcome {
  applied: number;
}

export interface ApiError {
  code: string;
  message: string;
}

export function errMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as ApiError).message);
  }
  return e instanceof Error ? e.message : String(e);
}

export const api = {
  appInfo: () => invoke<{ app_version: string; core_version: string }>("app_info"),
  connectionCreate: (input: ConnectionInput) =>
    invoke<string>("connection_create", { input }),
  connectionList: () => invoke<ConnectionConfig[]>("connection_list"),
  connectionTest: (input: ConnectionInput) =>
    invoke<TestResult>("connection_test", { input }),
  connectionConnect: (connectionId: string) =>
    invoke<string>("connection_connect", { connectionId }),
  connectionDisconnect: (sessionId: string) =>
    invoke<void>("connection_disconnect", { sessionId }),
  connectionDelete: (connectionId: string) =>
    invoke<void>("connection_delete", { connectionId }),
  dbList: (sessionId: string) => invoke<DatabaseInfo[]>("db_list", { sessionId }),
  schemaList: (sessionId: string) =>
    invoke<SchemaInfo[]>("schema_list", { sessionId }),
  relationList: (sessionId: string, schema: string, kinds: string[]) =>
    invoke<RelationInfo[]>("relation_list", { sessionId, schema, kinds }),
  schemaCompletion: (sessionId: string) =>
    invoke<CompletionModel>("schema_completion", { sessionId }),
  relationColumns: (sessionId: string, schema: string, relation: string) =>
    invoke<ColumnBrief[]>("relation_columns", { sessionId, schema, relation }),
  queryAnalyze: (sessionId: string, sql: string) =>
    invoke<RiskReport>("query_analyze", { sessionId, sql }),
  queryExecute: (sessionId: string, sql: string, maxRows?: number, confirmed?: boolean) =>
    invoke<QueryResult>("query_execute", { sessionId, sql, maxRows, confirmed }),
  queryCancel: (sessionId: string) =>
    invoke<void>("query_cancel", { sessionId }),
  aiPreview: (sessionId: string, input: AiInput) =>
    invoke<AiPayload>("ai_preview", { sessionId, input }),
  aiRun: (sessionId: string, settings: AiSettings, input: AiInput) =>
    invoke<AiResponse>("ai_run", { sessionId, settings, input }),
  tableData: (
    sessionId: string,
    schema: string,
    table: string,
    limit?: number,
    offset?: number,
    after?: (string | null)[],
  ) =>
    invoke<TableData>("table_data", { sessionId, schema, table, limit, offset, after }),
  exportTableCsv: (sessionId: string, schema: string, table: string, path: string) =>
    invoke<number>("export_table_csv", { sessionId, schema, table, path }),
  exportQueryCsv: (sessionId: string, sql: string, path: string) =>
    invoke<number>("export_query_csv", { sessionId, sql, path }),
  importTableCsv: (
    sessionId: string,
    schema: string,
    table: string,
    path: string,
    header: boolean,
  ) => invoke<ImportOutcome>("import_table_csv", { sessionId, schema, table, path, header }),
  licenseStatus: (key: string | null) => invoke<Entitlements>("license_status", { key }),
  instanceProvision: (name: string) => invoke<InstanceInfo>("instance_provision", { name }),
  instanceList: () => invoke<InstanceInfo[]>("instance_list"),
  instanceStart: (id: string) => invoke<InstanceInfo>("instance_start", { id }),
  instanceStop: (id: string) => invoke<InstanceInfo>("instance_stop", { id }),
  instanceOpen: (id: string) => invoke<ActiveSessionDto>("instance_open", { id }),
  instanceRemove: (id: string) => invoke<void>("instance_remove", { id }),
  gridBuildEditSql: (sessionId: string, edits: RowEdit[]) =>
    invoke<EditStatement[]>("grid_build_edit_sql", { sessionId, edits }),
  gridApplyEdits: (sessionId: string, edits: RowEdit[], confirm: boolean) =>
    invoke<ApplyOutcome>("grid_apply_edits", { sessionId, edits, confirm }),
};
