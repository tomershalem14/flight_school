use crate::db::AppState;
use crate::error::AppError;
use crate::json_util::sqlite_row_to_object;
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct ConstraintCreate {
    pub employee_id: i64,
    pub start_datetime: String,
    pub end_datetime: String,
    pub constraint_type: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct ConstraintUpdate {
    pub employee_id: Option<i64>,
    pub start_datetime: Option<String>,
    pub end_datetime: Option<String>,
    pub constraint_type: Option<String>,
    pub reason: Option<String>,
}

#[tauri::command]
pub fn get_constraints(
    state: State<'_, AppState>,
    employee_id: Option<i64>,
) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            let mut out = Vec::new();
            if let Some(eid) = employee_id {
                let mut stmt = conn.prepare(
                    "SELECT c.*, e.name as emp_name
                     FROM constraints c
                     JOIN employees e ON c.employee_id = e.id
                     WHERE c.employee_id = ?
                     ORDER BY c.start_datetime",
                )?;
                let rows = stmt.query_map(params![eid], |row| sqlite_row_to_object(row))?;
                for r in rows {
                    out.push(r.map_err(AppError::from)?);
                }
            } else {
                let mut stmt = conn.prepare(
                    "SELECT c.*, e.name as emp_name
                     FROM constraints c
                     JOIN employees e ON c.employee_id = e.id
                     ORDER BY c.start_datetime",
                )?;
                let rows = stmt.query_map([], |row| sqlite_row_to_object(row))?;
                for r in rows {
                    out.push(r.map_err(AppError::from)?);
                }
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_constraint(state: State<'_, AppState>, payload: ConstraintCreate) -> Result<Value, String> {
    state
        .with_db(|conn| {
            conn.execute(
                "INSERT INTO constraints (employee_id, start_datetime, end_datetime, constraint_type, reason)
                 VALUES (?,?,?,?,?)",
                params![
                    payload.employee_id,
                    payload.start_datetime,
                    payload.end_datetime,
                    payload.constraint_type,
                    payload.reason,
                ],
            )?;
            let id = conn.last_insert_rowid();
            Ok(json!({
                "id": id,
                "employee_id": payload.employee_id,
                "start_datetime": payload.start_datetime,
                "end_datetime": payload.end_datetime,
                "constraint_type": payload.constraint_type,
                "reason": payload.reason,
            }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_constraint(
    state: State<'_, AppState>,
    con_id: i64,
    payload: ConstraintUpdate,
) -> Result<Value, String> {
    state
        .with_db(|conn| {
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) FROM constraints WHERE id = ?",
                [con_id],
                |r| r.get(0),
            )?;
            if n == 0 {
                return Err(AppError::msg("אילוץ לא נמצא"));
            }
            if let Some(e) = payload.employee_id {
                conn.execute(
                    "UPDATE constraints SET employee_id = ? WHERE id = ?",
                    params![e, con_id],
                )?;
            }
            if let Some(ref s) = payload.start_datetime {
                conn.execute(
                    "UPDATE constraints SET start_datetime = ? WHERE id = ?",
                    params![s, con_id],
                )?;
            }
            if let Some(ref s) = payload.end_datetime {
                conn.execute(
                    "UPDATE constraints SET end_datetime = ? WHERE id = ?",
                    params![s, con_id],
                )?;
            }
            if let Some(ref t) = payload.constraint_type {
                conn.execute(
                    "UPDATE constraints SET constraint_type = ? WHERE id = ?",
                    params![t, con_id],
                )?;
            }
            if let Some(ref r) = payload.reason {
                conn.execute(
                    "UPDATE constraints SET reason = ? WHERE id = ?",
                    params![r, con_id],
                )?;
            }
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_constraint(state: State<'_, AppState>, con_id: i64) -> Result<Value, String> {
    state
        .with_db(|conn| {
            conn.execute("DELETE FROM constraints WHERE id = ?", [con_id])?;
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}
