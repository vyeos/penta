//! Tauri command bridge: thin wrappers over penta-core that the React UI calls
//! via `invoke`. Errors cross the boundary as the structured `ApiError`.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use penta_core::ai::{self, AiInput, AiPayload, AiResponse, AiSettings};
use penta_core::connection::{ConnectionConfig, EnvLabel, SslMode};
use penta_core::error::PentaError;
use penta_core::grid::{self, ApplyOutcome, RowEdit, Statement};
use penta_core::instance::{self, ManagedInstance, ProvisionOpts};
use penta_core::introspection::{
    self, ColumnBrief, CompletionModel, DatabaseInfo, RelationInfo, SchemaInfo,
};
use penta_core::io::{self, ImportOutcome};
use penta_core::manager::{Session, TestResult};
use penta_core::query::{self, ColumnMeta};
use penta_core::safety::{self, RiskReport};

use crate::state::AppState;

/// Structured error envelope for the UI (Decision: PentaError { code, message }).
#[derive(Debug, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl From<PentaError> for ApiError {
    fn from(e: PentaError) -> Self {
        ApiError {
            code: e.code().to_string(),
            message: e.to_string(),
        }
    }
}

type ApiResult<T> = Result<T, ApiError>;

/// Connection definition + optional password, as sent from the UI form.
#[derive(Debug, Deserialize)]
pub struct ConnectionInput {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    #[serde(default)]
    pub ssl_mode: SslMode,
    #[serde(default)]
    pub env_label: EnvLabel,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub password: Option<String>,
}

impl ConnectionInput {
    fn into_config(self) -> (ConnectionConfig, Option<String>) {
        let pw = self.password.clone();
        (
            ConnectionConfig {
                id: String::new(),
                name: self.name,
                host: self.host,
                port: self.port,
                database: self.database,
                username: self.username,
                ssl_mode: self.ssl_mode,
                env_label: self.env_label,
                read_only: self.read_only,
            },
            pw,
        )
    }
}

/// Result of a (capped) query execution returned to the grid.
#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<Option<String>>>,
    pub row_count: u64,
    pub truncated: bool,
    pub duration_ms: u64,
}

#[tauri::command]
pub async fn connection_create(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> ApiResult<String> {
    let (config, password) = input.into_config();
    let id = state
        .manager
        .create_connection(config, password.as_deref())
        .await?;
    Ok(id)
}

#[tauri::command]
pub async fn connection_list(state: State<'_, AppState>) -> ApiResult<Vec<ConnectionConfig>> {
    Ok(state.manager.list_connections().await?)
}

#[tauri::command]
pub async fn connection_test(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> ApiResult<TestResult> {
    let (config, password) = input.into_config();
    Ok(state.manager.test(&config, password.as_deref()).await?)
}

#[tauri::command]
pub async fn connection_connect(
    state: State<'_, AppState>,
    connection_id: String,
) -> ApiResult<String> {
    Ok(state.manager.connect_session(&connection_id).await?)
}

#[tauri::command]
pub async fn connection_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> ApiResult<()> {
    state.manager.disconnect_session(&session_id).await;
    Ok(())
}

async fn session_of(
    state: &State<'_, AppState>,
    session_id: &str,
) -> Result<Arc<Session>, ApiError> {
    state
        .manager
        .session(session_id)
        .await
        .ok_or_else(|| ApiError::from(PentaError::NotFound(format!("session {session_id}"))))
}

#[tauri::command]
pub async fn db_list(
    state: State<'_, AppState>,
    session_id: String,
) -> ApiResult<Vec<DatabaseInfo>> {
    let session = session_of(&state, &session_id).await?;
    Ok(introspection::list_databases(&session.client).await?)
}

#[tauri::command]
pub async fn schema_list(
    state: State<'_, AppState>,
    session_id: String,
) -> ApiResult<Vec<SchemaInfo>> {
    let session = session_of(&state, &session_id).await?;
    Ok(introspection::list_schemas(&session.client).await?)
}

/// Compact schema model (schemas + relations-with-columns + functions) that
/// powers the editor's schema-aware autocomplete. Fetched once per session and
/// cached client-side.
#[tauri::command]
pub async fn schema_completion(
    state: State<'_, AppState>,
    session_id: String,
) -> ApiResult<CompletionModel> {
    let session = session_of(&state, &session_id).await?;
    Ok(introspection::introspect_completion(&session.client).await?)
}

/// Columns of one relation (details panel / on-demand autocomplete).
#[tauri::command]
pub async fn relation_columns(
    state: State<'_, AppState>,
    session_id: String,
    schema: String,
    relation: String,
) -> ApiResult<Vec<ColumnBrief>> {
    let session = session_of(&state, &session_id).await?;
    Ok(introspection::list_columns(&session.client, &schema, &relation).await?)
}

// ---------------------------------------------------------------------------
// AI v1 (Decision #15/#16): NL→SQL, explain, error-fix — schema-only, never run.
// ---------------------------------------------------------------------------

/// Show exactly what would be sent to the AI provider for this input, without
/// making any network request (the pre-send privacy inspector).
#[tauri::command]
pub async fn ai_preview(
    state: State<'_, AppState>,
    session_id: String,
    input: AiInput,
) -> ApiResult<AiPayload> {
    let session = session_of(&state, &session_id).await?;
    let model = introspection::introspect_completion(&session.client).await?;
    let schema = ai::build_schema_context(&model);
    Ok(ai::build_payload(&input, &schema))
}

/// Run an AI request against the user's configured provider (BYO key or local
/// Ollama). Builds schema-only context from the live connection. Never executes
/// the generated SQL.
#[tauri::command]
pub async fn ai_run(
    state: State<'_, AppState>,
    session_id: String,
    settings: AiSettings,
    input: AiInput,
) -> ApiResult<AiResponse> {
    let session = session_of(&state, &session_id).await?;
    let model = introspection::introspect_completion(&session.client).await?;
    let schema = ai::build_schema_context(&model);
    Ok(ai::run(&settings, &input, &schema).await?)
}

#[tauri::command]
pub async fn relation_list(
    state: State<'_, AppState>,
    session_id: String,
    schema: String,
    kinds: Vec<String>,
) -> ApiResult<Vec<RelationInfo>> {
    let session = session_of(&state, &session_id).await?;
    let kind_refs: Vec<&str> = kinds.iter().map(String::as_str).collect();
    Ok(introspection::list_relations(&session.client, &schema, &kind_refs).await?)
}

/// Run the Production Safety Mode risk scan for some SQL on this session's
/// connection, without executing anything. The UI calls this to render the risk
/// badge and decide which confirmation dialog (if any) to show.
#[tauri::command]
pub async fn query_analyze(
    state: State<'_, AppState>,
    session_id: String,
    sql: String,
) -> ApiResult<RiskReport> {
    let session = session_of(&state, &session_id).await?;
    Ok(safety::analyze(&sql, session.env_label))
}

#[tauri::command]
pub async fn query_execute(
    state: State<'_, AppState>,
    session_id: String,
    sql: String,
    max_rows: Option<usize>,
    confirmed: Option<bool>,
) -> ApiResult<QueryResult> {
    let session = session_of(&state, &session_id).await?;

    // Server-side enforcement (defense in depth): even if the UI is bypassed,
    // a risky statement on a guarded connection cannot run without an explicit
    // acknowledgement that matches the analysis the UI was shown.
    let report = safety::analyze(&sql, session.env_label);
    if !report.allowed_without_ack() && !confirmed.unwrap_or(false) {
        return Err(ApiError {
            code: "risk_unconfirmed".to_string(),
            message: format!(
                "{} statement requires confirmation before running",
                match report.level {
                    safety::RiskLevel::High => "high-risk",
                    safety::RiskLevel::Medium => "medium-risk",
                    _ => "guarded",
                }
            ),
        });
    }

    let cap = max_rows.unwrap_or(5000);
    let start = std::time::Instant::now();

    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut truncated = false;
    let summary = query::execute_stream(&session.client, &sql, 1000, |batch| {
        for r in batch {
            if rows.len() < cap {
                rows.push(r);
            } else {
                truncated = true;
            }
        }
    })
    .await?;

    Ok(QueryResult {
        columns: summary.columns,
        rows,
        row_count: summary.row_count,
        truncated,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn query_cancel(state: State<'_, AppState>, session_id: String) -> ApiResult<()> {
    if let Some(session) = state.manager.session(&session_id).await {
        query::cancel(session.client.cancel_token()).await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Data IO (§22): COPY-based CSV export/import, streamed to/from disk.
// ---------------------------------------------------------------------------

/// Stream a whole table to a CSV file. Returns bytes written.
#[tauri::command]
pub async fn export_table_csv(
    state: State<'_, AppState>,
    session_id: String,
    schema: String,
    table: String,
    path: String,
) -> ApiResult<u64> {
    let session = session_of(&state, &session_id).await?;
    Ok(io::export_table_csv(&session.client, &schema, &table, &path).await?)
}

/// Stream the result of an arbitrary SELECT to a CSV file. Returns bytes written.
#[tauri::command]
pub async fn export_query_csv(
    state: State<'_, AppState>,
    session_id: String,
    sql: String,
    path: String,
) -> ApiResult<u64> {
    let session = session_of(&state, &session_id).await?;
    Ok(io::export_query_csv(&session.client, &sql, &path).await?)
}

/// Load a CSV file into a table via streamed COPY. Rejected on read-only sessions.
#[tauri::command]
pub async fn import_table_csv(
    state: State<'_, AppState>,
    session_id: String,
    schema: String,
    table: String,
    path: String,
    header: bool,
) -> ApiResult<ImportOutcome> {
    let session = session_of(&state, &session_id).await?;
    if session.read_only {
        return Err(ApiError::from(PentaError::Invalid(
            "connection is read-only; import is disabled".into(),
        )));
    }
    Ok(io::import_table_csv(&session.client, &schema, &table, &path, header).await?)
}

// ---------------------------------------------------------------------------
// Managed local PostgreSQL instances (Docker-free dev DBs).
// ---------------------------------------------------------------------------

fn penta_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let dir = std::path::Path::new(&home).join(".penta");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn clusters_dir() -> std::path::PathBuf {
    penta_dir().join("clusters")
}

fn registry_path() -> std::path::PathBuf {
    penta_dir().join("clusters.json")
}

/// UI-facing view of a managed instance (adds live status + the URL).
#[derive(Debug, Serialize)]
pub struct InstanceInfo {
    pub id: String,
    pub name: String,
    pub port: u16,
    pub database: String,
    pub superuser: String,
    pub pg_version: String,
    pub url: String,
    pub running: bool,
    pub connection_id: Option<String>,
}

fn to_info(inst: &ManagedInstance, running: bool) -> InstanceInfo {
    InstanceInfo {
        id: inst.id.clone(),
        name: inst.name.clone(),
        port: inst.port,
        database: inst.database.clone(),
        superuser: inst.superuser.clone(),
        pg_version: inst.pg_version.clone(),
        url: inst.url(),
        running,
        connection_id: inst.connection_id.clone(),
    }
}

fn bins() -> Result<instance::PgBins, ApiError> {
    instance::detect_bins().map_err(ApiError::from)
}

/// Provision + start a new local PostgreSQL instance and return its
/// `DATABASE_URL`. This is the Docker-free "new dev DB" flow.
#[tauri::command]
pub async fn instance_provision(name: String) -> ApiResult<InstanceInfo> {
    let bins = bins()?;
    let inst = instance::provision(
        &bins,
        &clusters_dir(),
        ProvisionOpts {
            name,
            database: None,
            superuser: None,
        },
    )
    .await?;

    let mut reg = instance::load_registry(&registry_path());
    reg.push(inst.clone());
    instance::save_registry(&registry_path(), &reg)?;
    Ok(to_info(&inst, true))
}

/// List all managed instances with their current running status.
#[tauri::command]
pub fn instance_list() -> ApiResult<Vec<InstanceInfo>> {
    let bins = bins()?;
    let reg = instance::load_registry(&registry_path());
    Ok(reg
        .iter()
        .map(|i| {
            let running = instance::is_running(&bins, i);
            to_info(i, running)
        })
        .collect())
}

fn find_instance(id: &str) -> Result<(Vec<ManagedInstance>, usize), ApiError> {
    let reg = instance::load_registry(&registry_path());
    let idx = reg
        .iter()
        .position(|i| i.id == id)
        .ok_or_else(|| ApiError::from(PentaError::NotFound(format!("instance {id}"))))?;
    Ok((reg, idx))
}

#[tauri::command]
pub async fn instance_start(id: String) -> ApiResult<InstanceInfo> {
    let bins = bins()?;
    let (reg, idx) = find_instance(&id)?;
    instance::start(&bins, &reg[idx]).await?;
    Ok(to_info(&reg[idx], true))
}

#[tauri::command]
pub async fn instance_stop(id: String) -> ApiResult<InstanceInfo> {
    let bins = bins()?;
    let (reg, idx) = find_instance(&id)?;
    instance::stop(&bins, &reg[idx]).await?;
    Ok(to_info(&reg[idx], false))
}

/// Open a managed instance inside Penta: ensure a connection exists for it
/// (creating one on first open), then connect a session and return it.
#[tauri::command]
pub async fn instance_open(state: State<'_, AppState>, id: String) -> ApiResult<ActiveSessionDto> {
    let bins = bins()?;
    let (mut reg, idx) = find_instance(&id)?;
    instance::start(&bins, &reg[idx]).await?;

    // Reuse the linked connection if it still exists, else create one.
    let existing = match &reg[idx].connection_id {
        Some(cid) => state
            .manager
            .list_connections()
            .await?
            .into_iter()
            .find(|c| &c.id == cid),
        None => None,
    };

    let inst = &reg[idx];
    let conn = match existing {
        Some(c) => c,
        None => {
            let config = ConnectionConfig {
                id: String::new(),
                name: inst.name.clone(),
                host: "127.0.0.1".into(),
                port: inst.port,
                database: inst.database.clone(),
                username: inst.superuser.clone(),
                ssl_mode: SslMode::Disable,
                env_label: EnvLabel::Local,
                read_only: false,
            };
            let new_id = state
                .manager
                .create_connection(config.clone(), Some(&inst.password))
                .await?;
            reg[idx].connection_id = Some(new_id.clone());
            instance::save_registry(&registry_path(), &reg)?;
            ConnectionConfig {
                id: new_id,
                ..config
            }
        }
    };

    let session_id = state.manager.connect_session(&conn.id).await?;
    Ok(ActiveSessionDto {
        session_id,
        connection_id: conn.id,
        name: conn.name,
        env_label: conn.env_label,
        read_only: conn.read_only,
    })
}

/// Stop and permanently delete a managed instance (and its linked connection).
#[tauri::command]
pub async fn instance_remove(state: State<'_, AppState>, id: String) -> ApiResult<()> {
    let bins = bins()?;
    let (mut reg, idx) = find_instance(&id)?;
    instance::remove(&bins, &reg[idx]).await?;
    if let Some(cid) = reg[idx].connection_id.clone() {
        let _ = state.manager.delete_connection(&cid).await;
    }
    reg.remove(idx);
    instance::save_registry(&registry_path(), &reg)?;
    Ok(())
}

/// Enough for the UI to activate a session (mirrors the frontend store shape).
#[derive(Debug, Serialize)]
pub struct ActiveSessionDto {
    pub session_id: String,
    pub connection_id: String,
    pub name: String,
    pub env_label: EnvLabel,
    pub read_only: bool,
}

// ---------------------------------------------------------------------------
// Data editing (Decision #1/#9): table data view + safe edits.
// ---------------------------------------------------------------------------

/// A page of table data plus the identity info the editable grid needs. When the
/// relation is editable, `row_xmins[i]` carries row `i`'s captured `xmin` for
/// optimistic concurrency; for read-only relations it is empty.
#[derive(Debug, Serialize)]
pub struct TableData {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<Option<String>>>,
    pub row_xmins: Vec<Option<String>>,
    pub editable: bool,
    pub key_columns: Vec<String>,
    pub readonly_reason: Option<String>,
    pub truncated: bool,
}

#[tauri::command]
pub async fn table_data(
    state: State<'_, AppState>,
    session_id: String,
    schema: String,
    table: String,
    limit: Option<usize>,
    offset: Option<usize>,
    after: Option<Vec<String>>,
) -> ApiResult<TableData> {
    let session = session_of(&state, &session_id).await?;
    let identity = grid::resolve_identity(&session.client, &schema, &table).await?;
    let lim = limit.unwrap_or(200).clamp(1, 2000);

    // Decision #7: prefer keyset pagination (cursor on the key) for "load more";
    // fall back to LIMIT/OFFSET only when an explicit offset jump is requested.
    let sql = match (after, offset) {
        (Some(cursor), _) => {
            grid::build_keyset_page_sql(&identity, &cursor, lim, identity.editable)
        }
        (None, off) => {
            let off = off.unwrap_or(0);
            let qual = format!(
                "{}.{}",
                grid::quote_ident(&schema),
                grid::quote_ident(&table)
            );
            let order = if !identity.key_columns.is_empty() {
                let cols = identity
                    .key_columns
                    .iter()
                    .map(|c| grid::quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(" ORDER BY {cols}")
            } else {
                String::new()
            };
            if identity.editable {
                format!("SELECT t.xmin::text AS __penta_xmin, t.* FROM {qual} AS t{order} LIMIT {lim} OFFSET {off}")
            } else {
                format!("SELECT t.* FROM {qual} AS t{order} LIMIT {lim} OFFSET {off}")
            }
        }
    };

    let mut all_rows: Vec<Vec<Option<String>>> = Vec::new();
    let summary = query::execute_stream(&session.client, &sql, 1000, |batch| {
        for r in batch {
            all_rows.push(r);
        }
    })
    .await?;

    let (columns, rows, row_xmins) = if identity.editable {
        // Strip the leading synthetic __penta_xmin column off the metadata + rows.
        let mut cols = summary.columns;
        if !cols.is_empty() {
            cols.remove(0);
        }
        let mut xmins = Vec::with_capacity(all_rows.len());
        let mut data = Vec::with_capacity(all_rows.len());
        for mut r in all_rows {
            let x = if r.is_empty() { None } else { r.remove(0) };
            xmins.push(x);
            data.push(r);
        }
        (cols, data, xmins)
    } else {
        (summary.columns, all_rows, Vec::new())
    };

    Ok(TableData {
        truncated: rows.len() >= lim,
        columns,
        rows,
        row_xmins,
        editable: identity.editable,
        key_columns: identity.key_columns,
        readonly_reason: identity.readonly_reason,
    })
}

/// Preview the parameterized SQL for a batch of edits (never mutates).
#[tauri::command]
pub async fn grid_build_edit_sql(
    state: State<'_, AppState>,
    session_id: String,
    edits: Vec<RowEdit>,
) -> ApiResult<Vec<Statement>> {
    let session = session_of(&state, &session_id).await?;
    Ok(grid::build_statements(&session.client, &edits).await?)
}

/// Apply a batch of edits atomically. Refuses on read-only sessions and requires
/// explicit confirmation (the UI shows the SQL preview first).
#[tauri::command]
pub async fn grid_apply_edits(
    state: State<'_, AppState>,
    session_id: String,
    edits: Vec<RowEdit>,
    confirm: bool,
) -> ApiResult<ApplyOutcome> {
    let session = session_of(&state, &session_id).await?;
    if session.read_only {
        return Err(ApiError::from(PentaError::Invalid(
            "connection is read-only; edits are disabled".into(),
        )));
    }
    if !confirm {
        return Err(ApiError::from(PentaError::Invalid(
            "edits not confirmed; preview and confirm before applying".into(),
        )));
    }
    Ok(grid::apply_edits(&session.client, &edits).await?)
}
