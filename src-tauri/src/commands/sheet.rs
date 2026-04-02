use crate::db::AppState;
use crate::integration::sheet::poll_sheet;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct SheetConfigUpdate {
    pub sheet_url: String,
}

#[tauri::command]
pub fn save_sheet_config(state: State<'_, AppState>, cfg: SheetConfigUpdate) -> Result<Value, String> {
    state
        .with_db(|conn| {
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('gsheet_url', ?)",
                [&cfg.sheet_url],
            )?;
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_sheet_config(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .with_db(|conn| {
            let url: String = match conn.query_row(
                "SELECT value FROM settings WHERE key='gsheet_url'",
                [],
                |r| r.get(0),
            ) {
                Ok(s) => s,
                Err(rusqlite::Error::QueryReturnedNoRows) => String::new(),
                Err(e) => return Err(crate::error::AppError::from(e)),
            };
            Ok(json!({ "sheet_url": url }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sheet_poll(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .with_db_mut(|conn| poll_sheet(conn))
        .map_err(|e| e.to_string())
}
