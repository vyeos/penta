use thiserror::Error;

pub type Result<T> = std::result::Result<T, PentaError>;

/// Structured error type. Maps onto the `PentaError { code, pg_code, message,
/// hint, retryable }` envelope the UI expects across the IPC boundary.
#[derive(Debug, Error)]
pub enum PentaError {
    #[error("connection error: {0}")]
    Connection(String),

    #[error("query error: {0}")]
    Query(String),

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid input: {0}")]
    Invalid(String),

    #[error("unsupported: {0}")]
    Unsupported(String),

    #[error("internal error: {0}")]
    Internal(String),
}

impl PentaError {
    /// Stable machine-readable code for the UI error envelope.
    pub fn code(&self) -> &'static str {
        match self {
            PentaError::Connection(_) => "connection",
            PentaError::Query(_) => "query",
            PentaError::Conflict(_) => "conflict",
            PentaError::NotFound(_) => "not_found",
            PentaError::Invalid(_) => "invalid",
            PentaError::Unsupported(_) => "unsupported",
            PentaError::Internal(_) => "internal",
        }
    }

    /// Whether the operation is worth retrying as-is.
    pub fn retryable(&self) -> bool {
        matches!(self, PentaError::Connection(_))
    }
}
