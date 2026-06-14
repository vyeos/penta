//! Penta desktop shell (Tauri v2). Thin IPC layer over penta-core / penta-vault.

mod commands;
mod license;
mod state;

use std::sync::Arc;

use serde::Serialize;

use penta_core::manager::ConnectionManager;
use penta_vault::KeychainStore;

use crate::state::AppState;

/// Returned by `app_info` so the UI can display versions in diagnostics.
#[derive(Serialize)]
struct AppInfo {
    app_version: &'static str,
    core_version: &'static str,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        app_version: env!("CARGO_PKG_VERSION"),
        core_version: penta_core::version(),
    }
}

/// Resolve the app database URL under the user's home (`~/.penta/penta.db`).
fn app_db_url() -> String {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let dir = std::path::Path::new(&home).join(".penta");
    let _ = std::fs::create_dir_all(&dir);
    let db_path = dir.join("penta.db");
    format!("sqlite://{}", db_path.display())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let url = app_db_url();
    let db = tauri::async_runtime::block_on(penta_core::store::open_app_db(&url))
        .expect("failed to open app database");
    let manager = Arc::new(ConnectionManager::new(db, KeychainStore));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { manager })
        .invoke_handler(tauri::generate_handler![
            app_info,
            commands::connection_create,
            commands::connection_list,
            commands::connection_test,
            commands::connection_connect,
            commands::connection_disconnect,
            commands::db_list,
            commands::schema_list,
            commands::relation_list,
            commands::schema_completion,
            commands::relation_columns,
            commands::query_analyze,
            commands::query_execute,
            commands::query_cancel,
            commands::export_table_csv,
            commands::export_query_csv,
            commands::import_table_csv,
            commands::table_data,
            commands::grid_build_edit_sql,
            commands::grid_apply_edits,
            commands::ai_preview,
            commands::ai_run,
            commands::instance_provision,
            commands::instance_list,
            commands::instance_start,
            commands::instance_stop,
            commands::instance_open,
            commands::instance_remove,
            license::license_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Penta");
}
