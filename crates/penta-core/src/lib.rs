//! penta-core: domain logic for Penta — connection management, PostgreSQL
//! introspection, query execution, data-grid edit generation and DDL services.
//!
//! This crate is deliberately UI- and transport-agnostic so it can back both
//! the desktop (Tauri) edition and the future server (Axum) edition unchanged.

pub mod ai;
pub mod connection;
pub mod error;
pub mod grid;
pub mod instance;
pub mod introspection;
pub mod io;
pub mod manager;
pub mod pg;
pub mod pool;
pub mod query;
pub mod safety;
pub mod store;

pub use error::{PentaError, Result};

/// Crate version, surfaced to the UI for diagnostics.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_non_empty() {
        assert!(!version().is_empty());
    }
}
