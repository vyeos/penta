//! GridService: safe data editing (Decision #1 + #9 — the hard MVP launch gate).
//!
//! The contract, in order of importance:
//!   1. **Identity required.** A relation is only editable if it is an ordinary
//!      or partitioned table with a primary key (or a unique, all-NOT-NULL
//!      constraint as a fallback). Views, foreign/materialized tables, and
//!      keyless tables are **read-only**.
//!   2. **Optimistic concurrency via `xmin`.** Every UPDATE/DELETE is scoped to
//!      `WHERE <key> = … AND xmin = <captured>`. A concurrently-changed (or
//!      deleted) row matches 0 rows, which we treat as a conflict and abort.
//!   3. **Parameterized, never string-concatenated.** Identifiers are quoted;
//!      *values* are always bound parameters cast `$n::text::<column type>` so a
//!      type-agnostic text value is coerced by Postgres into the exact column
//!      type (numeric/jsonb/array/bytea/timestamptz keep full fidelity).
//!   4. **Atomic.** A batch of edits runs in one transaction; any failure — PG
//!      error or concurrency conflict — rolls back the whole batch.
//!   5. **Preview first.** `build_statements` produces the exact SQL + params
//!      the UI shows before anything runs.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tokio_postgres::types::ToSql;
use tokio_postgres::Client;

use crate::error::{PentaError, Result};
use crate::introspection::RelationKind;

fn query_err(e: tokio_postgres::Error) -> PentaError {
    match e.as_db_error() {
        Some(db) => PentaError::Query(format!("{}: {}", db.code().code(), db.message())),
        None => PentaError::Query(e.to_string()),
    }
}

/// Double-quote a SQL identifier, escaping embedded quotes. The only safe way to
/// put a user-supplied name (schema/table/column) into SQL text.
pub fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

/// `"schema"."table"`.
fn qualified(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(table))
}

/// Quote a value as a SQL string literal (escape embedded single quotes). Safe
/// with `standard_conforming_strings` on (the default), where backslashes are
/// literal — so no `E''` form is needed.
pub fn quote_literal(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Build a **keyset-paginated** page over a table, ordered by its key columns
/// (Decision #7). When `after` carries the previous page's last-row key values,
/// the page starts strictly after them via a row-value comparison
/// `(k1,k2) > (v1,v2)` — O(log n) per page, no growing OFFSET. Values are
/// embedded as escaped `'…'::text::<type>` literals (same type-coercion model as
/// the edit builder). With no key, falls back to an unordered LIMIT page.
pub fn build_keyset_page_sql(
    identity: &RelationIdentity,
    after: &[String],
    limit: usize,
    with_xmin: bool,
) -> String {
    let qual = qualified(&identity.schema, &identity.table);
    let mut sql = if with_xmin && identity.editable {
        format!("SELECT t.xmin::text AS __penta_xmin, t.* FROM {qual} AS t")
    } else {
        format!("SELECT t.* FROM {qual} AS t")
    };

    let keys = &identity.key_columns;
    if !keys.is_empty() {
        if after.len() == keys.len() {
            let lhs = keys
                .iter()
                .map(|k| format!("t.{}", quote_ident(k)))
                .collect::<Vec<_>>()
                .join(", ");
            let rhs = keys
                .iter()
                .zip(after)
                .map(|(k, v)| {
                    let ty = identity
                        .column(k)
                        .map(|c| c.format_type.as_str())
                        .unwrap_or("text");
                    format!("{}::text::{}", quote_literal(v), ty)
                })
                .collect::<Vec<_>>()
                .join(", ");
            sql.push_str(&format!(" WHERE ({lhs}) > ({rhs})"));
        }
        let order = keys
            .iter()
            .map(|k| format!("t.{} ASC", quote_ident(k)))
            .collect::<Vec<_>>()
            .join(", ");
        sql.push_str(&format!(" ORDER BY {order}"));
    }
    sql.push_str(&format!(" LIMIT {}", limit.max(1)));
    sql
}

/// One column's shape, used to build correctly-typed casts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDef {
    pub name: String,
    pub type_oid: u32,
    /// Canonical type text from `format_type` (e.g. `numeric(10,2)`,
    /// `timestamp with time zone`, `integer[]`) — directly usable as a cast
    /// target: `$n::text::<format_type>`.
    pub format_type: String,
    pub not_null: bool,
}

/// Everything the UI/edit-builder needs to know about a relation's editability.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationIdentity {
    pub schema: String,
    pub table: String,
    pub kind: RelationKind,
    pub columns: Vec<ColumnDef>,
    /// Primary-key (or fallback unique) column names, in order. Empty ⇒ no key.
    pub key_columns: Vec<String>,
    pub editable: bool,
    /// Human-readable reason the grid is read-only (when `!editable`).
    pub readonly_reason: Option<String>,
}

impl RelationIdentity {
    fn column(&self, name: &str) -> Option<&ColumnDef> {
        self.columns.iter().find(|c| c.name == name)
    }

    /// Guard used before building any mutating statement.
    fn require_editable(&self) -> Result<()> {
        if self.editable {
            Ok(())
        } else {
            Err(PentaError::Invalid(format!(
                "{}.{} is not editable: {}",
                self.schema,
                self.table,
                self.readonly_reason.as_deref().unwrap_or("no usable key")
            )))
        }
    }
}

/// Introspect a relation and decide whether the grid may edit it.
pub async fn resolve_identity(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<RelationIdentity> {
    // relkind
    let kind_row = client
        .query_opt(
            "SELECT c.relkind::text
             FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2",
            &[&schema, &table],
        )
        .await
        .map_err(query_err)?;
    let relkind: String = match kind_row {
        Some(r) => r.get(0),
        None => return Err(PentaError::NotFound(format!("relation {schema}.{table}"))),
    };
    let kind = relkind_to_kind(&relkind);

    // columns + their canonical types
    let col_rows = client
        .query(
            "SELECT a.attname,
                    a.atttypid,
                    pg_catalog.format_type(a.atttypid, a.atttypmod),
                    a.attnotnull
             FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2
               AND a.attnum > 0 AND NOT a.attisdropped
             ORDER BY a.attnum",
            &[&schema, &table],
        )
        .await
        .map_err(query_err)?;
    let columns: Vec<ColumnDef> = col_rows
        .iter()
        .map(|r| ColumnDef {
            name: r.get(0),
            type_oid: r.get::<_, u32>(1),
            format_type: r.get(2),
            not_null: r.get(3),
        })
        .collect();

    // primary key columns (ordered)
    let mut key_columns: Vec<String> = client
        .query(
            "SELECT a.attname
             FROM pg_catalog.pg_index i
             JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_catalog.pg_attribute a
                  ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
             WHERE n.nspname = $1 AND c.relname = $2 AND i.indisprimary
             ORDER BY array_position(i.indkey, a.attnum)",
            &[&schema, &table],
        )
        .await
        .map_err(query_err)?
        .iter()
        .map(|r| r.get::<_, String>(0))
        .collect();

    // Fallback: a unique, non-partial, non-expression index whose columns are
    // all NOT NULL. Pick the one with the fewest columns for the tightest WHERE.
    if key_columns.is_empty() {
        key_columns = best_unique_key(client, schema, table, &columns).await?;
    }

    let (editable, readonly_reason) = decide_editable(kind, &key_columns);

    Ok(RelationIdentity {
        schema: schema.to_string(),
        table: table.to_string(),
        kind,
        columns,
        key_columns,
        editable,
        readonly_reason,
    })
}

fn relkind_to_kind(relkind: &str) -> RelationKind {
    match relkind {
        "r" => RelationKind::Table,
        "v" => RelationKind::View,
        "m" => RelationKind::MaterializedView,
        "p" => RelationKind::PartitionedTable,
        "f" => RelationKind::ForeignTable,
        _ => RelationKind::Other,
    }
}

fn decide_editable(kind: RelationKind, key_columns: &[String]) -> (bool, Option<String>) {
    match kind {
        RelationKind::Table | RelationKind::PartitionedTable => {
            if key_columns.is_empty() {
                (
                    false,
                    Some("no primary key or unique-not-null constraint".to_string()),
                )
            } else {
                (true, None)
            }
        }
        RelationKind::View => (false, Some("views are read-only".to_string())),
        RelationKind::MaterializedView => {
            (false, Some("materialized views are read-only".to_string()))
        }
        RelationKind::ForeignTable => (false, Some("foreign tables are read-only".to_string())),
        RelationKind::Other => (false, Some("relation is not an editable table".to_string())),
    }
}

/// Find the narrowest usable unique key when there is no primary key.
async fn best_unique_key(
    client: &Client,
    schema: &str,
    table: &str,
    columns: &[ColumnDef],
) -> Result<Vec<String>> {
    let rows = client
        .query(
            "SELECT i.indkey::text
             FROM pg_catalog.pg_index i
             JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2
               AND i.indisunique AND NOT i.indisprimary
               AND i.indpred IS NULL AND i.indexprs IS NULL",
            &[&schema, &table],
        )
        .await
        .map_err(query_err)?;

    // Map attnum -> (name, not_null) so we can resolve indkey and reject any
    // candidate that includes a nullable column (NULLs defeat equality identity).
    let attnum_query = client
        .query(
            "SELECT a.attnum, a.attname, a.attnotnull
             FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0",
            &[&schema, &table],
        )
        .await
        .map_err(query_err)?;
    let mut by_attnum: HashMap<i16, (String, bool)> = HashMap::new();
    for r in &attnum_query {
        by_attnum.insert(r.get::<_, i16>(0), (r.get(1), r.get(2)));
    }
    let _ = columns; // columns kept for signature symmetry / future use

    let mut best: Option<Vec<String>> = None;
    for r in &rows {
        // indkey is an int2vector rendered as space-separated attnums, e.g. "2 4".
        let indkey: String = r.get(0);
        let attnums: Vec<i16> = indkey
            .split_whitespace()
            .filter_map(|s| s.parse::<i16>().ok())
            .collect();
        if attnums.contains(&0) {
            continue; // expression column — skip
        }
        let mut names = Vec::with_capacity(attnums.len());
        let mut all_not_null = true;
        for n in &attnums {
            match by_attnum.get(n) {
                Some((name, not_null)) => {
                    if !*not_null {
                        all_not_null = false;
                        break;
                    }
                    names.push(name.clone());
                }
                None => {
                    all_not_null = false;
                    break;
                }
            }
        }
        if all_not_null && !names.is_empty() {
            let better = match &best {
                Some(b) => names.len() < b.len(),
                None => true,
            };
            if better {
                best = Some(names);
            }
        }
    }
    Ok(best.unwrap_or_default())
}

// ---------------------------------------------------------------------------
// Edit model (wire types sent from the grid)
// ---------------------------------------------------------------------------

/// A column/value pair. `value == None` means SQL NULL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellValue {
    pub column: String,
    pub value: Option<String>,
}

/// One staged edit. Tagged by `kind` for ergonomic JSON from the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RowEdit {
    Update {
        schema: String,
        table: String,
        /// Primary-key (or unique) identity captured from the original row.
        key: Vec<CellValue>,
        /// The row's captured `xmin` (as text) for optimistic concurrency.
        xmin: String,
        /// Columns being changed (must be non-empty).
        set: Vec<CellValue>,
    },
    Insert {
        schema: String,
        table: String,
        values: Vec<CellValue>,
    },
    Delete {
        schema: String,
        table: String,
        key: Vec<CellValue>,
        xmin: String,
    },
}

impl RowEdit {
    pub fn schema(&self) -> &str {
        match self {
            RowEdit::Update { schema, .. }
            | RowEdit::Insert { schema, .. }
            | RowEdit::Delete { schema, .. } => schema,
        }
    }
    pub fn table(&self) -> &str {
        match self {
            RowEdit::Update { table, .. }
            | RowEdit::Insert { table, .. }
            | RowEdit::Delete { table, .. } => table,
        }
    }
}

/// A ready-to-run parameterized statement. `params` are bound positionally as
/// text (`$1, $2, …`), each cast in `sql` to its column type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Statement {
    pub sql: String,
    pub params: Vec<Option<String>>,
    /// Number of rows the statement must affect for success (1 for keyed
    /// UPDATE/DELETE and INSERT). 0 affected on a keyed op ⇒ conflict.
    pub expect_rows: u8,
}

/// Build the parameterized statement for one edit against its relation identity.
pub fn build_statement(edit: &RowEdit, identity: &RelationIdentity) -> Result<Statement> {
    identity.require_editable()?;

    match edit {
        RowEdit::Update {
            schema,
            table,
            key,
            xmin,
            set,
        } => {
            if set.is_empty() {
                return Err(PentaError::Invalid("UPDATE has no changed columns".into()));
            }
            validate_key(identity, key)?;
            let mut params: Vec<Option<String>> = Vec::new();
            let mut next = 1usize;

            let set_sql = set
                .iter()
                .map(|cv| {
                    let frag = assign_fragment(identity, cv, &mut next)?;
                    params.push(cv.value.clone());
                    Ok(frag)
                })
                .collect::<Result<Vec<_>>>()?
                .join(", ");

            let where_sql = build_where(identity, key, xmin, &mut params, &mut next)?;

            Ok(Statement {
                sql: format!(
                    "UPDATE {} SET {} WHERE {}",
                    qualified(schema, table),
                    set_sql,
                    where_sql
                ),
                params,
                expect_rows: 1,
            })
        }
        RowEdit::Insert {
            schema,
            table,
            values,
        } => {
            if values.is_empty() {
                return Err(PentaError::Invalid("INSERT has no values".into()));
            }
            let mut params: Vec<Option<String>> = Vec::new();
            let mut cols = Vec::with_capacity(values.len());
            let mut placeholders = Vec::with_capacity(values.len());
            for (i, cv) in values.iter().enumerate() {
                let col = identity
                    .column(&cv.column)
                    .ok_or_else(|| PentaError::Invalid(format!("unknown column {}", cv.column)))?;
                cols.push(quote_ident(&cv.column));
                placeholders.push(cast_placeholder(i + 1, &col.format_type));
                params.push(cv.value.clone());
            }
            Ok(Statement {
                sql: format!(
                    "INSERT INTO {} ({}) VALUES ({})",
                    qualified(schema, table),
                    cols.join(", "),
                    placeholders.join(", ")
                ),
                params,
                expect_rows: 1,
            })
        }
        RowEdit::Delete {
            schema,
            table,
            key,
            xmin,
        } => {
            validate_key(identity, key)?;
            let mut params: Vec<Option<String>> = Vec::new();
            let mut next = 1usize;
            let where_sql = build_where(identity, key, xmin, &mut params, &mut next)?;
            Ok(Statement {
                sql: format!(
                    "DELETE FROM {} WHERE {}",
                    qualified(schema, table),
                    where_sql
                ),
                params,
                expect_rows: 1,
            })
        }
    }
}

/// `"col" = $n::text::<type>` — the only value-binding pattern we emit.
fn assign_fragment(
    identity: &RelationIdentity,
    cv: &CellValue,
    next: &mut usize,
) -> Result<String> {
    let col = identity
        .column(&cv.column)
        .ok_or_else(|| PentaError::Invalid(format!("unknown column {}", cv.column)))?;
    let frag = format!(
        "{} = {}",
        quote_ident(&cv.column),
        cast_placeholder(*next, &col.format_type)
    );
    *next += 1;
    Ok(frag)
}

fn cast_placeholder(n: usize, format_type: &str) -> String {
    // Inner `::text` pins the parameter's inferred type to text so we can always
    // bind a String; the outer cast coerces text → the real column type.
    format!("${n}::text::{format_type}")
}

/// `"k1" = $.. AND "k2" = $.. AND xmin::text = $..` — identity + concurrency.
fn build_where(
    identity: &RelationIdentity,
    key: &[CellValue],
    xmin: &str,
    params: &mut Vec<Option<String>>,
    next: &mut usize,
) -> Result<String> {
    let mut clauses = Vec::with_capacity(key.len() + 1);
    for cv in key {
        let col = identity
            .column(&cv.column)
            .ok_or_else(|| PentaError::Invalid(format!("unknown key column {}", cv.column)))?;
        clauses.push(format!(
            "{} = {}",
            quote_ident(&cv.column),
            cast_placeholder(*next, &col.format_type)
        ));
        params.push(cv.value.clone());
        *next += 1;
    }
    // Optimistic-concurrency guard. Compare the system column as text against a
    // plain text param (xid has no stable binary ToSql; text is exact).
    clauses.push(format!("xmin::text = ${next}"));
    params.push(Some(xmin.to_string()));
    *next += 1;
    Ok(clauses.join(" AND "))
}

/// Ensure the supplied key matches the relation's identity columns exactly.
fn validate_key(identity: &RelationIdentity, key: &[CellValue]) -> Result<()> {
    if key.is_empty() {
        return Err(PentaError::Invalid("edit is missing key columns".into()));
    }
    let supplied: Vec<&str> = key.iter().map(|c| c.column.as_str()).collect();
    for k in &identity.key_columns {
        if !supplied.contains(&k.as_str()) {
            return Err(PentaError::Invalid(format!(
                "edit key is missing identity column {k}"
            )));
        }
    }
    if supplied.len() != identity.key_columns.len() {
        return Err(PentaError::Invalid(
            "edit key columns do not match the relation key".into(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/// Result of applying a batch of edits.
#[derive(Debug, Clone, Serialize)]
pub struct ApplyOutcome {
    pub applied: u64,
}

/// Build the previewable statements for a batch, resolving each distinct
/// relation's identity once. No mutation happens here.
pub async fn build_statements(client: &Client, edits: &[RowEdit]) -> Result<Vec<Statement>> {
    let identities = resolve_identities(client, edits).await?;
    edits
        .iter()
        .map(|e| {
            let id = &identities[&key_of(e)];
            build_statement(e, id)
        })
        .collect()
}

/// Apply a batch of edits atomically. Any PG error or concurrency conflict
/// (0 rows affected on a keyed op) rolls back the entire batch.
pub async fn apply_edits(client: &Client, edits: &[RowEdit]) -> Result<ApplyOutcome> {
    if edits.is_empty() {
        return Ok(ApplyOutcome { applied: 0 });
    }
    let statements = build_statements(client, edits).await?;

    client.batch_execute("BEGIN").await.map_err(query_err)?;

    let mut applied: u64 = 0;
    for (i, stmt) in statements.iter().enumerate() {
        let param_refs: Vec<&(dyn ToSql + Sync)> = stmt
            .params
            .iter()
            .map(|p| p as &(dyn ToSql + Sync))
            .collect();

        match client.execute(stmt.sql.as_str(), &param_refs).await {
            Ok(n) => {
                if stmt.expect_rows == 1 && n == 0 {
                    rollback(client).await;
                    return Err(PentaError::Conflict(format!(
                        "edit #{} affected 0 rows: the row was changed or deleted by someone else (refresh and retry)",
                        i + 1
                    )));
                }
                if stmt.expect_rows == 1 && n > 1 {
                    rollback(client).await;
                    return Err(PentaError::Invalid(format!(
                        "edit #{} would affect {n} rows; aborting (identity is not unique)",
                        i + 1
                    )));
                }
                applied += n;
            }
            Err(e) => {
                rollback(client).await;
                let mapped = query_err(e);
                return Err(PentaError::Query(format!(
                    "edit #{} failed: {mapped}",
                    i + 1
                )));
            }
        }
    }

    client.batch_execute("COMMIT").await.map_err(query_err)?;
    Ok(ApplyOutcome { applied })
}

async fn rollback(client: &Client) {
    // Best-effort; the connection may already be in a failed txn state.
    let _ = client.batch_execute("ROLLBACK").await;
}

fn key_of(edit: &RowEdit) -> (String, String) {
    (edit.schema().to_string(), edit.table().to_string())
}

async fn resolve_identities(
    client: &Client,
    edits: &[RowEdit],
) -> Result<HashMap<(String, String), RelationIdentity>> {
    use std::collections::hash_map::Entry;
    let mut out: HashMap<(String, String), RelationIdentity> = HashMap::new();
    for e in edits {
        if let Entry::Vacant(slot) = out.entry(key_of(e)) {
            let (schema, table) = slot.key().clone();
            let id = resolve_identity(client, &schema, &table).await?;
            id.require_editable()?;
            slot.insert(id);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ident(columns: Vec<ColumnDef>, keys: &[&str]) -> RelationIdentity {
        RelationIdentity {
            schema: "public".into(),
            table: "t".into(),
            kind: RelationKind::Table,
            columns,
            key_columns: keys.iter().map(|s| s.to_string()).collect(),
            editable: true,
            readonly_reason: None,
        }
    }

    fn col(name: &str, ft: &str) -> ColumnDef {
        ColumnDef {
            name: name.into(),
            type_oid: 0,
            format_type: ft.into(),
            not_null: false,
        }
    }

    #[test]
    fn quotes_identifiers_and_escapes_quotes() {
        assert_eq!(quote_ident("plain"), "\"plain\"");
        assert_eq!(quote_ident("we\"ird"), "\"we\"\"ird\"");
        assert_eq!(qualified("s", "t"), "\"s\".\"t\"");
    }

    #[test]
    fn quote_literal_escapes_single_quotes() {
        assert_eq!(quote_literal("o'brien"), "'o''brien'");
    }

    #[test]
    fn keyset_first_page_has_order_and_limit_no_where() {
        let id = ident(vec![col("id", "bigint")], &["id"]);
        let sql = build_keyset_page_sql(&id, &[], 100, true);
        assert!(sql.contains("SELECT t.xmin::text AS __penta_xmin, t.*"));
        assert!(sql.contains("ORDER BY t.\"id\" ASC"));
        assert!(sql.contains("LIMIT 100"));
        assert!(!sql.contains("WHERE"));
    }

    #[test]
    fn keyset_next_page_compares_after_cursor_with_typed_casts() {
        let id = ident(
            vec![col("id", "bigint"), col("ts", "timestamptz")],
            &["id", "ts"],
        );
        let sql = build_keyset_page_sql(&id, &["5".into(), "2026-01-01".into()], 50, false);
        assert!(sql.contains(
            "WHERE (t.\"id\", t.\"ts\") > ('5'::text::bigint, '2026-01-01'::text::timestamptz)"
        ));
        assert!(sql.contains("ORDER BY t.\"id\" ASC, t.\"ts\" ASC"));
    }

    #[test]
    fn keyset_keyless_relation_is_unordered_limit() {
        let id = ident(vec![col("v", "text")], &[]);
        let sql = build_keyset_page_sql(&id, &[], 10, false);
        assert!(!sql.contains("ORDER BY"));
        assert!(sql.contains("LIMIT 10"));
    }

    #[test]
    fn builds_update_with_xmin_and_typed_casts() {
        let id = ident(
            vec![col("id", "integer"), col("amount", "numeric(10,2)")],
            &["id"],
        );
        let edit = RowEdit::Update {
            schema: "public".into(),
            table: "t".into(),
            key: vec![CellValue {
                column: "id".into(),
                value: Some("7".into()),
            }],
            xmin: "4242".into(),
            set: vec![CellValue {
                column: "amount".into(),
                value: Some("19.99".into()),
            }],
        };
        let s = build_statement(&edit, &id).unwrap();
        assert_eq!(
            s.sql,
            "UPDATE \"public\".\"t\" SET \"amount\" = $1::text::numeric(10,2) \
             WHERE \"id\" = $2::text::integer AND xmin::text = $3"
        );
        assert_eq!(
            s.params,
            vec![Some("19.99".into()), Some("7".into()), Some("4242".into())]
        );
        assert_eq!(s.expect_rows, 1);
    }

    #[test]
    fn builds_composite_key_delete() {
        let id = ident(
            vec![col("a", "integer"), col("b", "text"), col("v", "text")],
            &["a", "b"],
        );
        let edit = RowEdit::Delete {
            schema: "public".into(),
            table: "t".into(),
            key: vec![
                CellValue {
                    column: "a".into(),
                    value: Some("1".into()),
                },
                CellValue {
                    column: "b".into(),
                    value: Some("x".into()),
                },
            ],
            xmin: "99".into(),
        };
        let s = build_statement(&edit, &id).unwrap();
        assert_eq!(
            s.sql,
            "DELETE FROM \"public\".\"t\" WHERE \"a\" = $1::text::integer \
             AND \"b\" = $2::text::text AND xmin::text = $3"
        );
        assert_eq!(
            s.params,
            vec![Some("1".into()), Some("x".into()), Some("99".into())]
        );
    }

    #[test]
    fn builds_insert() {
        let id = ident(vec![col("id", "integer"), col("name", "text")], &["id"]);
        let edit = RowEdit::Insert {
            schema: "public".into(),
            table: "t".into(),
            values: vec![
                CellValue {
                    column: "id".into(),
                    value: Some("3".into()),
                },
                CellValue {
                    column: "name".into(),
                    value: None,
                },
            ],
        };
        let s = build_statement(&edit, &id).unwrap();
        assert_eq!(
            s.sql,
            "INSERT INTO \"public\".\"t\" (\"id\", \"name\") \
             VALUES ($1::text::integer, $2::text::text)"
        );
        assert_eq!(s.params, vec![Some("3".into()), None]);
    }

    #[test]
    fn rejects_update_with_no_changes() {
        let id = ident(vec![col("id", "integer")], &["id"]);
        let edit = RowEdit::Update {
            schema: "public".into(),
            table: "t".into(),
            key: vec![CellValue {
                column: "id".into(),
                value: Some("1".into()),
            }],
            xmin: "1".into(),
            set: vec![],
        };
        assert!(build_statement(&edit, &id).is_err());
    }

    #[test]
    fn rejects_edit_on_readonly_relation() {
        let mut id = ident(vec![col("id", "integer")], &[]);
        id.editable = false;
        id.readonly_reason = Some("views are read-only".into());
        let edit = RowEdit::Insert {
            schema: "public".into(),
            table: "t".into(),
            values: vec![CellValue {
                column: "id".into(),
                value: Some("1".into()),
            }],
        };
        assert!(build_statement(&edit, &id).is_err());
    }

    #[test]
    fn rejects_mismatched_key() {
        let id = ident(vec![col("a", "integer"), col("b", "integer")], &["a", "b"]);
        // Missing composite member `b`.
        let edit = RowEdit::Delete {
            schema: "public".into(),
            table: "t".into(),
            key: vec![CellValue {
                column: "a".into(),
                value: Some("1".into()),
            }],
            xmin: "1".into(),
        };
        assert!(build_statement(&edit, &id).is_err());
    }

    #[test]
    fn rejects_unknown_column() {
        let id = ident(vec![col("id", "integer")], &["id"]);
        let edit = RowEdit::Insert {
            schema: "public".into(),
            table: "t".into(),
            values: vec![CellValue {
                column: "ghost".into(),
                value: Some("x".into()),
            }],
        };
        assert!(build_statement(&edit, &id).is_err());
    }
}
