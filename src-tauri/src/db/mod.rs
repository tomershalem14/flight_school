//! SQLite connection, migrations, and app-managed state.

mod seed;

use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    #[allow(dead_code)]
    pub db_path: PathBuf,
    conn: Mutex<Connection>,
}

impl AppState {
    pub fn open(db_path: PathBuf) -> AppResult<Self> {
        let conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;",
        )?;
        apply_schema(&conn)?;
        seed::seed_if_empty(&conn)?;
        Ok(Self {
            db_path: db_path.clone(),
            conn: Mutex::new(conn),
        })
    }

    /// Run `f` with an exclusive lock on the DB connection.
    pub fn with_db<R>(&self, f: impl FnOnce(&Connection) -> AppResult<R>) -> AppResult<R> {
        let guard = self.conn.lock().map_err(|_| AppError::LockPoisoned)?;
        f(&guard)
    }

    /// Mutable access (transactions, bulk writes).
    pub fn with_db_mut<R>(&self, f: impl FnOnce(&mut Connection) -> AppResult<R>) -> AppResult<R> {
        let mut guard = self.conn.lock().map_err(|_| AppError::LockPoisoned)?;
        f(&mut guard)
    }
}

fn apply_schema(conn: &Connection) -> AppResult<()> {
    const INITIAL: &str = include_str!("../../migrations/001_initial.sql");
    conn.execute_batch(INITIAL)?;
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)",
        [],
    )?;

    let v2: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 2",
        [],
        |r| r.get(0),
    )?;
    if v2 == 0 {
        const M2: &str = include_str!("../../migrations/002_shift_type_coverage.sql");
        conn.execute_batch(M2)?;
        conn.execute("INSERT INTO schema_migrations (version) VALUES (2)", [])?;
    }

    let v3: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 3",
        [],
        |r| r.get(0),
    )?;
    if v3 == 0 {
        const M3: &str = include_str!("../../migrations/003_shifts_drop_meta.sql");
        conn.execute_batch(M3)?;
        conn.execute("INSERT INTO schema_migrations (version) VALUES (3)", [])?;
    }

    Ok(())
}
