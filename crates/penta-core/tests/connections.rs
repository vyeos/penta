//! Connection-management integration test: app DB CRUD + live connect against
//! PostgreSQL, plus read-only session enforcement and the metadata pool.
//! Uses a temp SQLite file; gated on `PENTA_TEST_PG_URL`.

use penta_core::connection::{ConnectionConfig, EnvLabel, SslMode};
use penta_core::manager::ConnectionManager;
use penta_core::{pg, pool, store};
use penta_vault::MemoryStore;

fn live() -> bool {
    std::env::var("PENTA_TEST_PG_URL").is_ok()
}

/// Parse `PENTA_TEST_PG_URL` (`postgres://user[:pass]@host:port/db`) into the
/// pieces the manager needs, so the test adapts to whatever DB the env points at
/// (local dev box, CI service, …) rather than hard-coding a host/port.
fn env_parts() -> (String, u16, String, String, String) {
    let url = std::env::var("PENTA_TEST_PG_URL").unwrap_or_default();
    let rest = url
        .strip_prefix("postgres://")
        .or_else(|| url.strip_prefix("postgresql://"))
        .unwrap_or(&url);
    let (auth_host, db_raw) = rest.split_once('/').unwrap_or((rest, "postgres"));
    let db = db_raw.split(['?', '&']).next().unwrap_or("postgres");
    let (userinfo, hostport) = auth_host
        .rsplit_once('@')
        .unwrap_or(("postgres", auth_host));
    let (user, pass) = userinfo.split_once(':').unwrap_or((userinfo, ""));
    let (host, port) = hostport.rsplit_once(':').unwrap_or((hostport, "5432"));
    (
        if host.is_empty() {
            "127.0.0.1".into()
        } else {
            host.into()
        },
        port.parse().unwrap_or(5432),
        if db.is_empty() {
            "postgres".into()
        } else {
            db.into()
        },
        if user.is_empty() {
            "postgres".into()
        } else {
            user.into()
        },
        pass.into(),
    )
}

fn pg_password() -> String {
    env_parts().4
}

fn local_config(read_only: bool) -> ConnectionConfig {
    let (host, port, database, username, _) = env_parts();
    ConnectionConfig {
        id: String::new(),
        name: "local-dev".into(),
        host,
        port,
        database,
        username,
        ssl_mode: SslMode::Disable,
        env_label: EnvLabel::Local,
        read_only,
    }
}

async fn temp_db() -> penta_core::store::AppDb {
    let path = std::env::temp_dir().join(format!("penta-{}.db", uuid::Uuid::new_v4()));
    store::open_app_db(&format!("sqlite://{}", path.display()))
        .await
        .expect("open app db")
}

#[tokio::test]
async fn create_list_and_connect() {
    if !live() {
        eprintln!("PENTA_TEST_PG_URL not set; skipping connection test");
        return;
    }
    let db = temp_db().await;
    let mgr = ConnectionManager::new(db, MemoryStore::new());

    let id = mgr
        .create_connection(local_config(false), Some(&pg_password()))
        .await
        .expect("create");
    let list = mgr.list_connections().await.expect("list");
    assert!(list.iter().any(|c| c.id == id), "created connection listed");

    let tr = mgr
        .test(&local_config(false), Some(&pg_password()))
        .await
        .expect("test");
    assert!(
        tr.server_version.contains("PostgreSQL"),
        "version: {}",
        tr.server_version
    );

    // Open a session and run a trivial query through it.
    let sid = mgr.connect_session(&id).await.expect("connect session");
    let session = mgr.session(&sid).await.expect("session present");
    let row = session
        .client
        .query_one("SELECT 1::int AS one", &[])
        .await
        .expect("query");
    let one: i32 = row.get("one");
    assert_eq!(one, 1);
    mgr.disconnect_session(&sid).await;
    assert!(mgr.session(&sid).await.is_none());
}

#[tokio::test]
async fn read_only_session_blocks_writes() {
    if !live() {
        return;
    }
    let db = temp_db().await;
    let mgr = ConnectionManager::new(db, MemoryStore::new());
    let id = mgr
        .create_connection(local_config(true), Some(&pg_password()))
        .await
        .expect("create ro");

    let sid = mgr.connect_session(&id).await.expect("connect ro");
    let session = mgr.session(&sid).await.expect("session");

    // A write must be rejected by default_transaction_read_only.
    let res = session
        .client
        .batch_execute("CREATE TEMP TABLE penta_ro_probe (x int)")
        .await;
    assert!(res.is_err(), "read-only session should reject writes");
}

#[tokio::test]
async fn metadata_pool_serves_clients() {
    if !live() {
        return;
    }
    let cfg = pg::build_pg_config(&local_config(false), Some(&pg_password()));
    let pool = pool::build_pool(cfg, 4).expect("pool");
    let client = pool.get().await.expect("pooled client");
    let row = client
        .query_one("SELECT 42::int AS answer", &[])
        .await
        .expect("q");
    let answer: i32 = row.get("answer");
    assert_eq!(answer, 42);
}
