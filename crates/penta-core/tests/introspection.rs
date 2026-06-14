//! Introspection integration test.
//!
//! Runs against a real PostgreSQL pointed to by `PENTA_TEST_PG_URL`
//! (e.g. `postgres://penta@127.0.0.1:55432/penta_dev`). Skips gracefully when
//! the variable is unset so `cargo test` stays green without a database.

use penta_core::{introspection, pg};

fn test_url() -> Option<String> {
    std::env::var("PENTA_TEST_PG_URL").ok()
}

#[tokio::test]
async fn introspects_schemas_and_tables() {
    let Some(url) = test_url() else {
        eprintln!("PENTA_TEST_PG_URL not set; skipping introspection integration test");
        return;
    };

    let client = pg::connect(&url).await.expect("connect");

    client
        .batch_execute(
            "DROP SCHEMA IF EXISTS penta_it CASCADE;
             CREATE SCHEMA penta_it;
             CREATE TABLE penta_it.widgets (id bigserial PRIMARY KEY, name text);
             COMMENT ON TABLE penta_it.widgets IS 'test table';
             CREATE VIEW penta_it.v_widgets AS SELECT id FROM penta_it.widgets;",
        )
        .await
        .expect("setup");

    let dbs = introspection::list_databases(&client).await.expect("dbs");
    assert!(!dbs.is_empty(), "expected at least one database");

    let schemas = introspection::list_schemas(&client).await.expect("schemas");
    assert!(
        schemas.iter().any(|s| s.name == "penta_it"),
        "expected penta_it schema in {schemas:?}"
    );
    assert!(
        !schemas.iter().any(|s| s.name == "information_schema"),
        "information_schema should be filtered out"
    );

    let tables = introspection::list_relations(&client, "penta_it", &["r", "p"])
        .await
        .expect("tables");
    let widgets = tables
        .iter()
        .find(|r| r.name == "widgets")
        .expect("widgets table present");
    assert_eq!(widgets.kind, introspection::RelationKind::Table);
    assert_eq!(widgets.comment.as_deref(), Some("test table"));

    let views = introspection::list_relations(&client, "penta_it", &["v"])
        .await
        .expect("views");
    assert!(
        views
            .iter()
            .any(|r| r.name == "v_widgets" && r.kind == introspection::RelationKind::View),
        "expected v_widgets view"
    );

    // Per-relation columns and the autocomplete completion model.
    let cols = introspection::list_columns(&client, "penta_it", "widgets")
        .await
        .expect("columns");
    assert!(
        cols.iter().any(|c| c.name == "id") && cols.iter().any(|c| c.name == "name"),
        "expected id+name columns in {cols:?}"
    );

    let model = introspection::introspect_completion(&client)
        .await
        .expect("completion model");
    let widgets_cols = model
        .relations
        .iter()
        .find(|r| r.schema == "penta_it" && r.name == "widgets")
        .expect("widgets in completion model");
    assert!(
        widgets_cols.columns.iter().any(|c| c.name == "name"),
        "completion model should carry widgets.name"
    );
    assert!(
        model.relations.iter().all(|r| !r.schema.starts_with("pg_")),
        "completion model should exclude system schemas"
    );

    client
        .batch_execute("DROP SCHEMA IF EXISTS penta_it CASCADE;")
        .await
        .ok();
}
