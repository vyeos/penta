//! Query execution: streaming row delivery + protocol-level cancellation.
//!
//! Decision #7 (pagination): query-tool results stream via a `tokio-postgres`
//! `RowStream`, batched to the UI. Decision #8 (value encoding): every cell is
//! converted to a lossless canonical **string** plus per-column type metadata,
//! so bigint/numeric/timestamptz keep full precision (no JS float coercion).
//!
//! The transport-agnostic `execute_stream` takes a batch callback; the Tauri
//! layer adapts that callback to a `Channel`.

use futures_util::{pin_mut, TryStreamExt};
use serde::Serialize;
use tokio_postgres::types::FromSqlOwned;
use tokio_postgres::{CancelToken, Client, NoTls, Row};

use crate::error::{PentaError, Result};

/// Metadata for one result column (Decision #8 wire shape).
#[derive(Debug, Clone, Serialize)]
pub struct ColumnMeta {
    pub name: String,
    pub type_oid: u32,
    pub type_name: String,
}

/// Outcome of a streamed query.
#[derive(Debug, Clone, Serialize)]
pub struct QuerySummary {
    pub columns: Vec<ColumnMeta>,
    pub row_count: u64,
}

/// One batch of rows; each cell is `None` for SQL NULL or `Some(text)` otherwise.
pub type RowBatch = Vec<Vec<Option<String>>>;

fn query_err(e: tokio_postgres::Error) -> PentaError {
    // Surface the real server-side message + SQLSTATE rather than the terse
    // "db error" that tokio-postgres' Display produces.
    let msg = match e.as_db_error() {
        Some(db) => format!("{}: {}", db.code().code(), db.message()),
        None => e.to_string(),
    };
    PentaError::Query(msg)
}

/// Execute `sql` and deliver rows to `on_batch` in chunks of `batch_size`.
///
/// Uses the extended protocol (`prepare` + `query_raw`) so column metadata is
/// known up front and rows stream lazily with backpressure. Returns the column
/// set and total row count.
pub async fn execute_stream<F>(
    client: &Client,
    sql: &str,
    batch_size: usize,
    mut on_batch: F,
) -> Result<QuerySummary>
where
    F: FnMut(RowBatch),
{
    let stmt = client.prepare(sql).await.map_err(query_err)?;
    let columns: Vec<ColumnMeta> = stmt
        .columns()
        .iter()
        .map(|c| ColumnMeta {
            name: c.name().to_string(),
            type_oid: c.type_().oid(),
            type_name: c.type_().name().to_string(),
        })
        .collect();
    let ncols = columns.len();

    // Empty Vec<String> sidesteps the dyn-ToSql inference issue for no-param calls.
    let params: Vec<String> = Vec::new();
    let stream = client.query_raw(&stmt, params).await.map_err(query_err)?;
    pin_mut!(stream);

    let batch_size = batch_size.max(1);
    let mut batch: RowBatch = Vec::with_capacity(batch_size);
    let mut row_count: u64 = 0;

    while let Some(row) = stream.try_next().await.map_err(query_err)? {
        let mut cells = Vec::with_capacity(ncols);
        for i in 0..ncols {
            cells.push(cell_to_text(&row, i));
        }
        batch.push(cells);
        row_count += 1;
        if batch.len() >= batch_size {
            on_batch(std::mem::take(&mut batch));
        }
    }
    if !batch.is_empty() {
        on_batch(batch);
    }

    Ok(QuerySummary { columns, row_count })
}

/// A cancellation handle for the connection. Hand this to the UI so a running
/// query on the tab's session can be stopped (Decision #3/#7).
pub fn cancel_token(client: &Client) -> CancelToken {
    client.cancel_token()
}

/// Issue a protocol-level cancel for whatever query is running on the token's
/// connection.
pub async fn cancel(token: CancelToken) -> Result<()> {
    token
        .cancel_query(NoTls)
        .await
        .map_err(|e| PentaError::Query(e.to_string()))
}

/// Decode `Option<T>` and stringify, returning `Err(())` if the column's wire
/// type doesn't match `T` (so the caller can fall back).
fn get_str<T>(row: &Row, idx: usize) -> std::result::Result<Option<String>, ()>
where
    T: FromSqlOwned + ToString,
{
    match row.try_get::<usize, Option<T>>(idx) {
        Ok(opt) => Ok(opt.map(|v| v.to_string())),
        Err(_) => Err(()),
    }
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Decode a one-dimensional Postgres array of `T` and render it as a canonical
/// `{a,b,NULL}` literal. Elements that contain array meta-characters are
/// double-quoted with `"`/`\` escaping, matching libpq's text output.
fn get_array<T>(row: &Row, idx: usize) -> std::result::Result<Option<String>, ()>
where
    T: FromSqlOwned + ToString,
{
    match row.try_get::<usize, Option<Vec<Option<T>>>>(idx) {
        Ok(opt) => Ok(opt.map(|v| {
            let mut out = String::from("{");
            for (i, el) in v.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                match el {
                    None => out.push_str("NULL"),
                    Some(x) => out.push_str(&quote_array_element(&x.to_string())),
                }
            }
            out.push('}');
            out
        })),
        Err(_) => Err(()),
    }
}

fn quote_array_element(s: &str) -> String {
    let needs_quote = s.is_empty()
        || s.eq_ignore_ascii_case("null")
        || s.chars()
            .any(|c| matches!(c, ',' | '{' | '}' | '"' | '\\') || c.is_whitespace());
    if !needs_quote {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        if c == '"' || c == '\\' {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('"');
    out
}

/// Convert a single cell to its canonical text form. Dispatches on the stable
/// pg_type OID; falls back to a text decode, then to an explicit marker for
/// types not yet handled (arrays, ranges, geo, etc. — broadened over time).
fn cell_to_text(row: &Row, idx: usize) -> Option<String> {
    let oid = row.columns()[idx].type_().oid();
    let res = match oid {
        16 => get_str::<bool>(row, idx),                    // bool
        21 => get_str::<i16>(row, idx),                     // int2
        23 => get_str::<i32>(row, idx),                     // int4
        20 => get_str::<i64>(row, idx),                     // int8
        26 | 28 | 29 => get_str::<u32>(row, idx),           // oid/xid/cid
        700 => get_str::<f32>(row, idx),                    // float4
        701 => get_str::<f64>(row, idx),                    // float8
        1700 => get_str::<rust_decimal::Decimal>(row, idx), // numeric
        25 | 1043 | 1042 | 19 | 18 | 705 => get_str::<String>(row, idx), // text/varchar/bpchar/name/char/unknown
        2950 => get_str::<uuid::Uuid>(row, idx),                         // uuid
        114 | 3802 => get_str::<serde_json::Value>(row, idx),            // json/jsonb
        1114 => get_str::<chrono::NaiveDateTime>(row, idx),              // timestamp
        1184 => get_str::<chrono::DateTime<chrono::Utc>>(row, idx),      // timestamptz
        1082 => get_str::<chrono::NaiveDate>(row, idx),                  // date
        1083 => get_str::<chrono::NaiveTime>(row, idx),                  // time
        17 => {
            return match row.try_get::<usize, Option<Vec<u8>>>(idx) {
                Ok(Some(b)) => Some(format!("\\x{}", hex(&b))),
                Ok(None) => None,
                Err(_) => Some("(bytea)".to_string()),
            };
        }
        // One-dimensional arrays of the common scalar types → `{...}` literal.
        1000 => get_array::<bool>(row, idx), // _bool
        1005 => get_array::<i16>(row, idx),  // _int2
        1007 => get_array::<i32>(row, idx),  // _int4
        1016 => get_array::<i64>(row, idx),  // _int8
        1021 => get_array::<f32>(row, idx),  // _float4
        1022 => get_array::<f64>(row, idx),  // _float8
        1231 => get_array::<rust_decimal::Decimal>(row, idx), // _numeric
        1009 | 1015 | 1014 => get_array::<String>(row, idx), // _text/_varchar/_bpchar
        2951 => get_array::<uuid::Uuid>(row, idx), // _uuid
        199 | 3807 => get_array::<serde_json::Value>(row, idx), // _json/_jsonb
        1028 => get_array::<u32>(row, idx),  // _oid
        _ => Err(()),
    };

    match res {
        Ok(v) => v,
        Err(()) => match row.try_get::<usize, Option<String>>(idx) {
            Ok(v) => v,
            Err(_) => Some(format!(
                "(unsupported {})",
                row.columns()[idx].type_().name()
            )),
        },
    }
}
