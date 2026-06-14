//! Streaming + cancellation integration tests.
//! Gated on `PENTA_TEST_PG_URL`; skips when unset.

use std::time::{Duration, Instant};

use penta_core::{pg, query};

fn test_url() -> Option<String> {
    std::env::var("PENTA_TEST_PG_URL").ok()
}

#[tokio::test]
async fn streams_rows_in_batches() {
    let Some(url) = test_url() else {
        eprintln!("PENTA_TEST_PG_URL not set; skipping streaming test");
        return;
    };
    let client = pg::connect(&url).await.expect("connect");

    let mut total: u64 = 0;
    let mut batches: u32 = 0;
    let summary = query::execute_stream(
        &client,
        "SELECT g AS n, g::text AS s, (g % 2 = 0) AS even, \
                (g::bigint * 1000000000) AS big, now() AS ts \
         FROM generate_series(1, 10000) g",
        1000,
        |b| {
            total += b.len() as u64;
            batches += 1;
        },
    )
    .await
    .expect("stream");

    assert_eq!(summary.row_count, 10_000);
    assert_eq!(total, 10_000);
    assert!(batches >= 10, "expected >=10 batches, got {batches}");
    assert_eq!(summary.columns.len(), 5);
    assert_eq!(summary.columns[0].name, "n");
    // bigint precision preserved as text (Decision #8).
    assert_eq!(summary.columns[3].type_name, "int8");
}

#[tokio::test]
async fn cancels_long_query() {
    let Some(url) = test_url() else {
        eprintln!("PENTA_TEST_PG_URL not set; skipping cancellation test");
        return;
    };
    let client = pg::connect(&url).await.expect("connect");
    let token = query::cancel_token(&client);

    let handle = tokio::spawn(async move { client.batch_execute("SELECT pg_sleep(30)").await });

    // Let the query start, then cancel via the protocol cancel request.
    tokio::time::sleep(Duration::from_millis(500)).await;
    query::cancel(token).await.expect("cancel issued");

    let start = Instant::now();
    let res = handle.await.expect("join");
    assert!(res.is_err(), "expected the cancelled query to error");
    assert!(
        start.elapsed() < Duration::from_secs(10),
        "cancellation should stop the backend promptly"
    );
}
