//! Custom ordering of employees (regular instructors) for matrix / board views.

use crate::db::AppState;
use crate::error::{AppError, AppResult};
use crate::json_util::sqlite_row_to_object;
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use tauri::State;

/// Active regular employees in the same relative order as the main schedule (`EMPLOYEES_ORDER_BY` regular block).
const ACTIVE_REGULAR_IDS_ORDERED: &str = "\
SELECT e.id FROM employees e \
WHERE e.is_active = 1 AND e.employee_type = 'regular' \
ORDER BY \
    CASE WHEN COALESCE(TRIM(e.affiliation), '') = '' THEN 0 ELSE 1 END, \
    COALESCE(NULLIF(TRIM(e.affiliation), ''), '') COLLATE NOCASE, \
    e.affiliation_leader DESC, \
    e.name COLLATE NOCASE";

#[tauri::command]
pub fn list_employee_order_presets(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, created_at, is_active FROM employee_order_presets ORDER BY name COLLATE NOCASE",
            )?;
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
pub fn set_employee_order_active(
    state: State<'_, AppState>,
    preset_id: Option<i64>,
) -> Result<Value, String> {
    state
        .with_db_mut(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE employee_order_presets SET is_active = 0",
                [],
            )?;
            if let Some(pid) = preset_id {
                let n: i64 = tx.query_row(
                    "SELECT COUNT(*) FROM employee_order_presets WHERE id = ?",
                    [pid],
                    |r| r.get(0),
                )?;
                if n == 0 {
                    return Err(AppError::msg("סדר לא נמצא"));
                }
                tx.execute(
                    "UPDATE employee_order_presets SET is_active = 1 WHERE id = ?",
                    [pid],
                )?;
            }
            tx.commit()?;
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct EmployeeOrderPresetCreate {
    pub name: String,
}

#[tauri::command]
pub fn create_employee_order_preset(
    state: State<'_, AppState>,
    payload: EmployeeOrderPresetCreate,
) -> Result<Value, String> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err("שם נדרש".to_string());
    }
    state
        .with_db_mut(|conn| {
            let ids: Vec<i64> = {
                let mut stmt = conn.prepare(ACTIVE_REGULAR_IDS_ORDERED)?;
                let mapped = stmt.query_map([], |r| r.get(0))?;
                mapped.collect::<Result<Vec<_>, _>>()?
            };
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO employee_order_presets (name, is_active) VALUES (?, 0)",
                [name],
            )?;
            let id: i64 = tx.last_insert_rowid();
            for (sort_index, emp_id) in ids.iter().enumerate() {
                tx.execute(
                    "INSERT INTO employee_order_preset_items (preset_id, employee_id, sort_index, hidden) VALUES (?, ?, ?, 0)",
                    params![id, emp_id, sort_index as i64],
                )?;
            }
            tx.commit()?;
            Ok(json!({"id": id, "name": name}))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_employee_order_preset(state: State<'_, AppState>, preset_id: i64) -> Result<Value, String> {
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, created_at, is_active FROM employee_order_presets WHERE id = ?",
            )?;
            let mut rows = stmt.query_map([preset_id], |row| sqlite_row_to_object(row))?;
            let mut h = match rows.next() {
                Some(r) => r.map_err(AppError::from)?,
                None => return Err(AppError::msg("סדר לא נמצא")),
            };
            let mut stmt = conn.prepare(
                "SELECT i.employee_id, i.sort_index, i.hidden, e.name, e.affiliation, e.employee_type, r.name AS role_name \
                 FROM employee_order_preset_items i \
                 JOIN employees e ON e.id = i.employee_id \
                 JOIN roles r ON r.id = e.role_id \
                 WHERE i.preset_id = ? AND e.is_active = 1 AND e.employee_type = 'regular' \
                 ORDER BY i.sort_index ASC",
            )?;
            let item_rows = stmt.query_map([preset_id], |row| sqlite_row_to_object(row))?;
            let mut items = Vec::new();
            for r in item_rows {
                items.push(r.map_err(AppError::from)?);
            }
            let obj = h.as_object_mut().ok_or_else(|| AppError::msg("פורמט לא צפוי"))?;
            obj.insert("items".into(), Value::Array(items));
            Ok(h)
        })
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct EmployeeOrderItemInput {
    pub employee_id: i64,
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Debug, Deserialize)]
pub struct EmployeeOrderPresetReplace {
    pub name: String,
    pub items: Vec<EmployeeOrderItemInput>,
}

#[tauri::command]
pub fn update_employee_order_preset(
    state: State<'_, AppState>,
    preset_id: i64,
    payload: EmployeeOrderPresetReplace,
) -> Result<Value, String> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err("שם נדרש".to_string());
    }
    state
        .with_db_mut(|conn| {
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM employee_order_presets WHERE id = ?",
                [preset_id],
                |r| r.get(0),
            )?;
            if exists == 0 {
                return Err(AppError::msg("סדר לא נמצא"));
            }

            let uniq: HashSet<i64> = payload.items.iter().map(|r| r.employee_id).collect();
            if uniq.len() != payload.items.len() {
                return Err(AppError::msg("כפילויות ברשימה"));
            }

            for row in &payload.items {
                let ok: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM employees WHERE id = ? AND is_active = 1 AND employee_type = 'regular'",
                    [row.employee_id],
                    |r| r.get(0),
                )?;
                if ok == 0 {
                    return Err(AppError::msg("רשימת מפעילים לא חוקית"));
                }
            }

            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE employee_order_presets SET name = ? WHERE id = ?",
                params![name, preset_id],
            )?;
            tx.execute(
                "DELETE FROM employee_order_preset_items WHERE preset_id = ?",
                [preset_id],
            )?;
            for (sort_index, row) in payload.items.iter().enumerate() {
                let hid: i32 = if row.hidden { 1 } else { 0 };
                tx.execute(
                    "INSERT INTO employee_order_preset_items (preset_id, employee_id, sort_index, hidden) VALUES (?, ?, ?, ?)",
                    params![preset_id, row.employee_id, sort_index as i64, hid],
                )?;
            }
            tx.commit()?;
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_employee_order_preset(state: State<'_, AppState>, preset_id: i64) -> Result<Value, String> {
    state
        .with_db_mut(|conn| {
            let n = conn.execute(
                "DELETE FROM employee_order_presets WHERE id = ?",
                [preset_id],
            )?;
            if n == 0 {
                return Err(AppError::msg("סדר לא נמצא"));
            }
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}

/// Remove preset rows for an employee who is no longer a regular (caller runs in same connection).
pub fn remove_employee_from_order_presets(conn: &rusqlite::Connection, employee_id: i64) -> AppResult<()> {
    conn.execute(
        "DELETE FROM employee_order_preset_items WHERE employee_id = ?",
        [employee_id],
    )?;
    Ok(())
}
