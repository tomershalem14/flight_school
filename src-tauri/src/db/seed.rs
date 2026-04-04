//! Default roles and shift windows when the database is empty.

use crate::domain::syllabus::{coverage_daily_span_minutes, floor_slot_count, json_preset_slot_array};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};

pub fn seed_if_empty(conn: &Connection) -> AppResult<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM roles", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }

    let default_roles = [
        ("מדריך", 0i64, "", "#3B82F6"),
        ("מדריך בכיר", 1, "", "#8B5CF6"),
        ("ניהול", 10, "", "#EF4444"),
        ("אחראי יום", 11, "", "#F59E0B"),
    ];
    let mut stmt = conn.prepare(
        "INSERT INTO roles (name, role_level, special_list, color) VALUES (?,?,?,?)",
    )?;
    for (name, level, specials, col) in default_roles {
        stmt.execute(params![name, level, specials, col])?;
    }

    let default_preset_id: i64 = conn.query_row(
        "SELECT id FROM syllabus_presets WHERE system_locked = 1 LIMIT 1",
        [],
        |r| r.get(0),
    )?;

    let default_windows = [
        (
            "משמרת שעה",
            "#3B82F6",
            "משמרת טיסה - שעה",
        ),
        (
            "משמרת שעתיים",
            "#6366F1",
            "משמרת טיסה - שעתיים רצופות",
        ),
        (
            "שעה + שעה (הפסקה 2 שעות)",
            "#8B5CF6",
            "שעה, 2 שעות מנוחה, עוד שעה",
        ),
        (
            "שעתיים + שעה (הפסקה 3 שעות)",
            "#A855F7",
            "שעתיים, 3 שעות מנוחה, עוד שעה",
        ),
        ("פתיחת יום", "#F59E0B", "אחראי יום - בוקר"),
        ("סגירת יום", "#EF4444", "אחראי יום - ערב"),
        (
            "משמרת ניהול",
            "#10B981",
            "איוש ניהולי",
        ),
    ];

    let cov_start = "2000-01-01T06:00:00";
    let cov_end = "2099-12-31T21:00:00";
    let span = coverage_daily_span_minutes(cov_start, cov_end)
        .map_err(|e| AppError::msg(e))?;
    let slot_n = floor_slot_count(span, 60);
    let slots_json = json_preset_slot_array(default_preset_id, slot_n);

    let mut st = conn.prepare(
        "INSERT INTO shift_windows
        (name, color, notes, coverage_start, coverage_end, syllabus_slot_preset_ids)
        VALUES (?,?,?,?,?,?)",
    )?;

    for (name, color, notes) in default_windows {
        st.execute(rusqlite::params![
            name,
            color,
            notes,
            cov_start,
            cov_end,
            slots_json.clone()
        ])
        .map_err(|e| AppError::msg(format!("seed shift_windows: {e}")))?;
    }

    Ok(())
}
