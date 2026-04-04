use crate::db::AppState;
use crate::domain::rules::check_shift_violations;
use crate::domain::syllabus::shift_row_from_syllabus_num;
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
    pub shift_window_id: i64,
    pub syllabus_num: i64,
    pub employee_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ReassignShiftEmployee {
    pub shift_id: i64,
    pub employee_id: i64,
}

#[tauri::command]
pub fn get_shifts(state: State<'_, AppState>, week_start: String) -> Result<Vec<Value>, String> {
    let week_end = parse_week_end(&week_start).map_err(|e| e.to_string())?;
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT s.*, w.name as type_name, w.color as type_color,
                        sp.duration_minutes, sp.prep_minutes, sp.recovery_minutes,
                        e.name as emp_name, r.name as role_name, r.color as role_color
                 FROM shifts s
                 JOIN shift_windows w ON s.shift_window_id = w.id
                 JOIN syllabus_presets sp ON s.syllabus_preset_id = sp.id
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

pub(crate) fn parse_week_end(week_start: &str) -> Result<String, AppError> {
    let dt = NaiveDate::parse_from_str(week_start, "%Y-%m-%d")
        .map_err(|_| AppError::msg("פורמט תאריך שגוי - השתמש ב-YYYY-MM-DD"))?;
    Ok((dt + chrono::Duration::days(6))
        .format("%Y-%m-%d")
        .to_string())
}

fn ensure_employee_exists(conn: &rusqlite::Connection, employee_id: Option<i64>) -> Result<(), String> {
    let Some(eid) = employee_id else {
        return Ok(());
    };
    if eid <= 0 {
        return Err("מזהה מפעיל לא תקין".to_string());
    }
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM employees WHERE id = ?", [eid], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("מפעיל לא נמצא במסד הנתונים".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn create_shift(state: State<'_, AppState>, payload: ShiftCreate) -> Result<Value, String> {
    state
        .with_db(|conn| {
            let (st, et, pid, ps, re) = shift_row_from_syllabus_num(
                conn,
                payload.shift_window_id,
                &payload.shift_date,
                payload.syllabus_num,
            )
            .map_err(AppError::msg)?;
            ensure_employee_exists(conn, payload.employee_id).map_err(AppError::msg)?;
            conn.execute(
                "INSERT INTO shifts (shift_date, shift_window_id, start_time, end_time, syllabus_preset_id, prep_start, rest_end, employee_id, up_to_date, syllabus_num)
                 VALUES (?,?,?,?,?,?,?,?,1,?)",
                params![
                    payload.shift_date,
                    payload.shift_window_id,
                    st,
                    et,
                    pid,
                    ps,
                    re,
                    payload.employee_id,
                    payload.syllabus_num,
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
pub fn reassign_shift_employee(
    state: State<'_, AppState>,
    payload: ReassignShiftEmployee,
) -> Result<Value, String> {
    state
        .with_db_mut(|conn| {
            let (shift_date, wid, syllabus_num, old_emp): (String, i64, Option<i64>, Option<i64>) =
                conn.query_row(
                    "SELECT shift_date, shift_window_id, syllabus_num, employee_id FROM shifts WHERE id = ?",
                    [payload.shift_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .map_err(|_| AppError::msg("המשמרת לא נמצאה"))?;

            let Some(old) = old_emp else {
                return Err(AppError::msg("לא ניתן להעביר משמרת ללא מפעיל"));
            };
            let Some(sn) = syllabus_num else {
                return Err(AppError::msg(
                    "לא ניתן להעביר משמרת זו — חסר מספר סילבוס במסד (נסה ליצור משמרת חדשה)",
                ));
            };
            if old == payload.employee_id {
                return Err(AppError::msg("המפעיל כבר משויך למשמרת זו"));
            }

            ensure_employee_exists(conn, Some(payload.employee_id)).map_err(AppError::msg)?;

            let dup: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM shifts WHERE shift_date = ?1 AND shift_window_id = ?2 AND syllabus_num = ?3 AND employee_id = ?4 AND id != ?5",
                    params![
                        &shift_date,
                        wid,
                        sn,
                        payload.employee_id,
                        payload.shift_id
                    ],
                    |r| r.get(0),
                )
                .map_err(AppError::from)?;
            if dup > 0 {
                return Err(AppError::msg(
                    "למפעיל היעד כבר יש משמרת באותו חלון ובאותו מקום סילבוס",
                ));
            }

            let (st, et, pid, ps, re) = shift_row_from_syllabus_num(conn, wid, &shift_date, sn)
                .map_err(AppError::msg)?;

            let tx = conn.transaction().map_err(AppError::from)?;
            tx.execute("DELETE FROM shifts WHERE id = ?", [payload.shift_id])?;
            tx.execute(
                "INSERT INTO shifts (shift_date, shift_window_id, start_time, end_time, syllabus_preset_id, prep_start, rest_end, employee_id, up_to_date, syllabus_num)
                 VALUES (?,?,?,?,?,?,?,?,1,?)",
                params![
                    shift_date,
                    wid,
                    st,
                    et,
                    pid,
                    ps,
                    re,
                    payload.employee_id,
                    sn,
                ],
            )?;
            let new_id = tx.last_insert_rowid();
            tx.commit().map_err(AppError::from)?;

            let mut violations = Vec::new();
            for v in check_shift_violations(conn, new_id).map_err(AppError::from)? {
                violations.push(v.to_json());
            }
            Ok(json!({ "id": new_id, "violations": violations }))
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
