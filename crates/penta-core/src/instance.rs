//! Managed local PostgreSQL instances — a Docker-free dev-DB manager.
//!
//! Penta can `initdb` a fresh cluster, start it on a free port bound to
//! `127.0.0.1`, create a project database, and hand back a `DATABASE_URL` to
//! paste into a project's `.env`. Clusters live under `~/.penta/clusters/<id>/`
//! and persist across app/OS restarts; lifecycle is start/stop/remove.
//!
//! We drive the official `initdb`/`pg_ctl` binaries (located at absolute paths
//! so it works even when the GUI app launches with a bare `PATH`). On macOS,
//! PostgreSQL 18's postmaster aborts with "became multithreaded" unless the
//! locale is C — so we `initdb --locale=C` and run every child with `LC_ALL=C`.

use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;

use serde::{Deserialize, Serialize};
use tokio::process::Command;
use uuid::Uuid;

use crate::error::{PentaError, Result};
use crate::grid::{quote_ident, quote_literal};
use crate::pg;

/// Located PostgreSQL server binaries.
#[derive(Debug, Clone, Serialize)]
pub struct PgBins {
    pub initdb: PathBuf,
    pub pg_ctl: PathBuf,
    pub bindir: PathBuf,
    pub version: String,
}

/// A Penta-managed local cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedInstance {
    pub id: String,
    pub name: String,
    pub data_dir: PathBuf,
    pub port: u16,
    pub superuser: String,
    pub database: String,
    /// Password set on the superuser. The cluster also accepts trust auth on
    /// localhost, so this is for a conventional URL more than a secret.
    pub password: String,
    pub pg_version: String,
    /// The linked Penta connection (set when the user opens it in Penta), so it
    /// can be cleaned up on remove.
    #[serde(default)]
    pub connection_id: Option<String>,
}

impl ManagedInstance {
    /// The `DATABASE_URL` to paste into a project's environment.
    pub fn url(&self) -> String {
        format!(
            "postgres://{}:{}@127.0.0.1:{}/{}",
            self.superuser, self.password, self.port, self.database
        )
    }
}

/// Options for provisioning a new instance.
#[derive(Debug, Clone, Deserialize)]
pub struct ProvisionOpts {
    pub name: String,
    /// Defaults to a sanitized form of `name`.
    #[serde(default)]
    pub database: Option<String>,
    /// Defaults to `postgres`.
    #[serde(default)]
    pub superuser: Option<String>,
}

fn err_io(ctx: &str, e: impl std::fmt::Display) -> PentaError {
    PentaError::Internal(format!("{ctx}: {e}"))
}

/// Locate the newest available `initdb`/`pg_ctl` pair. Searches `PENTA_PG_BINDIR`,
/// `pg_config`, Homebrew/Postgres.app/Linux locations — all by absolute path.
pub fn detect_bins() -> Result<PgBins> {
    let mut best: Option<(u32, u32, PgBins)> = None;
    for bindir in candidate_bindirs() {
        let initdb = bindir.join("initdb");
        let pg_ctl = bindir.join("pg_ctl");
        if !initdb.is_file() || !pg_ctl.is_file() {
            continue;
        }
        let Ok(out) = StdCommand::new(&initdb).arg("--version").output() else {
            continue;
        };
        if !out.status.success() {
            continue;
        }
        let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let (maj, min) = parse_version(&version);
        let candidate = PgBins {
            initdb,
            pg_ctl,
            bindir: bindir.clone(),
            version,
        };
        if best
            .as_ref()
            .is_none_or(|(bm, bn, _)| (maj, min) > (*bm, *bn))
        {
            best = Some((maj, min, candidate));
        }
    }
    best.map(|(_, _, b)| b).ok_or_else(|| {
        PentaError::NotFound(
            "PostgreSQL server binaries (initdb/pg_ctl) not found. Install PostgreSQL \
             (e.g. `brew install postgresql@18`) or set PENTA_PG_BINDIR."
                .into(),
        )
    })
}

fn candidate_bindirs() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
    if let Ok(d) = std::env::var("PENTA_PG_BINDIR") {
        if !d.is_empty() {
            v.push(d.into());
        }
    }
    if let Ok(out) = StdCommand::new("pg_config").arg("--bindir").output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                v.push(s.into());
            }
        }
    }
    // Homebrew keg-only postgres formulae (postgresql@18, postgresql@17, …).
    for base in ["/opt/homebrew/opt", "/usr/local/opt"] {
        if let Ok(rd) = std::fs::read_dir(base) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with("postgresql") {
                    v.push(e.path().join("bin"));
                }
            }
        }
    }
    for p in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        v.push(p.into());
    }
    for base in [
        "/Applications/Postgres.app/Contents/Versions",
        "/usr/lib/postgresql",
    ] {
        if let Ok(rd) = std::fs::read_dir(base) {
            for e in rd.flatten() {
                v.push(e.path().join("bin"));
            }
        }
    }
    v
}

fn parse_version(s: &str) -> (u32, u32) {
    // e.g. "initdb (PostgreSQL) 18.4"
    let digits: String = s
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let mut parts = digits.split('.');
    let maj = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    let min = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    (maj, min)
}

/// Find a free TCP port on the loopback interface.
pub fn free_port() -> Result<u16> {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| err_io("reserve port", e))?;
    listener
        .local_addr()
        .map(|a| a.port())
        .map_err(|e| err_io("reserve port", e))
}

/// Sanitize a name into a valid unquoted SQL identifier (db/role name).
fn sanitize_ident(name: &str) -> String {
    let mut s: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    while s.contains("__") {
        s = s.replace("__", "_");
    }
    let s = s.trim_matches('_').to_string();
    let s = if s.is_empty() { "app".to_string() } else { s };
    if s.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        format!("db_{s}")
    } else {
        s
    }
}

async fn run(cmd: &mut Command, ctx: &str) -> Result<()> {
    let out = cmd.output().await.map_err(|e| err_io(ctx, e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(PentaError::Internal(format!(
            "{ctx} failed: {}",
            stderr.trim()
        )));
    }
    Ok(())
}

/// Provision (initdb + start + create database) a new managed instance under
/// `clusters_dir`. Idempotent only at the granularity of a fresh id.
pub async fn provision(
    bins: &PgBins,
    clusters_dir: &Path,
    opts: ProvisionOpts,
) -> Result<ManagedInstance> {
    let id = Uuid::new_v4().to_string();
    let superuser = sanitize_ident(opts.superuser.as_deref().unwrap_or("postgres"));
    let database = sanitize_ident(opts.database.as_deref().unwrap_or(&opts.name));
    let password = Uuid::new_v4().simple().to_string();
    let port = free_port()?;
    let data_dir = clusters_dir.join(&id);

    std::fs::create_dir_all(clusters_dir).map_err(|e| err_io("create clusters dir", e))?;

    // initdb — trust auth on localhost, C locale (required for PG18 on macOS).
    run(
        Command::new(&bins.initdb)
            .env("LC_ALL", "C")
            .env("LANG", "C")
            .arg("-D")
            .arg(&data_dir)
            .arg("-U")
            .arg(&superuser)
            .arg("--auth=trust")
            .arg("--encoding=UTF8")
            .arg("--locale=C"),
        "initdb",
    )
    .await?;

    // Pin port + loopback into the config. The Unix socket goes in a SHORT,
    // stable dir — the data dir can be deep (e.g. macOS `$TMPDIR`) and a socket
    // path over ~104 bytes silently fails to bind. We connect over TCP anyway;
    // the socket only serves pg_ctl's readiness probe, and the per-cluster port
    // keeps the socket name (`.s.PGSQL.<port>`) unique.
    let socket_dir = if cfg!(windows) {
        String::new()
    } else {
        "/tmp".to_string()
    };
    let conf = format!(
        "\n# --- managed by Penta ---\nlisten_addresses = '127.0.0.1'\nport = {port}\nunix_socket_directories = '{socket_dir}'\n",
    );
    let conf_path = data_dir.join("postgresql.conf");
    let existing =
        std::fs::read_to_string(&conf_path).map_err(|e| err_io("read postgresql.conf", e))?;
    std::fs::write(&conf_path, existing + &conf).map_err(|e| err_io("write postgresql.conf", e))?;

    let instance = ManagedInstance {
        id,
        name: opts.name,
        data_dir,
        port,
        superuser,
        database,
        password,
        pg_version: bins.version.clone(),
        connection_id: None,
    };

    start(bins, &instance).await?;
    create_database(&instance).await?;
    Ok(instance)
}

/// Start a stopped instance (config already pins the port). No-op if running.
pub async fn start(bins: &PgBins, inst: &ManagedInstance) -> Result<()> {
    if is_running(bins, inst) {
        return Ok(());
    }
    run(
        Command::new(&bins.pg_ctl)
            .env("LC_ALL", "C")
            .env("LANG", "C")
            .arg("-D")
            .arg(&inst.data_dir)
            .arg("-l")
            .arg(inst.data_dir.join("server.log"))
            .arg("-w")
            .arg("start"),
        "pg_ctl start",
    )
    .await
}

/// Stop a running instance (fast shutdown). No-op if already stopped.
pub async fn stop(bins: &PgBins, inst: &ManagedInstance) -> Result<()> {
    if !is_running(bins, inst) {
        return Ok(());
    }
    run(
        Command::new(&bins.pg_ctl)
            .env("LC_ALL", "C")
            .env("LANG", "C")
            .arg("-D")
            .arg(&inst.data_dir)
            .arg("-m")
            .arg("fast")
            .arg("-w")
            .arg("stop"),
        "pg_ctl stop",
    )
    .await
}

/// Whether the postmaster for this instance is currently running.
pub fn is_running(bins: &PgBins, inst: &ManagedInstance) -> bool {
    StdCommand::new(&bins.pg_ctl)
        .env("LC_ALL", "C")
        .arg("-D")
        .arg(&inst.data_dir)
        .arg("status")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Stop (if running) and permanently delete an instance's data directory.
pub async fn remove(bins: &PgBins, inst: &ManagedInstance) -> Result<()> {
    let _ = stop(bins, inst).await;
    if inst.data_dir.exists() {
        std::fs::remove_dir_all(&inst.data_dir).map_err(|e| err_io("remove data dir", e))?;
    }
    Ok(())
}

/// Create the project database (if absent) and set the superuser password.
async fn create_database(inst: &ManagedInstance) -> Result<()> {
    // Connect to the bootstrap `postgres` db via trust on loopback.
    let admin_url = format!(
        "postgres://{}@127.0.0.1:{}/postgres",
        inst.superuser, inst.port
    );
    let client = pg::connect(&admin_url).await?;

    client
        .batch_execute(&format!(
            "ALTER ROLE {} WITH PASSWORD {}",
            quote_ident(&inst.superuser),
            quote_literal(&inst.password)
        ))
        .await
        .map_err(|e| PentaError::Internal(format!("set password: {e}")))?;

    let exists = client
        .query_opt(
            "SELECT 1 FROM pg_database WHERE datname = $1",
            &[&inst.database],
        )
        .await
        .map_err(|e| PentaError::Internal(format!("check db: {e}")))?
        .is_some();
    if !exists {
        client
            .batch_execute(&format!("CREATE DATABASE {}", quote_ident(&inst.database)))
            .await
            .map_err(|e| PentaError::Internal(format!("create db: {e}")))?;
    }
    Ok(())
}

// --- Registry: a JSON list of managed instances on disk. -------------------

/// Load the managed-instance registry (empty if missing/corrupt).
pub fn load_registry(path: &Path) -> Vec<ManagedInstance> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Persist the managed-instance registry.
pub fn save_registry(path: &Path, items: &[ManagedInstance]) -> Result<()> {
    let json = serde_json::to_string_pretty(items)
        .map_err(|e| PentaError::Internal(format!("serialize registry: {e}")))?;
    std::fs::write(path, json).map_err(|e| err_io("write registry", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_names_into_identifiers() {
        assert_eq!(sanitize_ident("My App!"), "my_app");
        assert_eq!(sanitize_ident("  weird--name  "), "weird_name");
        assert_eq!(sanitize_ident("123db"), "db_123db");
        assert_eq!(sanitize_ident(""), "app");
    }

    #[test]
    fn parses_initdb_version() {
        assert_eq!(parse_version("initdb (PostgreSQL) 18.4"), (18, 4));
        assert_eq!(
            parse_version("initdb (PostgreSQL) 16.9 (Homebrew)"),
            (16, 9)
        );
    }

    #[test]
    fn url_is_conventional() {
        let inst = ManagedInstance {
            id: "x".into(),
            name: "n".into(),
            data_dir: "/tmp/x".into(),
            port: 5599,
            superuser: "postgres".into(),
            database: "app".into(),
            password: "secret".into(),
            pg_version: "18.4".into(),
            connection_id: None,
        };
        assert_eq!(inst.url(), "postgres://postgres:secret@127.0.0.1:5599/app");
    }

    #[test]
    fn free_port_is_nonzero() {
        assert!(free_port().unwrap() > 0);
    }
}
