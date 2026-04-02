use crate::db::AppState;
use crate::error::AppError;
use crate::json_util::sqlite_row_to_object;
use rusqlite::{params, Row};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct FixedAssignmentCreate {
    pub employee_id: i64,
    pub shift_date: String,
    pub start_time: String,
    pub end_time: String,
    pub task_name: String,
    pub notes: Option<String>,
}

/// Shared row mapper so every `query_map` arm has the same closure type.
fn map_fixed_assignment_row(row: &Row<'_>) -> rusqlite::Result<Value> {
    sqlite_row_to_object(row)
}

#[tauri::command]
pub fn get_fixed_assignments(
    state: State<'_, AppState>,
    employee_id: Option<i64>,
    shift_date: Option<String>,
) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            let mut sql = "SELECT fa.*, e.name as emp_name FROM fixed_assignments fa
                           JOIN employees e ON fa.employee_id = e.id WHERE 1=1"
                .to_string();
            if employee_id.is_some() {
                sql.push_str(" AND fa.employee_id = ?");
            }
            if shift_date.is_some() {
                sql.push_str(" AND fa.shift_date = ?");
            }
            let mut stmt = conn.prepare(&sql)?;
            let mut out = Vec::new();

            match (employee_id, shift_date) {
                (Some(a), Some(ref b)) => {
                    let rows = stmt.query_map(params![a, b], map_fixed_assignment_row)?;
                    for r in rows {
                        out.push(r.map_err(AppError::from)?);
                    }
                }
                (Some(a), None) => {
                    let rows = stmt.query_map(params![a], map_fixed_assignment_row)?;
                    for r in rows {
                        out.push(r.map_err(AppError::from)?);
                    }
                }
                (None, Some(ref b)) => {
                    let rows = stmt.query_map(params![b], map_fixed_assignment_row)?;
                    for r in rows {
                        out.push(r.map_err(AppError::from)?);
                    }
                }
                (None, None) => {
                    let rows = stmt.query_map([], map_fixed_assignment_row)?;
                    for r in rows {
                        out.push(r.map_err(AppError::from)?);
                    }
                }
            }

            Ok(out)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_fixed_assignment(
    state: State<'_, AppState>,
    payload: FixedAssignmentCreate,
) -> Result<Value, String> {
    state
        .with_db(|conn| {
            conn.execute(
                "INSERT INTO fixed_assignments (employee_id, shift_date, start_time, end_time, task_name, notes)
                 VALUES (?,?,?,?,?,?)",
                params![
                    payload.employee_id,
                    payload.shift_date,
                    payload.start_time,
                    payload.end_time,
                    payload.task_name,
                    payload.notes,
                ],
            )?;
            let id = conn.last_insert_rowid();
            Ok(json!({ "id": id }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_fixed_assignment(state: State<'_, AppState>, fa_id: i64) -> Result<Value, String> {
    state
        .with_db(|conn| {
            conn.execute("DELETE FROM fixed_assignments WHERE id = ?", [fa_id])?;
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}
