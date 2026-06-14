use thiserror::Error;

pub type Result<T> = std::result::Result<T, VaultError>;

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("vault is locked")]
    Locked,

    #[error("secret not found")]
    NotFound,

    #[error("keychain/backend error: {0}")]
    Backend(String),

    #[error("crypto error")]
    Crypto,
}
