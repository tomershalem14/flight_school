use crate::db::AppState;
use crate::error::AppError;
use crate::json_util::sqlite_row_to_object;
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct RoleCreate {
    pub name: String,
    #[serde(default)]
    pub role_level: i64,
    #[serde(default)]
    pub special_list: String,
    #[serde(default = "default_role_color")]
    pub color: String,
}

fn default_role_color() -> String {
    "#3B82F6".to_string()
}

#[derive(Debug, Deserialize, Default)]
pub struct RoleUpdate {
    pub name: Option<String>,
    pub role_level: Option<i64>,
    pub special_list: Option<String>,
    pub color: Option<String>,
}

#[tauri::command]
pub fn get_roles(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            let mut stmt =
                conn.prepare("SELECT * FROM roles ORDER BY role_level ASC, id ASC")?;
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
pub fn create_role(state: State<'_, AppState>, payload: RoleCreate) -> Result<Value, String> {
    state
        .with_db(|conn| {
            conn.execute(
                "INSERT INTO roles (name, role_level, special_list, color) VALUES (?,?,?,?)",
                params![
                    payload.name,
                    payload.role_level,
                    payload.special_list,
                    payload.color
                ],
            )?;
            let id = conn.last_insert_rowid();
            Ok(json!({
                "id": id,
                "name": payload.name,
                "role_level": payload.role_level,
                "special_list": payload.special_list,
                "color": payload.color,
            }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_role(
    state: State<'_, AppState>,
    role_id: i64,
    payload: RoleUpdate,
) -> Result<Value, String> {
    state
        .with_db(|conn| {
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM roles WHERE id = ?",
                [role_id],
                |r| r.get(0),
            )?;
            if exists == 0 {
                return Err(AppError::msg("דרג לא נמצא"));
            }

            if let Some(ref n) = payload.name {
                conn.execute(
                    "UPDATE roles SET name = ? WHERE id = ?",
                    params![n, role_id],
                )?;
            }
            if let Some(l) = payload.role_level {
                conn.execute(
                    "UPDATE roles SET role_level = ? WHERE id = ?",
                    params![l, role_id],
                )?;
            }
            if let Some(ref s) = payload.special_list {
                conn.execute(
                    "UPDATE roles SET special_list = ? WHERE id = ?",
                    params![s, role_id],
                )?;
            }
            if let Some(ref c) = payload.color {
                conn.execute(
                    "UPDATE roles SET color = ? WHERE id = ?",
                    params![c, role_id],
                )?;
            }

            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_role(state: State<'_, AppState>, role_id: i64) -> Result<Value, String> {
    state
        .with_db(|conn| {
            let total: i64 = conn.query_row("SELECT COUNT(*) FROM roles", [], |r| r.get(0))?;
            if total <= 1 {
                return Err(AppError::msg("לא ניתן למחוק את הדרג האחרון"));
            }
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM roles WHERE id = ?",
                [role_id],
                |r| r.get(0),
            )?;
            if exists == 0 {
                return Err(AppError::msg("דרג לא נמצא"));
            }
            let fallback: i64 = conn.query_row(
                "SELECT id FROM roles WHERE id != ? ORDER BY id LIMIT 1",
                [role_id],
                |r| r.get(0),
            )?;
            conn.execute(
                "UPDATE employees SET role_id = ?1 WHERE role_id = ?2",
                params![fallback, role_id],
            )?;
            conn.execute(
                "UPDATE syllabus_roles SET role_id = ?1 WHERE role_id = ?2",
                params![fallback, role_id],
            )?;
            conn.execute("DELETE FROM roles WHERE id = ?", [role_id])?;
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}
