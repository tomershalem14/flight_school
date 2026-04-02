use crate::db::AppState;
use crate::json_util::sqlite_row_to_object;
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
}

fn default_st_color() -> String {
    "#6366F1".to_string()
}

fn default_true() -> bool {
    true
}

#[tauri::command]
pub fn get_shift_types(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT st.*, r.name as min_role_name
                 FROM shift_types st
                 LEFT JOIN roles r ON st.min_role_id = r.id
                 ORDER BY st.id",
            )?;
            let rows = stmt.query_map([], |row| sqlite_row_to_object(row))?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(crate::error::AppError::from)?);
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_shift_type(state: State<'_, AppState>, payload: ShiftTypeCreate) -> Result<Value, String> {
    state
        .with_db(|conn| {
            conn.execute(
                "INSERT INTO shift_types
                 (name, duration_minutes, prep_minutes, recovery_minutes, color,
                  min_role_id, allow_fly, max_concurrent_management, notes)
                 VALUES (?,?,?,?,?,?,?,?,?)",
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
            }))
        })
        .map_err(|e| e.to_string())
}
