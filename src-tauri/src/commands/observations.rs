//! Schedule matrix observations (observer linked to a manned shift).

use crate::commands::shifts::parse_week_end;
use crate::db::AppState;
use crate::error::AppError;
use crate::json_util::sqlite_row_to_object;
use rusqlite::params;
use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct ObservationCreate {
    pub shift_id: i64,
    pub employee_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct ReassignObservationEmployee {
    pub observation_id: i64,
    pub employee_id: i64,
}

#[tauri::command]
pub fn get_observations(state: State<'_, AppState>, week_start: String) -> Result<Vec<Value>, String> {
    let week_end = parse_week_end(&week_start).map_err(|e| e.to_string())?;
    state
        .with_db(|conn| {
            let sql = r#"SELECT o.id, o.shift_id, o.employee_id, o.created_at
                 FROM observations o
                 JOIN shifts s ON s.id = o.shift_id
                 WHERE s.shift_date BETWEEN ?1 AND ?2
                 ORDER BY s.shift_date, s.start_time, o.id"#;
            let mut stmt = conn.prepare(sql).map_err(AppError::from)?;
            let rows = stmt
                .query_map(params![week_start, week_end], |row| sqlite_row_to_object(row))
                .map_err(AppError::from)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::from)?);
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_observation(state: State<'_, AppState>, payload: ObservationCreate) -> Result<Value, String> {
    state
        .with_db_mut(|conn| {
            let manned: Option<Option<i64>> = conn
                .query_row("SELECT employee_id FROM shifts WHERE id = ?", [payload.shift_id], |r| {
                    r.get::<_, Option<i64>>(0)
                })
                .optional()
                .map_err(AppError::from)?;
            let Some(Some(_)) = manned else {
                return Err(AppError::msg(
                    "לא ניתן ליצור תצפית למשמרת שלא מאוישת או שלא נמצאה",
                ));
            };

            let n_emp: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM employees WHERE id = ?",
                    [payload.employee_id],
                    |r| r.get(0),
                )
                .map_err(AppError::from)?;
            if n_emp == 0 {
                return Err(AppError::msg("מפעיל לא נמצא"));
            }

            let sibling_obs: i64 = conn
                .query_row(
                    r#"SELECT COUNT(*) FROM observations o
                       JOIN shifts s ON s.id = o.shift_id
                       JOIN shifts t ON t.id = ?1
                       WHERE s.shift_date = t.shift_date
                         AND s.shift_window_id = t.shift_window_id
                         AND s.syllabus_num = t.syllabus_num
                         AND s.id != t.id"#,
                    params![payload.shift_id],
                    |r| r.get(0),
                )
                .map_err(AppError::from)?;
            if sibling_obs > 0 {
                return Err(AppError::msg("כבר קיימת תצפית בסלוט זה (תפקיד אחר)"));
            }

            conn.execute(
                "INSERT INTO observations (shift_id, employee_id) VALUES (?, ?)",
                params![payload.shift_id, payload.employee_id],
            )
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("UNIQUE") {
                    AppError::msg("כבר קיימת תצפית למשמרת זו")
                } else {
                    AppError::from(e)
                }
            })?;

            let id = conn.last_insert_rowid();
            let row = conn.query_row(
                "SELECT id, shift_id, employee_id, created_at FROM observations WHERE id = ?",
                [id],
                |r| sqlite_row_to_object(r),
            )?;
            Ok(row)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reassign_observation_employee(
    state: State<'_, AppState>,
    payload: ReassignObservationEmployee,
) -> Result<Value, String> {
    state
        .with_db_mut(|conn| {
            let n_obs: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM observations WHERE id = ?",
                    [payload.observation_id],
                    |r| r.get(0),
                )
                .map_err(AppError::from)?;
            if n_obs == 0 {
                return Err(AppError::msg("תצפית לא נמצאה"));
            }

            let n_emp: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM employees WHERE id = ?",
                    [payload.employee_id],
                    |r| r.get(0),
                )
                .map_err(AppError::from)?;
            if n_emp == 0 {
                return Err(AppError::msg("מפעיל לא נמצא"));
            }

            conn.execute(
                "UPDATE observations SET employee_id = ? WHERE id = ?",
                params![payload.employee_id, payload.observation_id],
            )
            .map_err(AppError::from)?;

            let row = conn.query_row(
                "SELECT id, shift_id, employee_id, created_at FROM observations WHERE id = ?",
                [payload.observation_id],
                |r| sqlite_row_to_object(r),
            )?;
            Ok(row)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_observation(state: State<'_, AppState>, observation_id: i64) -> Result<Value, String> {
    state
        .with_db_mut(|conn| {
            let n = conn
                .execute("DELETE FROM observations WHERE id = ?", [observation_id])
                .map_err(AppError::from)?;
            if n == 0 {
                return Err(AppError::msg("תצפית לא נמצאה"));
            }
            Ok(json!({ "ok": true }))
        })
        .map_err(|e| e.to_string())
}
