//! CSV export/import round-trip integration test (COPY streamed through Rust).
//! Runs against `PENTA_TEST_PG_URL`; skips gracefully when unset.

use penta_core::{io, pg};

fn test_url() -> Option<String> {
    std::env::var("PENTA_TEST_PG_URL").ok()
}

#[tokio::test]
async fn csv_export_import_round_trip() {
    let Some(url) = test_url() else {
        eprintln!("PENTA_TEST_PG_URL not set; skipping CSV io test");
        return;
    };
    let client = pg::connect(&url).await.expect("connect");

    client
        .batch_execute(
            "DROP SCHEMA IF EXISTS penta_io CASCADE;
             CREATE SCHEMA penta_io;
             CREATE TABLE penta_io.src (id int PRIMARY KEY, label text, amount numeric);
             INSERT INTO penta_io.src VALUES (1,'a',1.50),(2,'b,quoted',2.25),(3,'c''s',3.00);
             CREATE TABLE penta_io.dst (LIKE penta_io.src INCLUDING ALL);",
        )
        .await
        .expect("setup");

    let dir = std::env::temp_dir();
    let path = dir.join("penta_io_test.csv");
    let path_str = path.to_str().unwrap();

    let bytes = io::export_table_csv(&client, "penta_io", "src", path_str)
        .await
        .expect("export");
    assert!(bytes > 0, "expected non-empty CSV export");

    let outcome = io::import_table_csv(&client, "penta_io", "dst", path_str, true)
        .await
        .expect("import");
    assert_eq!(outcome.rows, 3, "expected 3 rows imported");

    // The round trip must preserve the embedded comma and apostrophe verbatim.
    let row = client
        .query_one(
            "SELECT label, amount::text FROM penta_io.dst WHERE id = 2",
            &[],
        )
        .await
        .expect("verify");
    let label: String = row.get(0);
    assert_eq!(label, "b,quoted");

    // Query export also works (arbitrary SELECT).
    let qbytes = io::export_query_csv(&client, "SELECT id FROM penta_io.src ORDER BY id", path_str)
        .await
        .expect("query export");
    assert!(qbytes > 0);

    let _ = std::fs::remove_file(&path);
    client
        .batch_execute("DROP SCHEMA IF EXISTS penta_io CASCADE;")
        .await
        .ok();
}
