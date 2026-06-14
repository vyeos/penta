//! Connection manager: connection CRUD (persisted in the app DB), vault-backed
//! secrets, and the session-per-tab model (Decision #3). Each session owns a
//! sticky `tokio-postgres` connection so transactions/temp-tables/SET persist
//! and cancellation maps to its backend.

use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::Mutex;
use uuid::Uuid;

use penta_vault::{SecretKind, SecretStore};

use crate::connection::{ConnectionConfig, EnvLabel};
use crate::error::{PentaError, Result};
use crate::pg;
use crate::store::{self, AppDb};

#[derive(Debug, Clone, Serialize)]
pub struct TestResult {
    pub server_version: String,
    pub ssl: bool,
}

/// A live per-tab session bound to one backend connection.
pub struct Session {
    pub connection_id: String,
    pub read_only: bool,
    /// Drives Production Safety Mode tiering on the server side (Decision #10).
    pub env_label: EnvLabel,
    pub client: Arc<tokio_postgres::Client>,
}

pub struct ConnectionManager<S: SecretStore> {
    db: AppDb,
    secrets: S,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}

impl<S: SecretStore> ConnectionManager<S> {
    pub fn new(db: AppDb, secrets: S) -> Self {
        Self {
            db,
            secrets,
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn db(&self) -> &AppDb {
        &self.db
    }

    /// Persist a connection definition and store its password in the vault.
    pub async fn create_connection(
        &self,
        mut config: ConnectionConfig,
        password: Option<&str>,
    ) -> Result<String> {
        if config.id.is_empty() {
            config.id = Uuid::new_v4().to_string();
        }
        store::insert_connection(&self.db, &config).await?;
        if let Some(pw) = password {
            if !pw.is_empty() {
                self.secrets
                    .store(&config.id, SecretKind::Password, pw)
                    .map_err(|e| PentaError::Internal(format!("vault: {e}")))?;
            }
        }
        Ok(config.id)
    }

    pub async fn list_connections(&self) -> Result<Vec<ConnectionConfig>> {
        store::list_connections(&self.db).await
    }

    /// Delete a connection: drop any live sessions on it, remove its vault
    /// secret (best-effort), and delete the stored definition.
    pub async fn delete_connection(&self, connection_id: &str) -> Result<()> {
        self.sessions
            .lock()
            .await
            .retain(|_, s| s.connection_id != connection_id);
        let _ = self.secrets.delete(connection_id, SecretKind::Password);
        store::delete_connection(&self.db, connection_id).await
    }

    /// Probe a connection without persisting a session: connect + read version.
    pub async fn test(
        &self,
        config: &ConnectionConfig,
        password: Option<&str>,
    ) -> Result<TestResult> {
        let cfg = pg::build_pg_config(config, password);
        let client = pg::connect_config(&cfg).await?;
        let row = client
            .query_one("SELECT version()", &[])
            .await
            .map_err(|e| PentaError::Connection(e.to_string()))?;
        Ok(TestResult {
            server_version: row.get(0),
            ssl: false,
        })
    }

    /// Open a sticky session for a tab. Enforces read-only at the session level
    /// (Decision #3) by setting `default_transaction_read_only`.
    pub async fn connect_session(&self, connection_id: &str) -> Result<String> {
        let config = store::get_connection(&self.db, connection_id)
            .await?
            .ok_or_else(|| PentaError::NotFound(format!("connection {connection_id}")))?;
        let password = self
            .secrets
            .get(connection_id, SecretKind::Password)
            .map_err(|e| PentaError::Internal(format!("vault: {e}")))?;

        let cfg = pg::build_pg_config(&config, password.as_deref());
        let client = pg::connect_config(&cfg).await?;
        if config.read_only {
            client
                .batch_execute("SET default_transaction_read_only = on")
                .await
                .map_err(|e| PentaError::Connection(e.to_string()))?;
        }

        let session_id = Uuid::new_v4().to_string();
        let session = Arc::new(Session {
            connection_id: connection_id.to_string(),
            read_only: config.read_only,
            env_label: config.env_label,
            client: Arc::new(client),
        });
        self.sessions
            .lock()
            .await
            .insert(session_id.clone(), session);
        Ok(session_id)
    }

    /// Fetch a live session by id (clone of the Arc), for query execution.
    pub async fn session(&self, session_id: &str) -> Option<Arc<Session>> {
        self.sessions.lock().await.get(session_id).cloned()
    }

    pub async fn disconnect_session(&self, session_id: &str) {
        self.sessions.lock().await.remove(session_id);
    }
}
