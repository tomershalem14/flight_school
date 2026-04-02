use crate::db::AppState;
use crate::domain::rules::get_weekly_workload;
use crate::error::AppError;
use crate::json_util::sqlite_row_to_object;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub fn get_workload_report(state: State<'_, AppState>, week_start: String) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare("SELECT id, name FROM employees WHERE is_active = 1")?;
            let emps: Vec<(i64, String)> = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
                .filter_map(|x| x.ok())
                .collect();
            let mut report = Vec::new();
            for (id, name) in emps {
                let mut wl = get_weekly_workload(conn, id, &week_start).map_err(|e| AppError::msg(e))?;
                if let Value::Object(ref mut m) = wl {
                    m.insert("employee_id".into(), json!(id));
                    m.insert("employee_name".into(), json!(name));
                }
                report.push(wl);
            }
            Ok(report)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_employee_history(
    state: State<'_, AppState>,
    employee_id: i64,
    limit: Option<i64>,
) -> Result<Vec<Value>, String> {
    let limit = limit.unwrap_or(20);
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT s.id, s.shift_date, s.start_time, s.end_time, s.notes,
                        st.name as type_name, st.color as type_color
                 FROM shifts s
                 JOIN shift_types st ON s.shift_type_id = st.id
                 WHERE s.employee_id = ?
                 ORDER BY s.shift_date DESC, s.start_time DESC
                 LIMIT ?",
            )?;
            let rows = stmt.query_map(params![employee_id, limit], |row| sqlite_row_to_object(row))?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::from)?);
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_last_shift(state: State<'_, AppState>, employee_id: i64) -> Result<Option<Value>, String> {
    state
        .with_db(|conn| {
            let row = conn.query_row(
                "SELECT s.shift_date, s.start_time, s.end_time, st.name as type_name
                 FROM shifts s
                 JOIN shift_types st ON s.shift_type_id = st.id
                 WHERE s.employee_id = ? AND s.shift_date <= date('now')
                 ORDER BY s.shift_date DESC, s.start_time DESC
                 LIMIT 1",
                [employee_id],
                |r| sqlite_row_to_object(r),
            );
            match row {
                Ok(v) => Ok(Some(v)),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(AppError::from(e)),
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_shift_count_report(state: State<'_, AppState>, week_start: String) -> Result<Vec<Value>, String> {
    let week_end = crate::commands::shifts::parse_week_end(&week_start).map_err(|e| e.to_string())?;
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT e.name as emp_name, st.name as type_name, COUNT(*) as count
                 FROM shifts s
                 JOIN employees e ON s.employee_id = e.id
                 JOIN shift_types st ON s.shift_type_id = st.id
                 WHERE s.shift_date BETWEEN ? AND ? AND s.employee_id IS NOT NULL
                 GROUP BY e.id, st.id
                 ORDER BY e.name, st.name",
            )?;
            let rows = stmt.query_map(params![week_start, week_end], |row| sqlite_row_to_object(row))?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::from)?);
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())
}
