use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum JetError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("ssh error: {0}")]
    Ssh(#[from] ssh2::Error),

    #[error("session not found: {0}")]
    SessionNotFound(String),

    #[error("invalid path: {0}")]
    InvalidPath(String),

    #[error("auth failed: {0}")]
    Auth(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for JetError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type JetResult<T> = Result<T, JetError>;
