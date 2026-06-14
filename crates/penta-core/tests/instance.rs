//! End-to-end test of the managed-instance manager: detect binaries → initdb →
//! start → connect over the generated URL → run a query → stop → remove.
//! Skips gracefully when no PostgreSQL binaries are installed.

use penta_core::{instance, pg};

#[tokio::test]
async fn provision_start_connect_stop() {
    let bins = match instance::detect_bins() {
        Ok(b) => b,
        Err(_) => {
            eprintln!("no PostgreSQL binaries found; skipping instance test");
            return;
        }
    };
    eprintln!("using {} ({})", bins.bindir.display(), bins.version);

    let tmp = std::env::temp_dir().join(format!("penta-itest-{}", std::process::id()));
    let opts = instance::ProvisionOpts {
        name: "My Test App".into(),
        database: None,
        superuser: None,
    };

    let inst = instance::provision(&bins, &tmp, opts)
        .await
        .expect("provision");

    // Name was sanitized into a valid db identifier.
    assert_eq!(inst.database, "my_test_app");
    assert_eq!(inst.superuser, "postgres");
    assert!(
        instance::is_running(&bins, &inst),
        "instance should be running"
    );

    // The generated URL connects and points at the project database.
    let client = pg::connect(&inst.url()).await.expect("connect via url");
    let db: String = client
        .query_one("SELECT current_database()", &[])
        .await
        .expect("query")
        .get(0);
    assert_eq!(db, "my_test_app");

    // Registry round-trips.
    let reg_path = tmp.join("registry.json");
    instance::save_registry(&reg_path, std::slice::from_ref(&inst)).expect("save");
    let loaded = instance::load_registry(&reg_path);
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].port, inst.port);

    // Stop, then start again (idempotent), then remove.
    drop(client);
    instance::stop(&bins, &inst).await.expect("stop");
    assert!(!instance::is_running(&bins, &inst), "should be stopped");
    instance::start(&bins, &inst).await.expect("restart");
    assert!(
        instance::is_running(&bins, &inst),
        "should be running again"
    );

    instance::remove(&bins, &inst).await.expect("remove");
    assert!(!inst.data_dir.exists(), "data dir should be deleted");

    let _ = std::fs::remove_dir_all(&tmp);
}
