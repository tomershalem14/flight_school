//! Application errors surfaced to the frontend as strings.

use std::fmt::Display;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("SQLite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Database lock poisoned")]
    LockPoisoned,
    #[error("{0}")]
    Message(String),
    #[error("HTTP: {0}")]
    Http(String),
    #[error("CSV: {0}")]
    Csv(String),
}

impl AppError {
    pub fn msg(s: impl Display) -> Self {
        AppError::Message(s.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
