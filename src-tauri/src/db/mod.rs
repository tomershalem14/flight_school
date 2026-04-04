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

    let v4: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 4",
        [],
        |r| r.get(0),
    )?;
    if v4 == 0 {
        migrate_employees_employee_type_v4(conn)?;
        conn.execute("INSERT INTO schema_migrations (version) VALUES (4)", [])?;
    }

    let v5: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 5",
        [],
        |r| r.get(0),
    )?;
    if v5 == 0 {
        const M5: &str = include_str!("../../migrations/005_affiliation_regular_only.sql");
        conn.execute_batch(M5)?;
        conn.execute("INSERT INTO schema_migrations (version) VALUES (5)", [])?;
    }

    let v6: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 6",
        [],
        |r| r.get(0),
    )?;
    if v6 == 0 {
        migrate_roles_role_level_v6(conn)?;
        conn.execute("INSERT INTO schema_migrations (version) VALUES (6)", [])?;
    }

    let v7: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 7",
        [],
        |r| r.get(0),
    )?;
    if v7 == 0 {
        migrate_employees_affiliation_leader_v7(conn)?;
        conn.execute("INSERT INTO schema_migrations (version) VALUES (7)", [])?;
    }

    Ok(())
}

/// Old DBs: add `role_level` / `special_list`, backfill sort order, drop legacy flags.
/// Fresh DBs from updated `001_initial.sql` already have the new columns — no-op.
fn migrate_roles_role_level_v6(conn: &Connection) -> AppResult<()> {
    let cols = roles_column_names(conn)?;
    if cols.iter().any(|c| c == "role_level") {
        return Ok(());
    }
    conn.execute(
        "ALTER TABLE roles ADD COLUMN role_level INTEGER NOT NULL DEFAULT 0",
        [],
    )?;
    conn.execute(
        "ALTER TABLE roles ADD COLUMN special_list TEXT NOT NULL DEFAULT ''",
        [],
    )?;
    conn.execute(
        "UPDATE roles SET role_level = 10 WHERE is_management = 1",
        [],
    )?;
    conn.execute("ALTER TABLE roles DROP COLUMN can_fly", [])?;
    conn.execute("ALTER TABLE roles DROP COLUMN is_management", [])?;
    Ok(())
}

fn roles_column_names(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("PRAGMA table_info(roles)")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

fn employees_column_names(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("PRAGMA table_info(employees)")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Add `affiliation_leader`; fresh `001_initial` already includes it.
fn migrate_employees_affiliation_leader_v7(conn: &Connection) -> AppResult<()> {
    let cols = employees_column_names(conn)?;
    if cols.iter().any(|c| c == "affiliation_leader") {
        return Ok(());
    }
    conn.execute(
        "ALTER TABLE employees ADD COLUMN affiliation_leader INTEGER NOT NULL DEFAULT 0",
        [],
    )?;
    Ok(())
}

/// Replace `always_present` with `employee_type` on databases created before 001 was updated.
fn migrate_employees_employee_type_v4(conn: &Connection) -> AppResult<()> {
    let cols = employees_column_names(conn)?;
    let has_ap = cols.iter().any(|c| c == "always_present");
    let has_et = cols.iter().any(|c| c == "employee_type");
    if has_ap && !has_et {
        conn.execute(
            "ALTER TABLE employees ADD COLUMN employee_type TEXT NOT NULL DEFAULT 'regular'",
            [],
        )?;
        conn.execute("ALTER TABLE employees DROP COLUMN always_present", [])?;
    } else if !has_et {
        conn.execute(
            "ALTER TABLE employees ADD COLUMN employee_type TEXT NOT NULL DEFAULT 'regular'",
            [],
        )?;
    }
    Ok(())
}
