//! App-wide rule parameters from `global_rules` (single row, id = 1).
//!
//! `max_workday` on the wire is **hours**; the database stores **minutes**.

use crate::db::AppState;
use crate::error::AppResult;
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct GlobalRulesPayload {
    pub rest_between_shifts: i64,
    pub rest_between_outer: i64,
    /// Maximum workday length in **hours** (persisted as minutes in SQLite).
    pub max_workday: f64,
    pub early_time: String,
    pub late_time: String,
    pub max_late_days: i64,
    pub max_early_days: i64,
    pub max_days_extreme: i64,
}

fn max_workday_minutes_from_hours(hours: f64) -> i64 {
    let m = (hours * 60.0).round();
    if m.is_nan() || m < 0.0 {
        return 0;
    }
    if m > i64::MAX as f64 {
        return i64::MAX;
    }
    m as i64
}

fn ensure_row(conn: &rusqlite::Connection) -> AppResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO global_rules (id, rest_between_shifts, rest_between_outer, max_workday, early_time, late_time, max_late_days, max_early_days)
         VALUES (1, 0, 0, 720, '06:00', '22:00', 0, 0)",
        [],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_global_rules(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .with_db(|conn| {
            ensure_row(conn)?;
            let (
                rest_between_shifts,
                rest_between_outer,
                max_workday_minutes,
                early_time,
                late_time,
                max_late_days,
                max_early_days,
                max_days_extreme,
            ): (i64, i64, i64, String, String, i64, i64, i64) = conn.query_row(
                "SELECT rest_between_shifts, rest_between_outer, max_workday, early_time, late_time, max_late_days, max_early_days, max_days_extreme
                 FROM global_rules WHERE id = 1",
                [],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                    ))
                },
            )?;
            let max_workday_hours = max_workday_minutes as f64 / 60.0;
            Ok(json!({
                "rest_between_shifts": rest_between_shifts,
                "rest_between_outer": rest_between_outer,
                "max_workday": max_workday_hours,
                "early_time": early_time,
                "late_time": late_time,
                "max_late_days": max_late_days,
                "max_early_days": max_early_days,
                "max_days_extreme": max_days_extreme,
            }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_global_rules(state: State<'_, AppState>, payload: GlobalRulesPayload) -> Result<Value, String> {
    let max_workday_minutes = max_workday_minutes_from_hours(payload.max_workday);
    state
        .with_db_mut(|conn| {
            ensure_row(conn)?;
            conn.execute(
                "UPDATE global_rules SET
                    rest_between_shifts = ?1,
                    rest_between_outer = ?2,
                    max_workday = ?3,
                    early_time = ?4,
                    late_time = ?5,
                    max_late_days = ?6,
                    max_early_days = ?7,
                    max_days_extreme = ?8
                 WHERE id = 1",
                params![
                    payload.rest_between_shifts,
                    payload.rest_between_outer,
                    max_workday_minutes,
                    payload.early_time.trim(),
                    payload.late_time.trim(),
                    payload.max_late_days,
                    payload.max_early_days,
                    payload.max_days_extreme,
                ],
            )?;
            Ok(json!({ "ok": true }))
        })
        .map_err(|e| e.to_string())
}
