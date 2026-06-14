//! Data import/export (§22): COPY-based CSV streamed through Rust.
//!
//! We drive `COPY … TO/FROM STDOUT/STDIN` over the live connection rather than
//! `COPY … TO 'file'` so it works against remote servers and streams to/from
//! disk without buffering the whole dataset in memory (Decision #28).

use futures_util::{pin_mut, SinkExt, TryStreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_postgres::Client;

use crate::error::{PentaError, Result};
use crate::grid::quote_ident;

fn copy_err(e: tokio_postgres::Error) -> PentaError {
    match e.as_db_error() {
        Some(db) => PentaError::Query(format!("{}: {}", db.code().code(), db.message())),
        None => PentaError::Query(e.to_string()),
    }
}

async fn create_file(path: &str) -> Result<tokio::fs::File> {
    tokio::fs::File::create(path)
        .await
        .map_err(|e| PentaError::Invalid(format!("cannot write {path}: {e}")))
}

/// Stream a whole table to a CSV file (with a header row). Returns bytes written.
pub async fn export_table_csv(
    client: &Client,
    schema: &str,
    table: &str,
    path: &str,
) -> Result<u64> {
    let qual = format!("{}.{}", quote_ident(schema), quote_ident(table));
    let sql = format!("COPY {qual} TO STDOUT WITH (FORMAT csv, HEADER true)");
    copy_out_to_file(client, &sql, path).await
}

/// Stream the result of an arbitrary `SELECT` to a CSV file. Returns bytes.
pub async fn export_query_csv(client: &Client, query: &str, path: &str) -> Result<u64> {
    // `COPY (query) TO STDOUT` accepts any single SELECT; trim a trailing `;`.
    let q = query.trim().trim_end_matches(';');
    let sql = format!("COPY ({q}) TO STDOUT WITH (FORMAT csv, HEADER true)");
    copy_out_to_file(client, &sql, path).await
}

async fn copy_out_to_file(client: &Client, sql: &str, path: &str) -> Result<u64> {
    let stream = client.copy_out(sql).await.map_err(copy_err)?;
    pin_mut!(stream);
    let mut file = create_file(path).await?;
    let mut written: u64 = 0;
    while let Some(chunk) = stream.try_next().await.map_err(copy_err)? {
        file.write_all(&chunk)
            .await
            .map_err(|e| PentaError::Internal(format!("write: {e}")))?;
        written += chunk.len() as u64;
    }
    file.flush()
        .await
        .map_err(|e| PentaError::Internal(format!("flush: {e}")))?;
    Ok(written)
}

/// Outcome of a CSV import.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportOutcome {
    pub rows: u64,
}

/// Load a CSV file into a table via `COPY … FROM STDIN`, streaming the file in
/// chunks. `header` skips the first row. Returns the number of rows loaded.
pub async fn import_table_csv(
    client: &Client,
    schema: &str,
    table: &str,
    path: &str,
    header: bool,
) -> Result<ImportOutcome> {
    let qual = format!("{}.{}", quote_ident(schema), quote_ident(table));
    let header_opt = if header { "true" } else { "false" };
    let sql = format!("COPY {qual} FROM STDIN WITH (FORMAT csv, HEADER {header_opt})");

    let sink = client.copy_in(&sql).await.map_err(copy_err)?;
    pin_mut!(sink);

    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| PentaError::Invalid(format!("cannot read {path}: {e}")))?;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .await
            .map_err(|e| PentaError::Internal(format!("read: {e}")))?;
        if n == 0 {
            break;
        }
        sink.send(bytes::Bytes::copy_from_slice(&buf[..n]))
            .await
            .map_err(copy_err)?;
    }
    let rows = sink.finish().await.map_err(copy_err)?;
    Ok(ImportOutcome { rows })
}
