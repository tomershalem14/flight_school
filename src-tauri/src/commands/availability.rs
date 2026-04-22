use crate::commands::shifts::parse_week_end;
use crate::db::AppState;
use crate::error::{AppError, AppResult};
use crate::json_util::sqlite_row_to_object;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;

fn validate_ymd(s: &str) -> Result<(), String> {
    if s.len() != 10 || s.chars().nth(4) != Some('-') || s.chars().nth(7) != Some('-') {
        return Err("פורמט תאריך שגוי".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn list_availability_for_week(
    state: State<'_, AppState>,
    week_start: String,
) -> Result<Vec<Value>, String> {
    validate_ymd(&week_start)?;
    let week_end = parse_week_end(&week_start).map_err(|e| e.to_string())?;
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT a.*
                 FROM availability a
                 WHERE a.avail_date BETWEEN ?1 AND ?2
                 ORDER BY a.avail_date, a.employee_id, a.start_time IS NULL DESC, a.start_time, a.id",
            )?;
            let rows = stmt.query_map(params![week_start, week_end], |row| {
                sqlite_row_to_object(row)
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::from)?);
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_availability_whole_day(
    state: State<'_, AppState>,
    employee_id: i64,
    avail_date: String,
) -> Result<Value, String> {
    validate_ymd(&avail_date)?;
    if employee_id <= 0 {
        return Err("מזהה מפעיל לא תקין".to_string());
    }
    state
        .with_db_mut(|conn| -> AppResult<Value> {
            let emp: i64 = conn.query_row(
                "SELECT COUNT(*) FROM employees WHERE id = ?",
                [employee_id],
                |r| r.get(0),
            )?;
            if emp == 0 {
                return Err(AppError::msg("מפעיל לא נמצא"));
            }
            let existing: i64 = conn.query_row(
                "SELECT COUNT(*) FROM availability WHERE employee_id = ?1 AND avail_date = ?2",
                params![employee_id, avail_date],
                |r| r.get(0),
            )?;
            if existing > 0 {
                return Err(AppError::msg("כבר קיימת זמינות ליום זה"));
            }
            conn.execute(
                "INSERT INTO availability (employee_id, avail_date, start_time, end_time)
                 VALUES (?1, ?2, NULL, NULL)",
                params![employee_id, avail_date],
            )?;
            let id = conn.last_insert_rowid();
            Ok(json!({ "id": id, "employee_id": employee_id, "avail_date": avail_date }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_availability_for_employee_day(
    state: State<'_, AppState>,
    employee_id: i64,
    avail_date: String,
) -> Result<Value, String> {
    validate_ymd(&avail_date)?;
    if employee_id <= 0 {
        return Err("מזהה מפעיל לא תקין".to_string());
    }
    state
        .with_db_mut(|conn| -> AppResult<Value> {
            let tx = conn.transaction()?;
            let n = tx.execute(
                "DELETE FROM availability WHERE employee_id = ?1 AND avail_date = ?2",
                params![employee_id, avail_date],
            )?;
            tx.commit()?;
            Ok(json!({ "deleted": n }))
        })
        .map_err(|e| e.to_string())
}
