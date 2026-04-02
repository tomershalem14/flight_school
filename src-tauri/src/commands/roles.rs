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
    #[serde(default = "default_true")]
    pub can_fly: bool,
    #[serde(default)]
    pub is_management: bool,
    #[serde(default = "default_role_color")]
    pub color: String,
}

fn default_true() -> bool {
    true
}

fn default_role_color() -> String {
    "#3B82F6".to_string()
}

#[derive(Debug, Deserialize, Default)]
pub struct RoleUpdate {
    pub name: Option<String>,
    pub can_fly: Option<bool>,
    pub is_management: Option<bool>,
    pub color: Option<String>,
}

#[tauri::command]
pub fn get_roles(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare("SELECT * FROM roles ORDER BY id")?;
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
                "INSERT INTO roles (name, can_fly, is_management, color) VALUES (?,?,?,?)",
                params![
                    payload.name,
                    payload.can_fly as i32,
                    payload.is_management as i32,
                    payload.color
                ],
            )?;
            let id = conn.last_insert_rowid();
            Ok(json!({
                "id": id,
                "name": payload.name,
                "can_fly": payload.can_fly,
                "is_management": payload.is_management,
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
            if let Some(b) = payload.can_fly {
                conn.execute(
                    "UPDATE roles SET can_fly = ? WHERE id = ?",
                    params![b as i32, role_id],
                )?;
            }
            if let Some(b) = payload.is_management {
                conn.execute(
                    "UPDATE roles SET is_management = ? WHERE id = ?",
                    params![b as i32, role_id],
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
