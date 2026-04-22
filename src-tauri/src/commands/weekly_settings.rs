use crate::db::AppState;
use crate::error::AppResult;
use crate::json_util::sqlite_row_to_object;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;

const DEFAULT_DAYS_IN_SCHOOL: i64 = 4;
const DEFAULT_ACTIVE_DAYS_MASK: i64 = 31;

fn validate_ymd(s: &str) -> Result<(), String> {
    if s.len() != 10 || s.chars().nth(4) != Some('-') || s.chars().nth(7) != Some('-') {
        return Err("פורמט תאריך שגוי".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn get_weekly_settings(
    state: State<'_, AppState>,
    week_start: String,
) -> Result<Option<Value>, String> {
    validate_ymd(&week_start)?;
    state
        .with_db(|conn| -> AppResult<Option<Value>> {
            let mut stmt = conn.prepare(
                "SELECT * FROM weekly_settings WHERE week_start = ?1 LIMIT 1",
            )?;
            let mut rows = stmt.query_map(params![week_start], |row| sqlite_row_to_object(row))?;
            match rows.next() {
                None => Ok(None),
                Some(row) => Ok(Some(row?)),
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_weekly_settings(
    state: State<'_, AppState>,
    week_start: String,
    days_in_school: i64,
    active_days_mask: i64,
) -> Result<Value, String> {
    validate_ymd(&week_start)?;
    if !(0..=7).contains(&days_in_school) {
        return Err("מספר ימים חייב להיות בין 0 ל-7".to_string());
    }
    if !(1..=127).contains(&active_days_mask) {
        return Err("יש לבחור לפחות יום פעיל אחד".to_string());
    }

    state
        .with_db_mut(|conn| -> AppResult<Value> {
            if days_in_school == DEFAULT_DAYS_IN_SCHOOL && active_days_mask == DEFAULT_ACTIVE_DAYS_MASK {
                conn.execute(
                    "DELETE FROM weekly_settings WHERE week_start = ?1",
                    params![week_start],
                )?;
                return Ok(json!({
                    "week_start": week_start,
                    "days_in_school": DEFAULT_DAYS_IN_SCHOOL,
                    "active_days_mask": DEFAULT_ACTIVE_DAYS_MASK,
                    "deleted": true
                }));
            }
            conn.execute(
                "INSERT INTO weekly_settings (week_start, days_in_school, active_days_mask)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(week_start) DO UPDATE SET
                   days_in_school = excluded.days_in_school,
                   active_days_mask = excluded.active_days_mask",
                params![week_start, days_in_school, active_days_mask],
            )?;
            Ok(json!({
                "week_start": week_start,
                "days_in_school": days_in_school,
                "active_days_mask": active_days_mask,
                "deleted": false
            }))
        })
        .map_err(|e| e.to_string())
}
