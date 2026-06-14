//! Data-edit correctness suite — the hard MVP launch gate (Decision #1/#9).
//!
//! Covers: PK/composite/unique-fallback detection, no-PK→read-only,
//! view→read-only, `xmin` optimistic-concurrency conflict abort, atomic
//! partial-failure rollback, INSERT/DELETE, and type fidelity across
//! numeric/jsonb/array/bytea/timestamptz.
//!
//! Gated on `PENTA_TEST_PG_URL`; skips cleanly when unset (CI provides PG).

use penta_core::error::PentaError;
use penta_core::grid::{self, CellValue, RowEdit};
use penta_core::pg;
use tokio_postgres::Client;
use uuid::Uuid;

fn test_url() -> Option<String> {
    std::env::var("PENTA_TEST_PG_URL").ok()
}

/// Connect and create a throwaway schema; returns `(client, schema)`.
async fn setup(client_ddl: &str) -> Option<(Client, String)> {
    let url = test_url()?;
    let client = pg::connect(&url).await.expect("connect");
    let schema = format!("penta_t_{}", Uuid::new_v4().simple());
    client
        .batch_execute(&format!("CREATE SCHEMA \"{schema}\""))
        .await
        .expect("create schema");
    let ddl = client_ddl.replace("{S}", &schema);
    client.batch_execute(&ddl).await.expect("ddl");
    Some((client, schema))
}

async fn teardown(client: &Client, schema: &str) {
    let _ = client
        .batch_execute(&format!("DROP SCHEMA \"{schema}\" CASCADE"))
        .await;
}

async fn capture_xmin(client: &Client, schema: &str, table: &str, pk_pred: &str) -> String {
    client
        .query_one(
            &format!("SELECT xmin::text FROM \"{schema}\".\"{table}\" WHERE {pk_pred}"),
            &[],
        )
        .await
        .expect("capture xmin")
        .get(0)
}

macro_rules! skip_if_no_db {
    ($opt:expr) => {
        match $opt {
            Some(v) => v,
            None => {
                eprintln!("PENTA_TEST_PG_URL not set; skipping");
                return;
            }
        }
    };
}

// --- identity detection --------------------------------------------------

#[tokio::test]
async fn detects_single_primary_key() {
    let (client, schema) =
        skip_if_no_db!(setup("CREATE TABLE {S}.t (id int PRIMARY KEY, v text)").await);
    let id = grid::resolve_identity(&client, &schema, "t").await.unwrap();
    assert!(id.editable);
    assert_eq!(id.key_columns, vec!["id".to_string()]);
    assert_eq!(id.columns.len(), 2);
    teardown(&client, &schema).await;
}

#[tokio::test]
async fn detects_composite_primary_key() {
    let (client, schema) = skip_if_no_db!(
        setup("CREATE TABLE {S}.t (a int, b text, v text, PRIMARY KEY (a, b))").await
    );
    let id = grid::resolve_identity(&client, &schema, "t").await.unwrap();
    assert!(id.editable);
    assert_eq!(id.key_columns, vec!["a".to_string(), "b".to_string()]);
    teardown(&client, &schema).await;
}

#[tokio::test]
async fn no_key_is_read_only() {
    let (client, schema) = skip_if_no_db!(setup("CREATE TABLE {S}.t (v text, n int)").await);
    let id = grid::resolve_identity(&client, &schema, "t").await.unwrap();
    assert!(!id.editable);
    assert!(id.key_columns.is_empty());
    assert!(id.readonly_reason.is_some());
    teardown(&client, &schema).await;
}

#[tokio::test]
async fn view_is_read_only() {
    let (client, schema) = skip_if_no_db!(
        setup("CREATE TABLE {S}.t (id int PRIMARY KEY); CREATE VIEW {S}.vv AS SELECT * FROM {S}.t")
            .await
    );
    let id = grid::resolve_identity(&client, &schema, "vv")
        .await
        .unwrap();
    assert!(!id.editable);
    teardown(&client, &schema).await;
}

#[tokio::test]
async fn unique_not_null_is_fallback_key() {
    // No PK, but a UNIQUE NOT NULL column should serve as identity.
    let (client, schema) =
        skip_if_no_db!(setup("CREATE TABLE {S}.t (email text UNIQUE NOT NULL, name text)").await);
    let id = grid::resolve_identity(&client, &schema, "t").await.unwrap();
    assert!(id.editable, "unique-not-null should be editable");
    assert_eq!(id.key_columns, vec!["email".to_string()]);
    teardown(&client, &schema).await;
}

#[tokio::test]
async fn nullable_unique_is_not_a_key() {
    // UNIQUE but nullable: NULLs break equality identity ⇒ read-only.
    let (client, schema) =
        skip_if_no_db!(setup("CREATE TABLE {S}.t (email text UNIQUE, name text)").await);
    let id = grid::resolve_identity(&client, &schema, "t").await.unwrap();
    assert!(!id.editable);
    teardown(&client, &schema).await;
}

// --- mutation happy paths ------------------------------------------------

#[tokio::test]
async fn update_commits_and_advances_xmin() {
    let (client, schema) = skip_if_no_db!(
        setup("CREATE TABLE {S}.t (id int PRIMARY KEY, v text); INSERT INTO {S}.t VALUES (1,'a')")
            .await
    );
    let xmin = capture_xmin(&client, &schema, "t", "id = 1").await;
    let edit = RowEdit::Update {
        schema: schema.clone(),
        table: "t".into(),
        key: vec![CellValue {
            column: "id".into(),
            value: Some("1".into()),
        }],
        xmin: xmin.clone(),
        set: vec![CellValue {
            column: "v".into(),
            value: Some("b".into()),
        }],
    };
    let out = grid::apply_edits(&client, &[edit]).await.unwrap();
    assert_eq!(out.applied, 1);

    let v: String = client
        .query_one(&format!("SELECT v FROM \"{schema}\".t WHERE id=1"), &[])
        .await
        .unwrap()
        .get(0);
    assert_eq!(v, "b");
    let xmin2 = capture_xmin(&client, &schema, "t", "id = 1").await;
    assert_ne!(xmin, xmin2, "xmin should advance after a successful update");
    teardown(&client, &schema).await;
}

#[tokio::test]
async fn insert_and_delete_round_trip() {
    let (client, schema) =
        skip_if_no_db!(setup("CREATE TABLE {S}.t (id int PRIMARY KEY, v text)").await);
    let ins = RowEdit::Insert {
        schema: schema.clone(),
        table: "t".into(),
        values: vec![
            CellValue {
                column: "id".into(),
                value: Some("5".into()),
            },
            CellValue {
                column: "v".into(),
                value: None,
            },
        ],
    };
    assert_eq!(grid::apply_edits(&client, &[ins]).await.unwrap().applied, 1);

    let cnt: i64 = client
        .query_one(
            &format!("SELECT count(*) FROM \"{schema}\".t WHERE id=5 AND v IS NULL"),
            &[],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(cnt, 1);

    let xmin = capture_xmin(&client, &schema, "t", "id = 5").await;
    let del = RowEdit::Delete {
        schema: schema.clone(),
        table: "t".into(),
        key: vec![CellValue {
            column: "id".into(),
            value: Some("5".into()),
        }],
        xmin,
    };
    assert_eq!(grid::apply_edits(&client, &[del]).await.unwrap().applied, 1);
    let cnt: i64 = client
        .query_one(&format!("SELECT count(*) FROM \"{schema}\".t"), &[])
        .await
        .unwrap()
        .get(0);
    assert_eq!(cnt, 0);
    teardown(&client, &schema).await;
}

// --- optimistic concurrency ---------------------------------------------

#[tokio::test]
async fn stale_xmin_aborts_with_conflict() {
    let (client, schema) = skip_if_no_db!(
        setup("CREATE TABLE {S}.t (id int PRIMARY KEY, v text); INSERT INTO {S}.t VALUES (1,'a')")
            .await
    );
    let stale = capture_xmin(&client, &schema, "t", "id = 1").await;

    // Someone else changes the row out-of-band; its xmin advances.
    client
        .batch_execute(&format!("UPDATE \"{schema}\".t SET v='other' WHERE id=1"))
        .await
        .unwrap();

    let edit = RowEdit::Update {
        schema: schema.clone(),
        table: "t".into(),
        key: vec![CellValue {
            column: "id".into(),
            value: Some("1".into()),
        }],
        xmin: stale,
        set: vec![CellValue {
            column: "v".into(),
            value: Some("mine".into()),
        }],
    };
    let err = grid::apply_edits(&client, &[edit]).await.unwrap_err();
    assert!(
        matches!(err, PentaError::Conflict(_)),
        "expected Conflict, got {err:?}"
    );

    // The concurrent change must be intact — our edit did not clobber it.
    let v: String = client
        .query_one(&format!("SELECT v FROM \"{schema}\".t WHERE id=1"), &[])
        .await
        .unwrap()
        .get(0);
    assert_eq!(v, "other");
    teardown(&client, &schema).await;
}

// --- atomic partial-failure rollback ------------------------------------

#[tokio::test]
async fn batch_rolls_back_on_partial_failure() {
    let (client, schema) = skip_if_no_db!(
        setup(
            "CREATE TABLE {S}.t (id int PRIMARY KEY, v text, q int NOT NULL);
             INSERT INTO {S}.t VALUES (1,'a',10),(2,'b',20)"
        )
        .await
    );
    let x1 = capture_xmin(&client, &schema, "t", "id = 1").await;
    let x2 = capture_xmin(&client, &schema, "t", "id = 2").await;

    let ok = RowEdit::Update {
        schema: schema.clone(),
        table: "t".into(),
        key: vec![CellValue {
            column: "id".into(),
            value: Some("1".into()),
        }],
        xmin: x1,
        set: vec![CellValue {
            column: "v".into(),
            value: Some("changed".into()),
        }],
    };
    // Violates NOT NULL on q ⇒ PG error mid-batch.
    let bad = RowEdit::Update {
        schema: schema.clone(),
        table: "t".into(),
        key: vec![CellValue {
            column: "id".into(),
            value: Some("2".into()),
        }],
        xmin: x2,
        set: vec![CellValue {
            column: "q".into(),
            value: None,
        }],
    };

    let err = grid::apply_edits(&client, &[ok, bad]).await.unwrap_err();
    assert!(
        matches!(err, PentaError::Query(_)),
        "expected Query error, got {err:?}"
    );

    // Row 1's successful edit must have been rolled back with the batch.
    let v: String = client
        .query_one(&format!("SELECT v FROM \"{schema}\".t WHERE id=1"), &[])
        .await
        .unwrap()
        .get(0);
    assert_eq!(v, "a", "first edit must roll back atomically");
    teardown(&client, &schema).await;
}

// --- type fidelity -------------------------------------------------------

#[tokio::test]
async fn type_fidelity_across_hard_types() {
    let (client, schema) = skip_if_no_db!(
        setup(
            "CREATE TABLE {S}.t (
                id int PRIMARY KEY,
                n  numeric(20,6),
                j  jsonb,
                arr integer[],
                b  bytea,
                ts timestamptz
             );
             INSERT INTO {S}.t (id) VALUES (1)"
        )
        .await
    );
    let xmin = capture_xmin(&client, &schema, "t", "id = 1").await;

    let n_txt = "12345.678900";
    let j_txt = r#"{"a":1,"b":[2,3]}"#;
    let arr_txt = "{1,2,3}";
    let b_txt = r"\x48656c6c6f"; // "Hello"
    let ts_txt = "2026-06-14 12:34:56+00";

    let edit = RowEdit::Update {
        schema: schema.clone(),
        table: "t".into(),
        key: vec![CellValue {
            column: "id".into(),
            value: Some("1".into()),
        }],
        xmin,
        set: vec![
            CellValue {
                column: "n".into(),
                value: Some(n_txt.into()),
            },
            CellValue {
                column: "j".into(),
                value: Some(j_txt.into()),
            },
            CellValue {
                column: "arr".into(),
                value: Some(arr_txt.into()),
            },
            CellValue {
                column: "b".into(),
                value: Some(b_txt.into()),
            },
            CellValue {
                column: "ts".into(),
                value: Some(ts_txt.into()),
            },
        ],
    };
    assert_eq!(
        grid::apply_edits(&client, &[edit]).await.unwrap().applied,
        1
    );

    // Each stored value must equal the same text re-cast to the column type.
    let row = client
        .query_one(
            &format!(
                "SELECT n = $1::text::numeric,
                        j = $2::text::jsonb,
                        arr = $3::text::integer[],
                        b = $4::text::bytea,
                        ts = $5::text::timestamptz
                 FROM \"{schema}\".t WHERE id=1"
            ),
            &[&n_txt, &j_txt, &arr_txt, &b_txt, &ts_txt],
        )
        .await
        .unwrap();
    for (i, label) in ["numeric", "jsonb", "array", "bytea", "timestamptz"]
        .iter()
        .enumerate()
    {
        let ok: bool = row.get(i);
        assert!(ok, "type fidelity failed for {label}");
    }
    teardown(&client, &schema).await;
}

// --- preview (no mutation) ----------------------------------------------

#[tokio::test]
async fn build_statements_previews_without_mutating() {
    let (client, schema) = skip_if_no_db!(
        setup("CREATE TABLE {S}.t (id int PRIMARY KEY, v text); INSERT INTO {S}.t VALUES (1,'a')")
            .await
    );
    let xmin = capture_xmin(&client, &schema, "t", "id = 1").await;
    let edit = RowEdit::Update {
        schema: schema.clone(),
        table: "t".into(),
        key: vec![CellValue {
            column: "id".into(),
            value: Some("1".into()),
        }],
        xmin,
        set: vec![CellValue {
            column: "v".into(),
            value: Some("z".into()),
        }],
    };
    let stmts = grid::build_statements(&client, &[edit]).await.unwrap();
    assert_eq!(stmts.len(), 1);
    assert!(stmts[0].sql.contains("UPDATE"));
    assert!(stmts[0].sql.contains("xmin::text"));

    // Preview must not have changed anything.
    let v: String = client
        .query_one(&format!("SELECT v FROM \"{schema}\".t WHERE id=1"), &[])
        .await
        .unwrap()
        .get(0);
    assert_eq!(v, "a");
    teardown(&client, &schema).await;
}
