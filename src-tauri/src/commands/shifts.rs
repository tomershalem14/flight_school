use crate::db::AppState;
use crate::domain::rules::{check_shift_violations, ensure_shift_within_type_coverage};
use crate::error::AppError;
use crate::json_util::sqlite_row_to_object;
use chrono::NaiveDate;
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct ShiftCreate {
    pub shift_date: String,
    pub shift_type_id: i64,
    pub start_time: String,
    pub end_time: String,
    pub employee_id: Option<i64>,
}

/// Partial update. `employee_id`: omitted = no change, number = set, JSON `null` = clear assignment.
#[derive(Debug, Deserialize, Default)]
pub struct ShiftUpdate {
    pub employee_id: Option<Value>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

#[tauri::command]
pub fn get_shifts(state: State<'_, AppState>, week_start: String) -> Result<Vec<Value>, String> {
    let week_end = parse_week_end(&week_start).map_err(|e| e.to_string())?;
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT s.*, st.name as type_name, st.color as type_color,
                        st.duration_minutes, st.prep_minutes, st.recovery_minutes,
                        e.name as emp_name, r.name as role_name, r.color as role_color
                 FROM shifts s
                 JOIN shift_types st ON s.shift_type_id = st.id
                 LEFT JOIN employees e ON s.employee_id = e.id
                 LEFT JOIN roles r ON e.role_id = r.id
                 WHERE s.shift_date BETWEEN ? AND ?
                 ORDER BY s.shift_date, s.start_time",
            )?;
            let rows = stmt.query_map(params![week_start, week_end], |row| {
                sqlite_row_to_object(row)
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::from)?);
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())
}

fn validate_shift_against_type(
    conn: &rusqlite::Connection,
    shift_type_id: i64,
    shift_date: &str,
    start_time: &str,
    end_time: &str,
) -> Result<(), AppError> {
    let (cs, ce): (String, String) = conn.query_row(
        "SELECT coverage_start, coverage_end FROM shift_types WHERE id = ?",
        [shift_type_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    ensure_shift_within_type_coverage(&cs, &ce, shift_date, start_time, end_time)
        .map_err(AppError::msg)
}

pub(crate) fn parse_week_end(week_start: &str) -> Result<String, AppError> {
    let dt = NaiveDate::parse_from_str(week_start, "%Y-%m-%d")
        .map_err(|_| AppError::msg("פורמט תאריך שגוי - השתמש ב-YYYY-MM-DD"))?;
    Ok((dt + chrono::Duration::days(6))
        .format("%Y-%m-%d")
        .to_string())
}

#[tauri::command]
pub fn create_shift(state: State<'_, AppState>, payload: ShiftCreate) -> Result<Value, String> {
    state
        .with_db(|conn| {
            validate_shift_against_type(
                conn,
                payload.shift_type_id,
                &payload.shift_date,
                &payload.start_time,
                &payload.end_time,
            )?;
            conn.execute(
                "INSERT INTO shifts (shift_date, shift_type_id, start_time, end_time, employee_id)
                 VALUES (?,?,?,?,?)",
                params![
                    payload.shift_date,
                    payload.shift_type_id,
                    payload.start_time,
                    payload.end_time,
                    payload.employee_id,
                ],
            )?;
            let new_id = conn.last_insert_rowid();
            let mut violations = Vec::new();
            if payload.employee_id.is_some() {
                for v in check_shift_violations(conn, new_id).map_err(AppError::from)? {
                    violations.push(v.to_json());
                }
            }
            Ok(json!({ "id": new_id, "violations": violations }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_shift(
    state: State<'_, AppState>,
    shift_id: i64,
    payload: ShiftUpdate,
) -> Result<Value, String> {
    state
        .with_db(|conn| {
            let (stid, sd, mut st, mut et, existing_emp): (i64, String, String, String, Option<i64>) =
                match conn.query_row(
                    "SELECT shift_type_id, shift_date, start_time, end_time, employee_id FROM shifts WHERE id = ?",
                    [shift_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                ) {
                    Ok(v) => v,
                    Err(rusqlite::Error::QueryReturnedNoRows) => {
                        return Err(AppError::msg("משמרת לא נמצאה"));
                    }
                    Err(e) => return Err(AppError::from(e)),
                };

            if let Some(ref s) = payload.start_time {
                st.clone_from(s);
            }
            if let Some(ref e) = payload.end_time {
                et.clone_from(e);
            }
            validate_shift_against_type(conn, stid, &sd, &st, &et)?;

            let mut emp_after = existing_emp;

            if let Some(ref ev) = payload.employee_id {
                match ev {
                    Value::Null => {
                        conn.execute(
                            "UPDATE shifts SET employee_id = NULL WHERE id = ?",
                            [shift_id],
                        )?;
                        emp_after = None;
                    }
                    Value::Number(n) => {
                        let eid = n.as_i64().ok_or_else(|| AppError::msg("employee_id לא תקין"))?;
                        conn.execute(
                            "UPDATE shifts SET employee_id = ? WHERE id = ?",
                            params![eid, shift_id],
                        )?;
                        emp_after = Some(eid);
                    }
                    _ => return Err(AppError::msg("employee_id לא תקין")),
                }
            }

            if let Some(ref s) = payload.start_time {
                conn.execute(
                    "UPDATE shifts SET start_time = ? WHERE id = ?",
                    params![s, shift_id],
                )?;
            }
            if let Some(ref e) = payload.end_time {
                conn.execute(
                    "UPDATE shifts SET end_time = ? WHERE id = ?",
                    params![e, shift_id],
                )?;
            }

            let mut violations = Vec::new();
            if emp_after.is_some() {
                for v in check_shift_violations(conn, shift_id).map_err(AppError::from)? {
                    violations.push(v.to_json());
                }
            }

            Ok(json!({ "ok": true, "violations": violations }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_shift(state: State<'_, AppState>, shift_id: i64) -> Result<Value, String> {
    state
        .with_db(|conn| {
            conn.execute("DELETE FROM shifts WHERE id = ?", [shift_id])?;
            Ok(json!({"ok": true}))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_shift_violations(state: State<'_, AppState>, shift_id: i64) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            let mut out = Vec::new();
            for v in check_shift_violations(conn, shift_id).map_err(AppError::from)? {
                out.push(v.to_json());
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_day_violations(state: State<'_, AppState>, date: String) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            crate::domain::rules::check_all_violations_for_date(conn, &date)
                .map_err(AppError::from)
        })
        .map_err(|e| e.to_string())
}
