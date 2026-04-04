use crate::db::AppState;
use crate::domain::rules::parse_iso_datetime;
use crate::error::AppError;
use crate::json_util::sqlite_row_to_object;
use chrono::{Duration, NaiveDate};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct ShiftTypeCreate {
    pub name: String,
    pub duration_minutes: i64,
    pub prep_minutes: i64,
    pub recovery_minutes: i64,
    #[serde(default = "default_st_color")]
    pub color: String,
    pub min_role_id: Option<i64>,
    #[serde(default = "default_true")]
    pub allow_fly: bool,
    #[serde(default)]
    pub max_concurrent_management: i64,
    pub notes: Option<String>,
    pub coverage_start: String,
    pub coverage_end: String,
}

#[derive(Debug, Deserialize)]
pub struct ShiftTypeUpdate {
    pub name: String,
    pub duration_minutes: i64,
    pub prep_minutes: i64,
    pub recovery_minutes: i64,
    #[serde(default = "default_st_color")]
    pub color: String,
    pub min_role_id: Option<i64>,
    #[serde(default = "default_true")]
    pub allow_fly: bool,
    #[serde(default)]
    pub max_concurrent_management: i64,
    pub notes: Option<String>,
    pub coverage_start: String,
    pub coverage_end: String,
}

fn default_st_color() -> String {
    "#6366F1".to_string()
}

fn default_true() -> bool {
    true
}

fn validate_coverage_window(start: &str, end: &str) -> Result<(), String> {
    let cs = parse_iso_datetime(start).ok_or_else(|| "coverage_start לא תקין".to_string())?;
    let ce = parse_iso_datetime(end).ok_or_else(|| "coverage_end לא תקין".to_string())?;
    if ce <= cs {
        return Err("חלון כיסוי חייב להיות עם סיום אחרי התחלה".to_string());
    }
    Ok(())
}

fn day_overlap_bounds(ymd: &str) -> Result<(String, String), String> {
    let dt = NaiveDate::parse_from_str(ymd, "%Y-%m-%d")
        .map_err(|_| "פורמט תאריך שגוי — השתמש ב-YYYY-MM-DD".to_string())?;
    let next = dt + Duration::days(1);
    Ok((
        format!("{}T00:00:00", dt.format("%Y-%m-%d")),
        format!("{}T00:00:00", next.format("%Y-%m-%d")),
    ))
}

#[tauri::command]
pub fn get_shift_types(
    state: State<'_, AppState>,
    date: Option<String>,
) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            let mut out = Vec::new();
            if let Some(ref d) = date {
                let (day_start, day_end_excl) =
                    day_overlap_bounds(d).map_err(AppError::msg)?;
                let mut stmt = conn.prepare(
                    "SELECT st.*, r.name as min_role_name
                     FROM shift_types st
                     LEFT JOIN roles r ON st.min_role_id = r.id
                     WHERE st.coverage_start < ?1 AND st.coverage_end > ?2
                     ORDER BY st.id",
                )?;
                let rows = stmt.query_map(params![day_end_excl, day_start], |row| {
                    sqlite_row_to_object(row)
                })?;
                for r in rows {
                    out.push(r.map_err(crate::error::AppError::from)?);
                }
            } else {
                let mut stmt = conn.prepare(
                    "SELECT st.*, r.name as min_role_name
                     FROM shift_types st
                     LEFT JOIN roles r ON st.min_role_id = r.id
                     ORDER BY st.id",
                )?;
                let rows = stmt.query_map([], |row| sqlite_row_to_object(row))?;
                for r in rows {
                    out.push(r.map_err(crate::error::AppError::from)?);
                }
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_shift_type(state: State<'_, AppState>, payload: ShiftTypeCreate) -> Result<Value, String> {
    validate_coverage_window(&payload.coverage_start, &payload.coverage_end)?;
    state
        .with_db(|conn| {
            conn.execute(
                "INSERT INTO shift_types
                 (name, duration_minutes, prep_minutes, recovery_minutes, color,
                  min_role_id, allow_fly, max_concurrent_management, notes,
                  coverage_start, coverage_end)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                params![
                    payload.name,
                    payload.duration_minutes,
                    payload.prep_minutes,
                    payload.recovery_minutes,
                    payload.color,
                    payload.min_role_id,
                    payload.allow_fly as i32,
                    payload.max_concurrent_management,
                    payload.notes,
                    payload.coverage_start,
                    payload.coverage_end,
                ],
            )?;
            let id = conn.last_insert_rowid();
            Ok(json!({
                "id": id,
                "name": payload.name,
                "duration_minutes": payload.duration_minutes,
                "prep_minutes": payload.prep_minutes,
                "recovery_minutes": payload.recovery_minutes,
                "color": payload.color,
                "min_role_id": payload.min_role_id,
                "allow_fly": payload.allow_fly,
                "max_concurrent_management": payload.max_concurrent_management,
                "notes": payload.notes,
                "coverage_start": payload.coverage_start,
                "coverage_end": payload.coverage_end,
            }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_shift_type(
    state: State<'_, AppState>,
    shift_type_id: i64,
    payload: ShiftTypeUpdate,
) -> Result<Value, String> {
    validate_coverage_window(&payload.coverage_start, &payload.coverage_end)?;
    state
        .with_db(|conn| {
            let n = conn.execute(
                "UPDATE shift_types SET
                    name = ?1,
                    duration_minutes = ?2,
                    prep_minutes = ?3,
                    recovery_minutes = ?4,
                    color = ?5,
                    min_role_id = ?6,
                    allow_fly = ?7,
                    max_concurrent_management = ?8,
                    notes = ?9,
                    coverage_start = ?10,
                    coverage_end = ?11
                 WHERE id = ?12",
                params![
                    payload.name,
                    payload.duration_minutes,
                    payload.prep_minutes,
                    payload.recovery_minutes,
                    payload.color,
                    payload.min_role_id,
                    payload.allow_fly as i32,
                    payload.max_concurrent_management,
                    payload.notes,
                    payload.coverage_start,
                    payload.coverage_end,
                    shift_type_id,
                ],
            )?;
            if n == 0 {
                return Err(crate::error::AppError::msg("סוג משמרת לא נמצא"));
            }
            Ok(json!({ "ok": true, "id": shift_type_id }))
        })
        .map_err(|e| e.to_string())
}

/// Deletes all shifts for this type, then the shift type row.
#[tauri::command]
pub fn delete_shift_type(state: State<'_, AppState>, shift_type_id: i64) -> Result<Value, String> {
    state
        .with_db_mut(|conn| {
            let tx = conn.transaction().map_err(crate::error::AppError::from)?;
            let deleted_shifts = tx
                .execute(
                    "DELETE FROM shifts WHERE shift_type_id = ?1",
                    params![shift_type_id],
                )
                .map_err(crate::error::AppError::from)?;
            let deleted_type = tx
                .execute("DELETE FROM shift_types WHERE id = ?1", params![shift_type_id])
                .map_err(crate::error::AppError::from)?;
            if deleted_type == 0 {
                return Err(crate::error::AppError::msg("סוג משמרת לא נמצא"));
            }
            tx.commit().map_err(crate::error::AppError::from)?;
            Ok(json!({
                "ok": true,
                "deleted_shifts": deleted_shifts,
            }))
        })
        .map_err(|e| e.to_string())
}
