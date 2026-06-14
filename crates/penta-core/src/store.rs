//! App-state store (SQLite via sqlx, Decision #5). Holds connection
//! definitions, history, cache, settings. Secrets are never stored here — see
//! `penta-vault`.

use std::str::FromStr;

use chrono::Utc;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::Row;

use crate::connection::{ConnectionConfig, EnvLabel, SslMode};
use crate::error::{PentaError, Result};

pub type AppDb = SqlitePool;

fn db_err<E: std::fmt::Display>(e: E) -> PentaError {
    PentaError::Internal(e.to_string())
}

/// Open (creating if needed) the SQLite app database at `url`
/// (e.g. `sqlite:///abs/path/penta.db` or `sqlite::memory:`) and run migrations.
pub async fn open_app_db(url: &str) -> Result<AppDb> {
    let opts = SqliteConnectOptions::from_str(url)
        .map_err(db_err)?
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
        .map_err(db_err)?;
    sqlx::migrate!("../../migrations")
        .run(&pool)
        .await
        .map_err(db_err)?;
    Ok(pool)
}

fn ssl_to_str(s: SslMode) -> &'static str {
    match s {
        SslMode::Disable => "disable",
        SslMode::Allow => "allow",
        SslMode::Prefer => "prefer",
        SslMode::Require => "require",
        SslMode::VerifyCa => "verify-ca",
        SslMode::VerifyFull => "verify-full",
    }
}

fn ssl_from_str(s: &str) -> SslMode {
    match s {
        "disable" => SslMode::Disable,
        "allow" => SslMode::Allow,
        "require" => SslMode::Require,
        "verify-ca" => SslMode::VerifyCa,
        "verify-full" => SslMode::VerifyFull,
        _ => SslMode::Prefer,
    }
}

fn env_to_str(e: EnvLabel) -> &'static str {
    match e {
        EnvLabel::Local => "local",
        EnvLabel::Staging => "staging",
        EnvLabel::Production => "production",
    }
}

fn env_from_str(s: &str) -> EnvLabel {
    match s {
        "staging" => EnvLabel::Staging,
        "production" => EnvLabel::Production,
        _ => EnvLabel::Local,
    }
}

fn row_to_config(r: &SqliteRow) -> ConnectionConfig {
    ConnectionConfig {
        id: r.get("id"),
        name: r.get("name"),
        host: r.get("host"),
        port: r.get::<i64, _>("port") as u16,
        database: r.get("database"),
        username: r.get("username"),
        ssl_mode: ssl_from_str(r.get::<String, _>("ssl_mode").as_str()),
        env_label: env_from_str(r.get::<String, _>("env_label").as_str()),
        read_only: r.get::<i64, _>("read_only") != 0,
    }
}

pub async fn insert_connection(db: &AppDb, c: &ConnectionConfig) -> Result<()> {
    let now = Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT INTO server_connections
           (id, name, host, port, database, username, ssl_mode, env_label,
            read_only, favorite, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&c.id)
    .bind(&c.name)
    .bind(&c.host)
    .bind(c.port as i64)
    .bind(&c.database)
    .bind(&c.username)
    .bind(ssl_to_str(c.ssl_mode))
    .bind(env_to_str(c.env_label))
    .bind(c.read_only as i64)
    .bind(0_i64)
    .bind(now)
    .bind(now)
    .execute(db)
    .await
    .map_err(db_err)?;
    Ok(())
}

pub async fn list_connections(db: &AppDb) -> Result<Vec<ConnectionConfig>> {
    let rows = sqlx::query("SELECT * FROM server_connections ORDER BY name")
        .fetch_all(db)
        .await
        .map_err(db_err)?;
    Ok(rows.iter().map(row_to_config).collect())
}

pub async fn get_connection(db: &AppDb, id: &str) -> Result<Option<ConnectionConfig>> {
    let row = sqlx::query("SELECT * FROM server_connections WHERE id = ?")
        .bind(id)
        .fetch_optional(db)
        .await
        .map_err(db_err)?;
    Ok(row.as_ref().map(row_to_config))
}

pub async fn delete_connection(db: &AppDb, id: &str) -> Result<()> {
    sqlx::query("DELETE FROM server_connections WHERE id = ?")
        .bind(id)
        .execute(db)
        .await
        .map_err(db_err)?;
    Ok(())
}
