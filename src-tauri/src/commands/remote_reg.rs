use crate::db::AppState;
use crate::error::AppError;
use crate::json_util::sqlite_row_to_object;
use chrono::{Duration, NaiveDate};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct RemoteRegSession {
    pub session_token: String,
    pub employee_id: i64,
    pub employee_name: String,
    pub shift_date: String,
    pub from_time: String,
    pub to_time: String,
}

#[derive(Debug, Deserialize)]
pub struct RemoteRegSubmit {
    pub token: String,
    pub start_time: String,
    pub end_time: String,
}

#[derive(Debug, Deserialize, Default)]
pub struct RemoteRegUpdate {
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub reg_start: Option<String>,
    pub reg_end: Option<String>,
    pub status: Option<String>,
    pub shift_id: Option<i64>,
}

#[tauri::command]
pub fn create_reg_session(state: State<'_, AppState>, s: RemoteRegSession) -> Result<Value, String> {
    state
        .with_db(|conn| {
            let existing: Option<i64> = match conn.query_row(
                "SELECT id FROM remote_registrations WHERE employee_id=? AND shift_date=? AND status='pending'",
                params![s.employee_id, s.shift_date],
                |r| r.get(0),
            ) {
                Ok(id) => Some(id),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(AppError::from(e)),
            };

            let reg_id = if let Some(eid) = existing {
                conn.execute(
                    "UPDATE remote_registrations SET start_time=?, end_time=?, session_token=? WHERE id=?",
                    params![s.from_time, s.to_time, s.session_token, eid],
                )?;
                eid
            } else {
                conn.execute(
                    "INSERT INTO remote_registrations
                     (employee_id, employee_name, shift_date, start_time, end_time, status, session_token)
                     VALUES (?,?,?,?,?,'pending',?)",
                    params![
                        s.employee_id,
                        s.employee_name,
                        s.shift_date,
                        s.from_time,
                        s.to_time,
                        s.session_token
                    ],
                )?;
                conn.last_insert_rowid()
            };

            Ok(json!({ "id": reg_id, "token": s.session_token }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_remote_registrations(
    state: State<'_, AppState>,
    week_start: Option<String>,
    status: Option<String>,
) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            let mut out = Vec::new();
            let week_end = week_start.as_ref().and_then(|ws| {
                NaiveDate::parse_from_str(ws, "%Y-%m-%d")
                    .ok()
                    .map(|dt| (dt + Duration::days(6)).format("%Y-%m-%d").to_string())
            });

            match (&week_start, &week_end, &status) {
                (Some(ws), Some(we), Some(st)) => {
                    let mut stmt = conn.prepare(
                        "SELECT * FROM remote_registrations WHERE shift_date BETWEEN ? AND ? AND status = ? ORDER BY shift_date, employee_name",
                    )?;
                    let rows = stmt.query_map(params![ws, we, st], |row| sqlite_row_to_object(row))?;
                    for r in rows {
                        out.push(r.map_err(AppError::from)?);
                    }
                }
                (Some(ws), Some(we), None) => {
                    let mut stmt = conn.prepare(
                        "SELECT * FROM remote_registrations WHERE shift_date BETWEEN ? AND ? ORDER BY shift_date, employee_name",
                    )?;
                    let rows = stmt.query_map(params![ws, we], |row| sqlite_row_to_object(row))?;
                    for r in rows {
                        out.push(r.map_err(AppError::from)?);
                    }
                }
                (_, _, Some(st)) => {
                    let mut stmt = conn.prepare(
                        "SELECT * FROM remote_registrations WHERE status = ? ORDER BY shift_date, employee_name",
                    )?;
                    let rows = stmt.query_map(params![st], |row| sqlite_row_to_object(row))?;
                    for r in rows {
                        out.push(r.map_err(AppError::from)?);
                    }
                }
                _ => {
                    let mut stmt = conn.prepare(
                        "SELECT * FROM remote_registrations ORDER BY shift_date, employee_name",
                    )?;
                    let rows = stmt.query_map([], |row| sqlite_row_to_object(row))?;
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
pub fn get_reg_form(state: State<'_, AppState>, token: String) -> Result<Value, String> {
    state
        .with_db(|conn| {
            let row = conn.query_row(
                "SELECT * FROM remote_registrations WHERE session_token=?",
                [&token],
                |r| sqlite_row_to_object(r),
            );
            match row {
                Ok(v) => Ok(v),
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    Err(AppError::msg("טופס לא נמצא או פג תוקפו"))
                }
                Err(e) => Err(AppError::from(e)),
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn submit_registration(state: State<'_, AppState>, sub: RemoteRegSubmit) -> Result<Value, String> {
    state
        .with_db(|conn| {
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) FROM remote_registrations WHERE session_token=?",
                [&sub.token],
                |r| r.get(0),
            )?;
            if n == 0 {
                return Err(AppError::msg("טופס לא נמצא"));
            }
            conn.execute(
                "UPDATE remote_registrations SET reg_start=?, reg_end=?, status='submitted' WHERE session_token=?",
                params![sub.start_time, sub.end_time, sub.token],
            )?;
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_remote_registration(
    state: State<'_, AppState>,
    reg_id: i64,
    payload: RemoteRegUpdate,
) -> Result<Value, String> {
    state
        .with_db(|conn| {
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) FROM remote_registrations WHERE id=?",
                [reg_id],
                |r| r.get(0),
            )?;
            if n == 0 {
                return Err(AppError::msg("רישום לא נמצא"));
            }
            if let Some(ref s) = payload.start_time {
                conn.execute(
                    "UPDATE remote_registrations SET start_time=? WHERE id=?",
                    params![s, reg_id],
                )?;
            }
            if let Some(ref s) = payload.end_time {
                conn.execute(
                    "UPDATE remote_registrations SET end_time=? WHERE id=?",
                    params![s, reg_id],
                )?;
            }
            if let Some(ref s) = payload.reg_start {
                conn.execute(
                    "UPDATE remote_registrations SET reg_start=? WHERE id=?",
                    params![s, reg_id],
                )?;
            }
            if let Some(ref s) = payload.reg_end {
                conn.execute(
                    "UPDATE remote_registrations SET reg_end=? WHERE id=?",
                    params![s, reg_id],
                )?;
            }
            if let Some(ref s) = payload.status {
                conn.execute(
                    "UPDATE remote_registrations SET status=? WHERE id=?",
                    params![s, reg_id],
                )?;
            }
            if let Some(sid) = payload.shift_id {
                conn.execute(
                    "UPDATE remote_registrations SET shift_id=? WHERE id=?",
                    params![sid, reg_id],
                )?;
            }
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_remote_registration(state: State<'_, AppState>, reg_id: i64) -> Result<Value, String> {
    state
        .with_db(|conn| {
            conn.execute("DELETE FROM remote_registrations WHERE id = ?", [reg_id])?;
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}
