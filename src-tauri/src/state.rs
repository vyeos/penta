//! Shared application state held by Tauri and injected into commands.

use std::sync::Arc;

use penta_core::manager::ConnectionManager;
use penta_vault::KeychainStore;

/// Global app state. The connection manager owns the app DB + live sessions.
/// Default secret backend is the OS keychain (Decision #6); master-password
/// mode selection is layered on later.
pub struct AppState {
    pub manager: Arc<ConnectionManager<KeychainStore>>,
}
