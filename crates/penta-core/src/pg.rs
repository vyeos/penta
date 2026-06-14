//! Low-level PostgreSQL connection helpers built on `tokio-postgres`.
//!
//! This is the foundation the session-per-tab model and the shared metadata
//! pool are built on. TLS (rustls) and SSH tunneling are layered in by the
//! connection-management work unit; this PoC uses `NoTls`.

use tokio_postgres::{Client, NoTls};

use crate::connection::ConnectionConfig;
use crate::error::{PentaError, Result};

/// Build a `tokio_postgres::Config` from a connection definition + optional
/// password. Using the builder (not a connection string) avoids any value-
/// escaping pitfalls. TLS/SSH are layered on by later work units; this is NoTls.
pub fn build_pg_config(c: &ConnectionConfig, password: Option<&str>) -> tokio_postgres::Config {
    let mut cfg = tokio_postgres::Config::new();
    cfg.host(&c.host);
    cfg.port(c.port);
    cfg.user(&c.username);
    cfg.dbname(&c.database);
    if let Some(pw) = password {
        if !pw.is_empty() {
            cfg.password(pw);
        }
    }
    cfg
}

/// Connect using a prepared `Config`, driving the connection future in the
/// background (as in [`connect`]).
pub async fn connect_config(cfg: &tokio_postgres::Config) -> Result<Client> {
    let (client, connection) = cfg
        .connect(NoTls)
        .await
        .map_err(|e| PentaError::Connection(e.to_string()))?;
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("postgres connection error: {e}");
        }
    });
    Ok(client)
}

/// Connect using a libpq-style connection string or URL
/// (e.g. `postgres://user@host:5432/dbname`).
///
/// The driver splits into a `Client` (used for queries) and a `Connection`
/// future that performs the actual I/O; we drive the latter on a background
/// task that completes when the client is dropped.
pub async fn connect(conn_str: &str) -> Result<Client> {
    let (client, connection) = tokio_postgres::connect(conn_str, NoTls)
        .await
        .map_err(|e| PentaError::Connection(e.to_string()))?;

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            // Surfaced via logs for now; the connection manager will track health.
            eprintln!("postgres connection error: {e}");
        }
    });

    Ok(client)
}
