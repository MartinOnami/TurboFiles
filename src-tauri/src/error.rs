//! Unified error type for TurboFiles.
//!
//! Every fallible operation returns [`Result<T>`]. Errors serialize to a stable
//! `{ code, message }` JSON shape so the frontend can branch on `code` (see
//! `src/lib/api.ts` `ApiError`). Never embed secrets in error messages.

use serde::Serialize;

/// Crate-wide result alias.
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("connection failed: {0}")]
    Connection(String),

    #[error("the server's TLS certificate could not be verified: {0}")]
    CertUntrusted(String),

    #[error("the server's SSH host key has changed: {0}")]
    HostKeyMismatch(String),

    #[error("authentication failed: {0}")]
    Auth(String),

    #[error("session not found: {0}")]
    SessionNotFound(String),

    #[error("transfer not found: {0}")]
    TransferNotFound(String),

    #[error("remote operation failed: {0}")]
    Remote(String),

    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),

    #[error("database error: {0}")]
    Db(String),

    #[error("keychain error: {0}")]
    Keychain(String),

    #[error("invalid input: {0}")]
    Invalid(String),
}

impl Error {
    /// Stable machine-readable code used by the frontend.
    pub fn code(&self) -> &'static str {
        match self {
            Error::Connection(_) => "CONNECTION",
            Error::CertUntrusted(_) => "CERT_UNTRUSTED",
            Error::HostKeyMismatch(_) => "HOST_KEY_MISMATCH",
            Error::Auth(_) => "AUTH",
            Error::SessionNotFound(_) => "SESSION_NOT_FOUND",
            Error::TransferNotFound(_) => "TRANSFER_NOT_FOUND",
            Error::Remote(_) => "REMOTE",
            Error::Io(_) => "IO",
            Error::Db(_) => "DB",
            Error::Keychain(_) => "KEYCHAIN",
            Error::Invalid(_) => "INVALID",
        }
    }
}

// Map third-party errors without leaking sensitive details.
impl From<ssh2::Error> for Error {
    fn from(e: ssh2::Error) -> Self {
        Error::Remote(e.message().to_string())
    }
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Db(e.to_string())
    }
}

/// Serialized representation sent to the frontend.
#[derive(Serialize)]
struct SerializedError {
    code: &'static str,
    message: String,
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        SerializedError {
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}
