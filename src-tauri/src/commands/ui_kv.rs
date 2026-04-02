//! Persist flight-board and other UI blobs that were previously in `localStorage`.

use crate::db::AppState;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub fn ui_kv_get(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    state
        .with_db(|conn| {
            let v: Option<String> = match conn.query_row(
                "SELECT value FROM ui_kv WHERE key = ?",
                [&key],
                |r| r.get(0),
            ) {
                Ok(s) => Some(s),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(crate::error::AppError::from(e)),
            };
            Ok(v)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ui_kv_set(state: State<'_, AppState>, key: String, value: String) -> Result<Value, String> {
    state
        .with_db(|conn| {
            conn.execute(
                "INSERT INTO ui_kv (key, value) VALUES (?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ui_kv_remove(state: State<'_, AppState>, key: String) -> Result<Value, String> {
    state
        .with_db(|conn| {
            conn.execute("DELETE FROM ui_kv WHERE key = ?", [&key])?;
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}
