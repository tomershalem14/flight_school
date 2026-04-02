use crate::db::AppState;
use crate::error::AppError;
use crate::json_util::sqlite_row_to_object;
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct EmployeeCreate {
    pub name: String,
    pub phone: Option<String>,
    pub role_id: i64,
    #[serde(default)]
    pub always_present: bool,
    pub affiliation: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct EmployeeUpdate {
    pub name: Option<String>,
    pub phone: Option<String>,
    pub role_id: Option<i64>,
    pub always_present: Option<bool>,
    pub is_active: Option<bool>,
    pub affiliation: Option<String>,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn get_employees(state: State<'_, AppState>, active_only: Option<bool>) -> Result<Vec<Value>, String> {
    let active_only = active_only.unwrap_or(true);
    state
        .with_db(|conn| {
            let sql = if active_only {
                "SELECT e.*, r.name as role_name, r.color as role_color,
                        r.is_management, r.can_fly
                 FROM employees e
                 JOIN roles r ON e.role_id = r.id
                 WHERE e.is_active = 1
                 ORDER BY r.id, e.name"
            } else {
                "SELECT e.*, r.name as role_name, r.color as role_color,
                        r.is_management, r.can_fly
                 FROM employees e
                 JOIN roles r ON e.role_id = r.id
                 ORDER BY r.id, e.name"
            };
            let mut stmt = conn.prepare(sql)?;
            let rows = stmt.query_map([], |row| sqlite_row_to_object(row))?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::from)?);
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_employee(state: State<'_, AppState>, payload: EmployeeCreate) -> Result<Value, String> {
    state
        .with_db(|conn| {
            conn.execute(
                "INSERT INTO employees (name, phone, role_id, always_present, affiliation, notes)
                 VALUES (?,?,?,?,?,?)",
                params![
                    payload.name,
                    payload.phone,
                    payload.role_id,
                    payload.always_present as i32,
                    payload.affiliation,
                    payload.notes,
                ],
            )?;
            let id = conn.last_insert_rowid();
            Ok(json!({
                "id": id,
                "name": payload.name,
                "phone": payload.phone,
                "role_id": payload.role_id,
                "always_present": payload.always_present,
                "affiliation": payload.affiliation,
                "notes": payload.notes,
            }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_employee(
    state: State<'_, AppState>,
    emp_id: i64,
    payload: EmployeeUpdate,
) -> Result<Value, String> {
    state
        .with_db(|conn| {
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM employees WHERE id = ?",
                [emp_id],
                |r| r.get(0),
            )?;
            if exists == 0 {
                return Err(AppError::msg("עובד לא נמצא"));
            }

            if let Some(ref n) = payload.name {
                conn.execute("UPDATE employees SET name = ? WHERE id = ?", params![n, emp_id])?;
            }
            if let Some(ref p) = payload.phone {
                conn.execute("UPDATE employees SET phone = ? WHERE id = ?", params![p, emp_id])?;
            }
            if let Some(rid) = payload.role_id {
                conn.execute(
                    "UPDATE employees SET role_id = ? WHERE id = ?",
                    params![rid, emp_id],
                )?;
            }
            if let Some(b) = payload.always_present {
                conn.execute(
                    "UPDATE employees SET always_present = ? WHERE id = ?",
                    params![b as i32, emp_id],
                )?;
            }
            if let Some(b) = payload.is_active {
                conn.execute(
                    "UPDATE employees SET is_active = ? WHERE id = ?",
                    params![b as i32, emp_id],
                )?;
            }
            if let Some(ref a) = payload.affiliation {
                conn.execute(
                    "UPDATE employees SET affiliation = ? WHERE id = ?",
                    params![a, emp_id],
                )?;
            }
            if let Some(ref n) = payload.notes {
                conn.execute("UPDATE employees SET notes = ? WHERE id = ?", params![n, emp_id])?;
            }

            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_employee(state: State<'_, AppState>, emp_id: i64) -> Result<Value, String> {
    state
        .with_db(|conn| {
            conn.execute(
                "UPDATE employees SET is_active = 0 WHERE id = ?",
                [emp_id],
            )?;
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}
