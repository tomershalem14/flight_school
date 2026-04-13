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
        let mut conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;",
        )?;
        apply_schema(&mut conn)?;
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

fn apply_schema(conn: &mut Connection) -> AppResult<()> {
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
        if table_exists(conn, "shift_types")? {
            const M2: &str = include_str!("../../migrations/002_shift_type_coverage.sql");
            conn.execute_batch(M2)?;
        }
        conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (2)", [])?;
    }

    let v3: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 3",
        [],
        |r| r.get(0),
    )?;
    if v3 == 0 {
        if shifts_has_column(conn, "notes")? {
            const M3: &str = include_str!("../../migrations/003_shifts_drop_meta.sql");
            conn.execute_batch(M3)?;
        }
        conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (3)", [])?;
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
        conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (7)", [])?;
    }

    let v8: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 8",
        [],
        |r| r.get(0),
    )?;
    if v8 == 0 && legacy_shift_types_to_windows_needed(conn)? {
        migrate_shift_windows_syllabus_v8(conn)?;
        conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (8)", [])?;
    } else if v8 == 0 {
        conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (8)", [])?;
    }

    let v9: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 9",
        [],
        |r| r.get(0),
    )?;
    if v9 == 0 {
        migrate_syllabus_preset_unique_name_v9(conn)?;
        conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (9)", [])?;
    }

    let v10: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 10",
        [],
        |r| r.get(0),
    )?;
    if v10 == 0 {
        repair_shifts_shift_window_columns_v10(conn)?;
        conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (10)", [])?;
    }

    let v11: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 11",
        [],
        |r| r.get(0),
    )?;
    if v11 == 0 {
        if table_exists(conn, "shifts")? && !shifts_has_column(conn, "up_to_date")? {
            conn.execute(
                "ALTER TABLE shifts ADD COLUMN up_to_date INTEGER NOT NULL DEFAULT 1",
                [],
            )?;
        }
        conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (11)", [])?;
    }

    let v12: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 12",
        [],
        |r| r.get(0),
    )?;
    if v12 == 0 {
        migrate_shifts_repair_foreign_keys_v12(conn)?;
        conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (12)", [])?;
    }

    let v13: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 13",
        [],
        |r| r.get(0),
    )?;
    if v13 == 0 {
        migrate_shifts_syllabus_num_v13(conn)?;
        conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (13)", [])?;
    }

    let v14: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 14",
        [],
        |r| r.get(0),
    )?;
    if v14 == 0 {
        migrate_syllabus_presets_rest_columns_v14(conn)?;
        conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (14)", [])?;
    }

    let v15: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 15",
        [],
        |r| r.get(0),
    )?;
    if v15 == 0 {
        migrate_shifts_prep_end_rest_start_v15(conn)?;
        conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (15)", [])?;
    }

    let v16: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 16",
        [],
        |r| r.get(0),
    )?;
    if v16 == 0 {
        migrate_syllabus_roles_v16(conn)?;
        conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (16)", [])?;
    }

    let v17: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 17",
        [],
        |r| r.get(0),
    )?;
    if v17 == 0 {
        migrate_shifts_syllabus_role_v17(conn)?;
        conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (17)", [])?;
    }

    Ok(())
}

/// v10 `RENAME COLUMN shift_type_id TO shift_window_id` can leave the FK still targeting
/// `shift_types`. New inserts then fail with "FOREIGN KEY constraint failed" even though
/// `shift_windows` has the row. Rebuild `shifts` with correct references.
fn shifts_foreign_keys_point_at_legacy_targets(conn: &Connection) -> AppResult<bool> {
    if !table_exists(conn, "shifts")? {
        return Ok(false);
    }
    let mut stmt = conn.prepare("PRAGMA foreign_key_list(shifts)")?;
    let rows = stmt.query_map([], |r| -> rusqlite::Result<(String, String)> {
        let ref_table: String = r.get(2)?;
        let from_col: String = r.get(3)?;
        Ok((from_col, ref_table))
    })?;
    for row in rows {
        let (from_col, ref_table) = row?;
        match from_col.as_str() {
            "shift_window_id" if ref_table.as_str() != "shift_windows" => return Ok(true),
            "syllabus_preset_id" if ref_table.as_str() != "syllabus_presets" => return Ok(true),
            "employee_id" if ref_table.as_str() != "employees" => return Ok(true),
            _ => {}
        }
    }
    Ok(false)
}

fn migrate_shifts_repair_foreign_keys_v12(conn: &mut Connection) -> AppResult<()> {
    use rusqlite::params;

    if !table_exists(conn, "shifts")? {
        return Ok(());
    }
    if !table_exists(conn, "shift_windows")? || !table_exists(conn, "syllabus_presets")? {
        return Ok(());
    }
    if !shifts_foreign_keys_point_at_legacy_targets(conn)? {
        return Ok(());
    }

    let cols = shifts_column_names(conn)?;
    if !cols.iter().any(|c| c == "up_to_date") {
        return Err(AppError::msg(
            "מסד לא עקבי: חסרה עמודת up_to_date בטבלת shifts — הרץ את האפליקציה עם גרסה שמכילה מיגרציה 11.",
        ));
    }

    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    let tx = conn.transaction()?;

    tx.execute(
        "CREATE TABLE shifts__fkfix (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shift_date TEXT NOT NULL,
            shift_window_id INTEGER NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            syllabus_preset_id INTEGER NOT NULL,
            prep_start TEXT NOT NULL,
            rest_end TEXT NOT NULL,
            employee_id INTEGER,
            created_at TEXT DEFAULT (datetime('now')),
            up_to_date INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (shift_window_id) REFERENCES shift_windows(id),
            FOREIGN KEY (syllabus_preset_id) REFERENCES syllabus_presets(id),
            FOREIGN KEY (employee_id) REFERENCES employees(id)
        )",
        [],
    )?;

    tx.execute(
        "INSERT INTO shifts__fkfix (id, shift_date, shift_window_id, start_time, end_time, syllabus_preset_id, prep_start, rest_end, employee_id, created_at, up_to_date)
         SELECT id, shift_date, shift_window_id, start_time, end_time, syllabus_preset_id, prep_start, rest_end, employee_id, COALESCE(created_at, datetime('now')), up_to_date FROM shifts",
        [],
    )?;

    let max_id: i64 = tx.query_row(
        "SELECT COALESCE(MAX(id), 0) FROM shifts__fkfix",
        [],
        |r| r.get(0),
    )?;

    tx.execute("DROP TABLE shifts", [])?;
    tx.execute("ALTER TABLE shifts__fkfix RENAME TO shifts", [])?;

    if table_exists(&*tx, "sqlite_sequence")? {
        let _ = tx.execute(
            "INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('shifts', ?1)",
            params![max_id],
        );
    }

    tx.commit()?;
    conn.execute_batch("PRAGMA foreign_keys = ON")?;
    Ok(())
}

/// Resolve syllabus + prep/rest; if `shift_window_id` has no matching row, use the first window.
fn resolve_shift_backfill_window(
    conn: &Connection,
    shift_window_id: i64,
    shift_date: &str,
    start_time: &str,
    end_time: &str,
) -> AppResult<(i64, i64, String, String)> {
    use crate::domain::syllabus::resolve_shift_syllabus_and_boundaries;

    match resolve_shift_syllabus_and_boundaries(
        conn,
        shift_window_id,
        shift_date,
        start_time,
        end_time,
    ) {
        Ok((pid, ps, re)) => Ok((shift_window_id, pid, ps, re)),
        Err(msg) if msg.contains("חלון משמרת לא נמצא") => {
            let first_wid: i64 = conn
                .query_row(
                    "SELECT id FROM shift_windows ORDER BY id LIMIT 1",
                    [],
                    |r| r.get(0),
                )
                .map_err(|_| {
                    AppError::msg(
                        "מסד לא עקבי: יש משמרות עם חלון חסר ואין חלונות משמרת. הוסף חלון בלוח או שחזר גיבוי.",
                    )
                })?;
            let (pid, ps, re) = resolve_shift_syllabus_and_boundaries(
                conn,
                first_wid,
                shift_date,
                start_time,
                end_time,
            )
            .map_err(AppError::msg)?;
            Ok((first_wid, pid, ps, re))
        }
        Err(msg) => Err(AppError::msg(msg)),
    }
}

/// DBs where v8 was skipped (`shift_windows` exists but `shifts` still uses `shift_type_id`) or
/// syllabus columns were never added — align `shifts` with what the app expects.
fn repair_shifts_shift_window_columns_v10(conn: &mut Connection) -> AppResult<()> {
    // After RENAME COLUMN, the FK may still point at shift_types while ids must match shift_windows.
    // Same approach as v8: turn foreign keys off for the repair block.
    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    let res = repair_shifts_shift_window_columns_v10_inner(conn);
    conn.execute_batch("PRAGMA foreign_keys = ON")?;
    res
}

fn repair_shifts_shift_window_columns_v10_inner(conn: &mut Connection) -> AppResult<()> {
    use rusqlite::params;

    if !table_exists(conn, "shifts")? {
        return Ok(());
    }

    let mut cols = shifts_column_names(conn)?;
    let has_type = cols.iter().any(|c| c == "shift_type_id");
    let has_window = cols.iter().any(|c| c == "shift_window_id");

    if has_type && !has_window {
        if !table_exists(conn, "shift_windows")? {
            return Err(AppError::msg(
                "מסד נתונים לא עקבי: יש shift_type_id בטבלת shifts אך אין shift_windows.",
            ));
        }
        conn.execute(
            "ALTER TABLE shifts RENAME COLUMN shift_type_id TO shift_window_id",
            [],
        )?;
        cols = shifts_column_names(conn)?;
    }

    if !cols.iter().any(|c| c == "syllabus_preset_id") {
        if !table_exists(conn, "syllabus_presets")? {
            return Err(AppError::msg(
                "מסד נתונים לא עקבי: חסרה טבלת syllabus_presets.",
            ));
        }
        conn.execute("ALTER TABLE shifts ADD COLUMN syllabus_preset_id INTEGER", [])?;
        conn.execute(
            "ALTER TABLE shifts ADD COLUMN prep_start TEXT NOT NULL DEFAULT '00:00'",
            [],
        )?;
        conn.execute(
            "ALTER TABLE shifts ADD COLUMN rest_end TEXT NOT NULL DEFAULT '00:00'",
            [],
        )?;
    }

    let mut stmt = conn.prepare(
        "SELECT id, shift_window_id, shift_date, start_time, end_time FROM shifts WHERE syllabus_preset_id IS NULL",
    )?;
    let rows: Vec<(i64, i64, String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
        .filter_map(|x| x.ok())
        .collect();
    drop(stmt);

    for (sid, wid, sd, st, et) in rows {
        let (use_wid, pid, ps, re) = resolve_shift_backfill_window(conn, wid, &sd, &st, &et)?;
        if use_wid != wid {
            conn.execute(
                "UPDATE shifts SET shift_window_id = ?1 WHERE id = ?2",
                params![use_wid, sid],
            )?;
        }
        conn.execute(
            "UPDATE shifts SET syllabus_preset_id = ?1, prep_start = ?2, rest_end = ?3 WHERE id = ?4",
            params![pid, ps, re, sid],
        )?;
    }

    Ok(())
}

/// Deduplicate `syllabus_presets.name` (exact match after trim), then add a unique index.
fn migrate_syllabus_preset_unique_name_v9(conn: &Connection) -> AppResult<()> {
    use rusqlite::params;
    use std::collections::HashSet;

    if !table_exists(conn, "syllabus_presets")? {
        return Ok(());
    }
    let idx: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_syllabus_presets_name_unique'",
        [],
        |r| r.get(0),
    )?;
    if idx > 0 {
        return Ok(());
    }

    let mut stmt = conn.prepare("SELECT id, name FROM syllabus_presets ORDER BY id")?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|x| x.ok())
        .collect();
    drop(stmt);

    let mut seen_fold: HashSet<String> = HashSet::new();
    for (id, name) in rows {
        let key = name.trim().to_string();
        if key.is_empty() {
            continue;
        }
        let fold = key.to_lowercase();
        if seen_fold.contains(&fold) {
            let mut new_name = format!("{} ({})", key, id);
            let mut bump = 0u32;
            loop {
                let new_fold = new_name.to_lowercase();
                let in_seen = seen_fold.contains(&new_fold);
                let in_db: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM syllabus_presets WHERE name = ?1 COLLATE NOCASE AND id != ?2",
                    params![&new_name, id],
                    |r| r.get(0),
                )?;
                if !in_seen && in_db == 0 {
                    break;
                }
                bump += 1;
                new_name = format!("{} ({}) #{}", key, id, bump);
                if bump > 1000 {
                    return Err(crate::error::AppError::msg(
                        "ייבוא סילבוסים: לא ניתן לייצר שם ייחודי",
                    ));
                }
            }
            conn.execute(
                "UPDATE syllabus_presets SET name = ?1 WHERE id = ?2",
                params![&new_name, id],
            )?;
            seen_fold.insert(new_name.to_lowercase());
        } else {
            seen_fold.insert(fold);
        }
    }

    conn.execute(
        "CREATE UNIQUE INDEX idx_syllabus_presets_name_unique ON syllabus_presets(name COLLATE NOCASE)",
        [],
    )?;
    Ok(())
}

fn table_exists(conn: &Connection, name: &str) -> AppResult<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [name],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

fn legacy_shift_types_to_windows_needed(conn: &Connection) -> AppResult<bool> {
    Ok(table_exists(conn, "shift_types")? && !table_exists(conn, "shift_windows")?)
}

fn shifts_has_column(conn: &Connection, col: &str) -> AppResult<bool> {
    if !table_exists(conn, "shifts")? {
        return Ok(false);
    }
    let cols = shifts_column_names(conn)?;
    Ok(cols.iter().any(|c| c == col))
}

fn shifts_column_names(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("PRAGMA table_info(shifts)")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Legacy DB: `shift_types` → `shift_windows` + `syllabus_presets`, shifts columns + backfill.
fn migrate_shift_windows_syllabus_v8(conn: &mut Connection) -> AppResult<()> {
    use crate::domain::syllabus::{
        coverage_daily_span_minutes, floor_slot_count, json_preset_slot_array,
        DEFAULT_SLOT_MINUTES,
    };
    use rusqlite::params;
    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    let tx = conn.transaction()?;

    tx.execute(
        "CREATE TABLE syllabus_presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            min_role_id INTEGER,
            duration_minutes INTEGER NOT NULL,
            prep_minutes INTEGER NOT NULL DEFAULT 0,
            rest_minutes INTEGER NOT NULL DEFAULT 0,
            max_in_row INTEGER NOT NULL DEFAULT 1 CHECK (max_in_row >= 1),
            joint_prep INTEGER NOT NULL DEFAULT 0,
            joint_rest INTEGER NOT NULL DEFAULT 0,
            notes TEXT,
            system_locked INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (min_role_id) REFERENCES roles(id)
        )",
        [],
    )?;

    tx.execute(
        "INSERT INTO syllabus_presets (name, min_role_id, duration_minutes, prep_minutes, rest_minutes, max_in_row, joint_prep, joint_rest, system_locked)
         VALUES ('ברירת מחדל', NULL, 60, 0, 0, 1, 0, 0, 1)",
        [],
    )?;
    let def_id: i64 = tx.last_insert_rowid();

    tx.execute(
        "CREATE TABLE shift_windows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            color TEXT DEFAULT '#6366F1',
            notes TEXT,
            coverage_start TEXT NOT NULL,
            coverage_end TEXT NOT NULL,
            syllabus_slot_preset_ids TEXT NOT NULL DEFAULT '[]'
        )",
        [],
    )?;

    {
        let mut stmt = tx.prepare(
            "SELECT id, name, color, notes, coverage_start, coverage_end FROM shift_types",
        )?;
        let rows: Vec<(i64, String, String, Option<String>, String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
            .filter_map(|x| x.ok())
            .collect();
        drop(stmt);

        for (id, name, color, notes, cs, ce) in rows {
            let span = coverage_daily_span_minutes(&cs, &ce)
                .map_err(|e| crate::error::AppError::msg(e))?;
            let n = floor_slot_count(span, DEFAULT_SLOT_MINUTES);
            let json = json_preset_slot_array(def_id, n);
            tx.execute(
                "INSERT INTO shift_windows (id, name, color, notes, coverage_start, coverage_end, syllabus_slot_preset_ids)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, name, color, notes, cs, ce, json],
            )?;
        }
    }

    let max_sw: i64 = tx.query_row(
        "SELECT COALESCE(MAX(id), 0) FROM shift_windows",
        [],
        |r| r.get(0),
    )?;
    if table_exists(&*tx, "sqlite_sequence")? {
        let _ = tx.execute(
            "INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('shift_windows', ?1)",
            [max_sw],
        );
    }

    tx.execute(
        "CREATE TABLE shifts_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shift_date TEXT NOT NULL,
            shift_window_id INTEGER NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            syllabus_preset_id INTEGER NOT NULL,
            prep_start TEXT NOT NULL,
            rest_end TEXT NOT NULL,
            employee_id INTEGER,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (shift_window_id) REFERENCES shift_windows(id),
            FOREIGN KEY (syllabus_preset_id) REFERENCES syllabus_presets(id),
            FOREIGN KEY (employee_id) REFERENCES employees(id)
        )",
        [],
    )?;

    {
        let mut stmt = tx.prepare(
            "SELECT id, shift_date, shift_type_id, start_time, end_time, employee_id, created_at FROM shifts",
        )?;
        let rows: Vec<(i64, String, i64, String, String, Option<i64>, Option<String>)> = stmt
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            })?
            .filter_map(|x| x.ok())
            .collect();
        drop(stmt);

        for (sid, sd, wid, st, et, emp, created) in rows {
            let (use_wid, pid, ps, re) =
                resolve_shift_backfill_window(&*tx, wid, &sd, &st, &et)?;
            tx.execute(
                "INSERT INTO shifts_new (id, shift_date, shift_window_id, start_time, end_time, syllabus_preset_id, prep_start, rest_end, employee_id, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, COALESCE(?10, datetime('now')))",
                params![sid, sd, use_wid, st, et, pid, ps, re, emp, created],
            )?;
        }
    }

    let max_sh: i64 = tx.query_row(
        "SELECT COALESCE(MAX(id), 0) FROM shifts_new",
        [],
        |r| r.get(0),
    )?;

    tx.execute("DROP TABLE shifts", [])?;
    tx.execute("ALTER TABLE shifts_new RENAME TO shifts", [])?;

    if table_exists(&*tx, "sqlite_sequence")? {
        let _ = tx.execute(
            "INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('shifts', ?1)",
            [max_sh],
        );
    }

    tx.execute("DROP TABLE shift_types", [])?;

    tx.commit()?;
    conn.execute_batch("PRAGMA foreign_keys = ON")?;
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

fn syllabus_presets_column_names(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("PRAGMA table_info(syllabus_presets)")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Denormalized prep/rest inner boundaries on each shift row.
fn migrate_shifts_prep_end_rest_start_v15(conn: &Connection) -> AppResult<()> {
    use crate::domain::syllabus::compute_prep_end_rest_start;
    use rusqlite::params;

    if !table_exists(conn, "shifts")? {
        return Ok(());
    }
    if shifts_has_column(conn, "prep_end")? {
        return Ok(());
    }
    conn.execute(
        "ALTER TABLE shifts ADD COLUMN prep_end TEXT NOT NULL DEFAULT '00:00'",
        [],
    )?;
    conn.execute(
        "ALTER TABLE shifts ADD COLUMN rest_start TEXT NOT NULL DEFAULT '00:00'",
        [],
    )?;

    let mut stmt = conn.prepare(
        "SELECT s.id, s.prep_start, s.rest_end, sp.prep_minutes, sp.rest_minutes
         FROM shifts s
         JOIN syllabus_presets sp ON s.syllabus_preset_id = sp.id",
    )?;
    let rows: Vec<(i64, String, String, i64, i64)> = stmt
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    for (id, ps, re, pm, rm) in rows {
        let pm_i = i32::try_from(pm).unwrap_or(0);
        let rm_i = i32::try_from(rm).unwrap_or(0);
        let (pe, rs) = compute_prep_end_rest_start(&ps, &re, pm_i, rm_i);
        conn.execute(
            "UPDATE shifts SET prep_end = ?1, rest_start = ?2 WHERE id = ?3",
            params![pe, rs, id],
        )?;
    }
    Ok(())
}

/// `syllabus_roles` child rows; drop `syllabus_presets.min_role_id`.
/// `shifts.syllabus_role_id` + partial unique index; backfill including multi-assignee slots.
fn migrate_shifts_syllabus_role_v17(conn: &mut Connection) -> AppResult<()> {
    use rusqlite::params;
    use std::collections::{HashMap, HashSet};

    if !table_exists(conn, "shifts")? {
        return Ok(());
    }
    if shifts_has_column(conn, "syllabus_role_id")? {
        return Ok(());
    }
    if !table_exists(conn, "syllabus_roles")? {
        return Ok(());
    }

    conn.execute(
        "ALTER TABLE shifts ADD COLUMN syllabus_role_id INTEGER REFERENCES syllabus_roles(id)",
        [],
    )?;

    let mut preset_roles: HashMap<i64, Vec<i64>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT syllabus_preset_id, id FROM syllabus_roles ORDER BY syllabus_preset_id, sort_order, id",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows {
            let (pid, rid) = row?;
            preset_roles.entry(pid).or_default().push(rid);
        }
    }

    let mut stmt = conn.prepare(
        "SELECT id, shift_date, shift_window_id, syllabus_num, syllabus_preset_id
         FROM shifts WHERE employee_id IS NOT NULL
         ORDER BY shift_date, shift_window_id, syllabus_num, id",
    )?;
    let rows: Vec<(i64, String, i64, i64, i64)> = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut i = 0usize;
    while i < rows.len() {
        let (date, wid, sn) = (rows[i].1.clone(), rows[i].2, rows[i].3);
        let mut j = i + 1;
        while j < rows.len() && rows[j].1 == date && rows[j].2 == wid && rows[j].3 == sn {
            j += 1;
        }
        let group = &rows[i..j];
        let presets: HashSet<i64> = group.iter().map(|r| r.4).collect();
        if presets.len() != 1 {
            return Err(AppError::msg(
                "מיגרציה 17: סילבוסים שונים לאותו סלוט — תקן את המסד לפני העדכון",
            ));
        }
        let preset_id = group[0].4;
        let role_list = preset_roles.get(&preset_id).map(|v| v.as_slice()).unwrap_or(&[]);
        if group.len() > role_list.len() {
            return Err(AppError::msg(
                "מיגרציה 17: יותר מדי משמרות מאוישות באותו סלוט ביחס למספר תפקידי הסילבוס",
            ));
        }
        for (k, r) in group.iter().enumerate() {
            let role_id = role_list[k];
            conn.execute(
                "UPDATE shifts SET syllabus_role_id = ?1 WHERE id = ?2",
                params![role_id, r.0],
            )?;
        }
        i = j;
    }

    conn.execute(
        "UPDATE shifts SET syllabus_role_id = (
            SELECT sr.id FROM syllabus_roles sr
            WHERE sr.syllabus_preset_id = shifts.syllabus_preset_id
            ORDER BY sr.sort_order, sr.id LIMIT 1
        ) WHERE syllabus_role_id IS NULL",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_slot_role_unique
         ON shifts(shift_date, shift_window_id, syllabus_num, syllabus_role_id)
         WHERE employee_id IS NOT NULL",
        [],
    )?;

    Ok(())
}

fn migrate_syllabus_roles_v16(conn: &mut Connection) -> AppResult<()> {
    use rusqlite::params;

    if !table_exists(conn, "syllabus_presets")? {
        return Ok(());
    }
    if table_exists(conn, "syllabus_roles")? {
        return Ok(());
    }

    let cols = syllabus_presets_column_names(conn)?;
    let has_min_role = cols.iter().any(|c| c == "min_role_id");

    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    let tx = conn.transaction()?;

    tx.execute(
        "CREATE TABLE syllabus_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            role_id INTEGER,
            special TEXT NOT NULL DEFAULT '',
            syllabus_preset_id INTEGER NOT NULL,
            sort_order INTEGER NOT NULL,
            FOREIGN KEY (role_id) REFERENCES roles(id),
            FOREIGN KEY (syllabus_preset_id) REFERENCES syllabus_presets(id) ON DELETE CASCADE
        )",
        [],
    )?;

    if has_min_role {
        let mut stmt = tx.prepare("SELECT id, min_role_id FROM syllabus_presets ORDER BY id")?;
        let rows: Vec<(i64, Option<i64>)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|x| x.ok())
            .collect();
        drop(stmt);
        for (preset_id, min_rid) in rows {
            tx.execute(
                "INSERT INTO syllabus_roles (name, role_id, special, syllabus_preset_id, sort_order)
                 VALUES ('', ?1, '', ?2, 0)",
                params![min_rid, preset_id],
            )?;
        }

        tx.execute(
            "CREATE TABLE syllabus_presets__v16 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL,
                prep_minutes INTEGER NOT NULL DEFAULT 0,
                rest_minutes INTEGER NOT NULL DEFAULT 0,
                max_in_row INTEGER NOT NULL DEFAULT 1 CHECK (max_in_row >= 1),
                joint_prep INTEGER NOT NULL DEFAULT 0,
                joint_rest INTEGER NOT NULL DEFAULT 0,
                notes TEXT,
                system_locked INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )?;
        tx.execute(
            "INSERT INTO syllabus_presets__v16 (
                id, name, duration_minutes, prep_minutes, rest_minutes,
                max_in_row, joint_prep, joint_rest, notes, system_locked
            )
            SELECT id, name, duration_minutes, prep_minutes, rest_minutes,
                   max_in_row, joint_prep, joint_rest, notes, system_locked
            FROM syllabus_presets",
            [],
        )?;
        let max_id: i64 = tx.query_row(
            "SELECT COALESCE(MAX(id), 0) FROM syllabus_presets__v16",
            [],
            |r| r.get(0),
        )?;
        tx.execute("DROP TABLE syllabus_presets", [])?;
        tx.execute(
            "ALTER TABLE syllabus_presets__v16 RENAME TO syllabus_presets",
            [],
        )?;
        if table_exists(&*tx, "sqlite_sequence")? {
            let _ = tx.execute(
                "INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('syllabus_presets', ?1)",
                [max_id],
            );
        }
        tx.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_syllabus_presets_name_unique ON syllabus_presets(name COLLATE NOCASE)",
            [],
        )?;
    } else {
        let mut stmt = tx.prepare("SELECT id FROM syllabus_presets ORDER BY id")?;
        let ids: Vec<i64> = stmt
            .query_map([], |r| r.get(0))?
            .filter_map(|x| x.ok())
            .collect();
        drop(stmt);
        for preset_id in ids {
            tx.execute(
                "INSERT INTO syllabus_roles (name, role_id, special, syllabus_preset_id, sort_order)
                 VALUES ('', NULL, '', ?1, 0)",
                [preset_id],
            )?;
        }
    }

    tx.commit()?;
    conn.execute_batch("PRAGMA foreign_keys = ON")?;
    Ok(())
}

/// Rename `recovery_minutes` → `rest_minutes`, `joint_recovery` → `joint_rest`.
fn migrate_syllabus_presets_rest_columns_v14(conn: &Connection) -> AppResult<()> {
    if !table_exists(conn, "syllabus_presets")? {
        return Ok(());
    }
    let mut cols = syllabus_presets_column_names(conn)?;
    if cols.iter().any(|c| c == "recovery_minutes") && !cols.iter().any(|c| c == "rest_minutes") {
        conn.execute(
            "ALTER TABLE syllabus_presets RENAME COLUMN recovery_minutes TO rest_minutes",
            [],
        )?;
        cols = syllabus_presets_column_names(conn)?;
    }
    if cols.iter().any(|c| c == "joint_recovery") && !cols.iter().any(|c| c == "joint_rest") {
        conn.execute(
            "ALTER TABLE syllabus_presets RENAME COLUMN joint_recovery TO joint_rest",
            [],
        )?;
    }
    Ok(())
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

/// Persist 0-based slot index; backfill from `start_time` + window slot grid.
fn migrate_shifts_syllabus_num_v13(conn: &Connection) -> AppResult<()> {
    use crate::domain::syllabus::{load_preset_durations, parse_slot_preset_ids, slot_index_for_shift_start};
    use rusqlite::params;

    if !table_exists(conn, "shifts")? {
        return Ok(());
    }
    if !shifts_has_column(conn, "syllabus_num")? {
        conn.execute("ALTER TABLE shifts ADD COLUMN syllabus_num INTEGER", [])?;
    }

    let mut stmt = conn.prepare(
        "SELECT id, shift_window_id, shift_date, start_time FROM shifts
         WHERE syllabus_num IS NULL AND employee_id IS NOT NULL",
    )?;
    let rows: Vec<(i64, i64, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .filter_map(|x| x.ok())
        .collect();

    for (id, wid, date_str, st_str) in rows {
        let Ok((cov_start, slots_json)) = conn.query_row(
            "SELECT coverage_start, syllabus_slot_preset_ids FROM shift_windows WHERE id = ?1",
            [wid],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        ) else {
            continue;
        };
        let Ok(slot_ids) = parse_slot_preset_ids(&slots_json) else {
            continue;
        };
        if slot_ids.is_empty() {
            continue;
        }
        let Ok(durations) = load_preset_durations(conn, &slot_ids) else {
            continue;
        };
        if let Ok(Some(idx)) =
            slot_index_for_shift_start(&cov_start, &date_str, &st_str, &slot_ids, &durations)
        {
            conn.execute(
                "UPDATE shifts SET syllabus_num = ?1 WHERE id = ?2",
                params![idx as i64, id],
            )?;
        }
    }

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
