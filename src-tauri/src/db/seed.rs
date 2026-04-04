//! Default roles and shift types when the database is empty.

use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};

pub fn seed_if_empty(conn: &Connection) -> AppResult<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM roles", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }

    let default_roles = [
        ("מדריך", 1i32, 0i32, "#3B82F6"),
        ("מדריך בכיר", 1, 0, "#8B5CF6"),
        ("ניהול", 0, 1, "#EF4444"),
        ("אחראי יום", 0, 1, "#F59E0B"),
    ];
    let mut stmt = conn.prepare(
        "INSERT INTO roles (name, can_fly, is_management, color) VALUES (?,?,?,?)",
    )?;
    for (name, cf, mg, col) in default_roles {
        stmt.execute(params![name, cf, mg, col])?;
    }

    let default_shifts = [
        (
            "משמרת שעה",
            60i32,
            30,
            30,
            "#3B82F6",
            None::<i64>,
            1,
            0,
            "משמרת טיסה - שעה",
        ),
        (
            "משמרת שעתיים",
            120,
            60,
            60,
            "#6366F1",
            None,
            1,
            0,
            "משמרת טיסה - שעתיים רצופות",
        ),
        (
            "שעה + שעה (הפסקה 2 שעות)",
            60,
            30,
            30,
            "#8B5CF6",
            None,
            1,
            0,
            "שעה, 2 שעות מנוחה, עוד שעה",
        ),
        (
            "שעתיים + שעה (הפסקה 3 שעות)",
            120,
            60,
            60,
            "#A855F7",
            None,
            1,
            0,
            "שעתיים, 3 שעות מנוחה, עוד שעה",
        ),
        ("פתיחת יום", 30, 0, 0, "#F59E0B", Some(4), 0, 0, "אחראי יום - בוקר"),
        ("סגירת יום", 30, 0, 0, "#EF4444", Some(4), 0, 0, "אחראי יום - ערב"),
        (
            "משמרת ניהול",
            60,
            0,
            0,
            "#10B981",
            None,
            0,
            1,
            "איוש ניהולי - לא יכול לטוס",
        ),
    ];

    let mut st = conn.prepare(
        "INSERT INTO shift_types
        (name, duration_minutes, prep_minutes, recovery_minutes, color,
         min_role_id, allow_fly, max_concurrent_management, notes,
         coverage_start, coverage_end)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )?;

    let cov_start = "2000-01-01T06:00:00";
    let cov_end = "2099-12-31T21:00:00";

    for (
        name,
        dur,
        prep,
        rec,
        color,
        min_role,
        allow_fly,
        max_mgmt,
        notes,
    ) in default_shifts
    {
        st.execute(rusqlite::params![
            name,
            dur,
            prep,
            rec,
            color,
            min_role,
            allow_fly,
            max_mgmt,
            notes,
            cov_start,
            cov_end
        ])
        .map_err(|e| AppError::msg(format!("seed shift_types: {e}")))?;
    }

    Ok(())
}
