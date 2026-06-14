//! penta-vault: credential storage for Penta.
//!
//! Default backend = OS keychain (added in the vault work unit). An optional
//! master-password mode encrypts secrets (Argon2id -> AES-256-GCM) at rest in
//! the app SQLite database, with automatic fallback when no keychain exists.
//!
//! Invariant: secrets never leave this crate as plaintext except through the
//! `SecretStore` API, and are never logged.

pub mod crypto;
pub mod error;
pub mod keychain;
pub mod memory;

pub use error::{Result, VaultError};
pub use keychain::KeychainStore;
pub use memory::MemoryStore;

/// Kind of secret stored for a connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretKind {
    Password,
    SshKey,
    SslClientKey,
}

impl SecretKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            SecretKind::Password => "password",
            SecretKind::SshKey => "ssh_key",
            SecretKind::SslClientKey => "ssl_client_key",
        }
    }
}

/// Abstraction over secret backends: OS keychain, encrypted-at-rest
/// (master-password mode), and an in-memory store used in tests.
pub trait SecretStore: Send + Sync {
    fn store(&self, connection_id: &str, kind: SecretKind, secret: &str) -> Result<()>;
    fn get(&self, connection_id: &str, kind: SecretKind) -> Result<Option<String>>;
    fn delete(&self, connection_id: &str, kind: SecretKind) -> Result<()>;
}
