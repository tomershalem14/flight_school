use crate::commands::employee_order_presets::remove_employee_from_order_presets;
use crate::db::AppState;
use crate::error::AppError;
use crate::json_util::sqlite_row_to_object;
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

fn normalize_employee_type(raw: &str) -> Result<&'static str, AppError> {
    match raw.trim().to_lowercase().as_str() {
        "admin" => Ok("admin"),
        "regular" => Ok("regular"),
        "extra" => Ok("extra"),
        "reserve" => Ok("reserve"),
        _ => Err(AppError::msg("סוג מפעיל לא חוקי")),
    }
}

/// Only `regular` employees may have an affiliation; others store NULL.
fn affiliation_for_type(et: &str, affiliation: Option<String>) -> Option<String> {
    if et != "regular" {
        return None;
    }
    affiliation.and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

/// Only `regular` with non-empty affiliation may be affiliation leader.
fn affiliation_leader_for_type(et: &str, affiliation: &Option<String>, leader: bool) -> i32 {
    if !leader {
        return 0;
    }
    if et != "regular" {
        return 0;
    }
    match affiliation {
        Some(s) if !s.trim().is_empty() => 1,
        _ => 0,
    }
}

const EMPLOYEES_ORDER_BY: &str = "ORDER BY \
    CASE e.employee_type \
        WHEN 'regular' THEN 0 \
        WHEN 'admin' THEN 1 \
        WHEN 'extra' THEN 2 \
        WHEN 'reserve' THEN 3 \
        ELSE 4 \
    END, \
    CASE WHEN COALESCE(TRIM(e.affiliation), '') = '' THEN 0 ELSE 1 END, \
    COALESCE(NULLIF(TRIM(e.affiliation), ''), '') COLLATE NOCASE, \
    e.affiliation_leader DESC, \
    e.name COLLATE NOCASE";

#[derive(Debug, Deserialize)]
pub struct EmployeeCreate {
    pub name: String,
    pub phone: Option<String>,
    pub role_id: i64,
    #[serde(default = "default_employee_type")]
    pub employee_type: String,
    pub affiliation: Option<String>,
    #[serde(default)]
    pub affiliation_leader: bool,
    pub notes: Option<String>,
}

fn default_employee_type() -> String {
    "regular".to_string()
}

/// Full row replace on edit — avoids partial Option updates that skip `null`/cleared fields.
#[derive(Debug, Deserialize)]
pub struct EmployeeReplace {
    pub name: String,
    pub phone: Option<String>,
    pub role_id: i64,
    pub employee_type: String,
    pub affiliation: Option<String>,
    #[serde(default)]
    pub affiliation_leader: bool,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn get_employees(state: State<'_, AppState>, active_only: Option<bool>) -> Result<Vec<Value>, String> {
    let active_only = active_only.unwrap_or(true);
    state
        .with_db(|conn| {
            let sql = if active_only {
                format!(
                    "SELECT e.*, r.name as role_name, r.color as role_color
                     FROM employees e
                     JOIN roles r ON e.role_id = r.id
                     WHERE e.is_active = 1
                     {EMPLOYEES_ORDER_BY}"
                )
            } else {
                format!(
                    "SELECT e.*, r.name as role_name, r.color as role_color
                     FROM employees e
                     JOIN roles r ON e.role_id = r.id
                     {EMPLOYEES_ORDER_BY}"
                )
            };
            let mut stmt = conn.prepare(&sql)?;
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
            let et = normalize_employee_type(&payload.employee_type)?;
            let affiliation = affiliation_for_type(et, payload.affiliation);
            let aff_leader = affiliation_leader_for_type(et, &affiliation, payload.affiliation_leader);
            conn.execute(
                "INSERT INTO employees (name, phone, role_id, employee_type, affiliation, affiliation_leader, notes)
                 VALUES (?,?,?,?,?,?,?)",
                params![
                    payload.name,
                    payload.phone,
                    payload.role_id,
                    et,
                    affiliation,
                    aff_leader,
                    payload.notes,
                ],
            )?;
            let id = conn.last_insert_rowid();
            Ok(json!({
                "id": id,
                "name": payload.name,
                "phone": payload.phone,
                "role_id": payload.role_id,
                "employee_type": et,
                "affiliation": affiliation,
                "affiliation_leader": aff_leader,
                "notes": payload.notes,
            }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_employee(
    state: State<'_, AppState>,
    emp_id: i64,
    payload: EmployeeReplace,
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

            let old_type: String = conn.query_row(
                "SELECT employee_type FROM employees WHERE id = ?",
                [emp_id],
                |r| r.get(0),
            )?;

            let et = normalize_employee_type(&payload.employee_type)?;
            let affiliation = affiliation_for_type(et, payload.affiliation);
            let aff_leader = affiliation_leader_for_type(et, &affiliation, payload.affiliation_leader);
            conn.execute(
                "UPDATE employees SET name = ?, phone = ?, role_id = ?, employee_type = ?, affiliation = ?, affiliation_leader = ?, notes = ?
                 WHERE id = ?",
                params![
                    payload.name,
                    payload.phone,
                    payload.role_id,
                    et,
                    affiliation,
                    aff_leader,
                    payload.notes,
                    emp_id,
                ],
            )?;

            if old_type == "regular" && et != "regular" {
                remove_employee_from_order_presets(conn, emp_id)?;
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

#[tauri::command]
pub fn reactivate_employee(state: State<'_, AppState>, emp_id: i64) -> Result<Value, String> {
    state
        .with_db(|conn| {
            let n = conn.execute(
                "UPDATE employees SET is_active = 1 WHERE id = ?",
                [emp_id],
            )?;
            if n == 0 {
                return Err(AppError::msg("עובד לא נמצא"));
            }
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}
