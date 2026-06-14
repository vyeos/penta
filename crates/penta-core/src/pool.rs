//! Shared metadata/monitoring connection pool (Decision #3).
//!
//! Per-tab query sessions get their own sticky connection (see `manager`); this
//! deadpool-backed pool serves introspection + monitoring so background work
//! never competes with user sessions.

use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
use tokio_postgres::NoTls;

use crate::error::{PentaError, Result};

/// Build a metadata pool from a prepared `tokio_postgres::Config`.
pub fn build_pool(cfg: tokio_postgres::Config, max_size: usize) -> Result<Pool> {
    let mgr = Manager::from_config(
        cfg,
        NoTls,
        ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
        },
    );
    Pool::builder(mgr)
        .max_size(max_size.max(1))
        .build()
        .map_err(|e| PentaError::Internal(e.to_string()))
}
