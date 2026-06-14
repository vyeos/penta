//! PostgreSQL introspection via `pg_catalog`.
//!
//! Queries prefer `pg_catalog` over `information_schema` for completeness and
//! speed, and use `pg_get_*` helpers for canonical definitions. Designed to be
//! version-tolerant across PG 13–18; per-version branches live here as the
//! surface grows.

use serde::{Deserialize, Serialize};
use tokio_postgres::Client;

use crate::error::{PentaError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub name: String,
    pub owner: String,
    pub size_bytes: i64,
    pub allow_conn: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaInfo {
    pub name: String,
    pub owner: String,
}

/// Maps the `pg_class.relkind` char to a friendly tree category.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationKind {
    Table,
    View,
    MaterializedView,
    PartitionedTable,
    ForeignTable,
    Other,
}

impl RelationKind {
    fn from_relkind(s: &str) -> Self {
        match s {
            "r" => RelationKind::Table,
            "v" => RelationKind::View,
            "m" => RelationKind::MaterializedView,
            "p" => RelationKind::PartitionedTable,
            "f" => RelationKind::ForeignTable,
            _ => RelationKind::Other,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationInfo {
    pub schema: String,
    pub name: String,
    pub kind: RelationKind,
    pub owner: String,
    pub total_size_bytes: i64,
    pub comment: Option<String>,
}

/// One column, lean shape for autocomplete + the details panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnBrief {
    pub name: String,
    pub data_type: String,
}

/// A relation plus its column list, for the autocomplete completion source.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationColumns {
    pub schema: String,
    pub name: String,
    pub kind: RelationKind,
    pub columns: Vec<ColumnBrief>,
}

/// Compact schema model the editor uses to power schema-aware autocomplete
/// (Decision #12 / §18): schemas, relations-with-columns, and function names.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionModel {
    pub schemas: Vec<String>,
    pub relations: Vec<RelationColumns>,
    pub functions: Vec<String>,
}

fn query_err(e: tokio_postgres::Error) -> PentaError {
    PentaError::Query(e.to_string())
}

/// List non-template databases on the server.
pub async fn list_databases(client: &Client) -> Result<Vec<DatabaseInfo>> {
    let rows = client
        .query(
            "SELECT d.datname,
                    pg_catalog.pg_get_userbyid(d.datdba) AS owner,
                    pg_catalog.pg_database_size(d.datname) AS size_bytes,
                    d.datallowconn
             FROM pg_catalog.pg_database d
             WHERE NOT d.datistemplate
             ORDER BY d.datname",
            &[],
        )
        .await
        .map_err(query_err)?;

    Ok(rows
        .into_iter()
        .map(|r| DatabaseInfo {
            name: r.get(0),
            owner: r.get(1),
            size_bytes: r.get(2),
            allow_conn: r.get(3),
        })
        .collect())
}

/// List user schemas (excludes `pg_*` and `information_schema`).
pub async fn list_schemas(client: &Client) -> Result<Vec<SchemaInfo>> {
    let rows = client
        .query(
            r"SELECT n.nspname,
                     pg_catalog.pg_get_userbyid(n.nspowner) AS owner
              FROM pg_catalog.pg_namespace n
              WHERE n.nspname NOT LIKE 'pg\_%'
                AND n.nspname <> 'information_schema'
              ORDER BY n.nspname",
            &[],
        )
        .await
        .map_err(query_err)?;

    Ok(rows
        .into_iter()
        .map(|r| SchemaInfo {
            name: r.get(0),
            owner: r.get(1),
        })
        .collect())
}

/// List relations of the given `relkind` chars in a schema
/// (e.g. `["r", "p"]` for ordinary + partitioned tables). Batched per category
/// to avoid N+1 metadata queries.
pub async fn list_relations(
    client: &Client,
    schema: &str,
    kinds: &[&str],
) -> Result<Vec<RelationInfo>> {
    let kinds_owned: Vec<String> = kinds.iter().map(|s| s.to_string()).collect();
    let rows = client
        .query(
            "SELECT n.nspname,
                    c.relname,
                    c.relkind::text,
                    pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                    pg_catalog.pg_total_relation_size(c.oid) AS total_size_bytes,
                    obj_description(c.oid, 'pg_class') AS comment
             FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1
               AND c.relkind::text = ANY($2)
             ORDER BY c.relname",
            &[&schema, &kinds_owned],
        )
        .await
        .map_err(query_err)?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let kind: String = r.get(2);
            RelationInfo {
                schema: r.get(0),
                name: r.get(1),
                kind: RelationKind::from_relkind(&kind),
                owner: r.get(3),
                total_size_bytes: r.get(4),
                comment: r.get(5),
            }
        })
        .collect())
}

/// Columns of a single relation, ordered by attribute number.
pub async fn list_columns(
    client: &Client,
    schema: &str,
    relation: &str,
) -> Result<Vec<ColumnBrief>> {
    let rows = client
        .query(
            "SELECT a.attname,
                    pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
             FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2
               AND a.attnum > 0 AND NOT a.attisdropped
             ORDER BY a.attnum",
            &[&schema, &relation],
        )
        .await
        .map_err(query_err)?;
    Ok(rows
        .into_iter()
        .map(|r| ColumnBrief {
            name: r.get(0),
            data_type: r.get(1),
        })
        .collect())
}

/// Introspect the compact completion model for the whole connected database in
/// three batched queries (schemas, relation columns, functions) — no N+1.
pub async fn introspect_completion(client: &Client) -> Result<CompletionModel> {
    let schemas = list_schemas(client)
        .await?
        .into_iter()
        .map(|s| s.name)
        .collect();

    // All columns of all user relations, ordered so we can fold by relation.
    let rows = client
        .query(
            "SELECT n.nspname,
                    c.relname,
                    c.relkind::text,
                    a.attname,
                    pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
             FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE a.attnum > 0 AND NOT a.attisdropped
               AND c.relkind = ANY('{r,p,v,m,f}')
               AND n.nspname NOT LIKE 'pg\\_%'
               AND n.nspname <> 'information_schema'
             ORDER BY n.nspname, c.relname, a.attnum",
            &[],
        )
        .await
        .map_err(query_err)?;

    let mut relations: Vec<RelationColumns> = Vec::new();
    for r in rows {
        let schema: String = r.get(0);
        let name: String = r.get(1);
        let kind: String = r.get(2);
        let col = ColumnBrief {
            name: r.get(3),
            data_type: r.get(4),
        };
        match relations.last_mut() {
            Some(last) if last.schema == schema && last.name == name => last.columns.push(col),
            _ => relations.push(RelationColumns {
                schema,
                name,
                kind: RelationKind::from_relkind(&kind),
                columns: vec![col],
            }),
        }
    }

    let frows = client
        .query(
            "SELECT DISTINCT p.proname
             FROM pg_catalog.pg_proc p
             JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname NOT LIKE 'pg\\_%'
               AND n.nspname <> 'information_schema'
             ORDER BY p.proname",
            &[],
        )
        .await
        .map_err(query_err)?;
    let functions = frows.into_iter().map(|r| r.get(0)).collect();

    Ok(CompletionModel {
        schemas,
        relations,
        functions,
    })
}
