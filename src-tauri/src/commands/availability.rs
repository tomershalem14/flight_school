use crate::commands::shifts::parse_week_end;
use crate::db::AppState;
use crate::domain::rules::time_to_minutes;
use crate::error::{AppError, AppResult};
use crate::json_util::sqlite_row_to_object;
use chrono::NaiveTime;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;

fn validate_ymd(s: &str) -> Result<(), String> {
    if s.len() != 10 || s.chars().nth(4) != Some('-') || s.chars().nth(7) != Some('-') {
        return Err("פורמט תאריך שגוי".to_string());
    }
    Ok(())
}

fn normalize_hhmm(s: &str) -> Result<String, AppError> {
    let t = s.trim();
    let nt = NaiveTime::parse_from_str(t, "%H:%M:%S")
        .or_else(|_| NaiveTime::parse_from_str(t, "%H:%M"))
        .map_err(|_| AppError::msg("שעה לא תקינה"))?;
    Ok(nt.format("%H:%M").to_string())
}

#[tauri::command]
pub fn list_availability_for_week(
    state: State<'_, AppState>,
    week_start: String,
) -> Result<Vec<Value>, String> {
    validate_ymd(&week_start)?;
    let week_end = parse_week_end(&week_start).map_err(|e| e.to_string())?;
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT a.*
                 FROM availability a
                 WHERE a.avail_date BETWEEN ?1 AND ?2
                 ORDER BY a.avail_date, a.employee_id, a.start_time IS NULL DESC, a.start_time, a.id",
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

#[tauri::command]
pub fn create_availability_whole_day(
    state: State<'_, AppState>,
    employee_id: i64,
    avail_date: String,
) -> Result<Value, String> {
    validate_ymd(&avail_date)?;
    if employee_id <= 0 {
        return Err("מזהה מפעיל לא תקין".to_string());
    }
    state
        .with_db_mut(|conn| -> AppResult<Value> {
            let emp: i64 = conn.query_row(
                "SELECT COUNT(*) FROM employees WHERE id = ?",
                [employee_id],
                |r| r.get(0),
            )?;
            if emp == 0 {
                return Err(AppError::msg("מפעיל לא נמצא"));
            }
            let existing: i64 = conn.query_row(
                "SELECT COUNT(*) FROM availability WHERE employee_id = ?1 AND avail_date = ?2",
                params![employee_id, avail_date],
                |r| r.get(0),
            )?;
            if existing > 0 {
                return Err(AppError::msg("כבר קיימת זמינות ליום זה"));
            }
            conn.execute(
                "INSERT INTO availability (employee_id, avail_date, start_time, end_time)
                 VALUES (?1, ?2, NULL, NULL)",
                params![employee_id, avail_date],
            )?;
            let id = conn.last_insert_rowid();
            Ok(json!({ "id": id, "employee_id": employee_id, "avail_date": avail_date }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_availability_timed(
    state: State<'_, AppState>,
    employee_id: i64,
    avail_date: String,
    start_time: String,
    end_time: String,
) -> Result<Value, String> {
    validate_ymd(&avail_date)?;
    if employee_id <= 0 {
        return Err("מזהה מפעיל לא תקין".to_string());
    }
    state
        .with_db_mut(|conn| -> AppResult<Value> {
            let emp_type: String = conn.query_row(
                "SELECT employee_type FROM employees WHERE id = ?",
                [employee_id],
                |r| r.get(0),
            )?;
            if emp_type != "extra" && emp_type != "reserve" && emp_type != "admin" {
                return Err(AppError::msg(
                    "זמינות לפי שעה זמינה רק למפעילי הצ\"ח / מילואים / ניהול",
                ));
            }
            let whole_day: i64 = conn.query_row(
                "SELECT COUNT(*) FROM availability WHERE employee_id = ?1 AND avail_date = ?2 \
                 AND start_time IS NULL AND end_time IS NULL",
                params![employee_id, avail_date],
                |r| r.get(0),
            )?;
            if whole_day > 0 {
                return Err(AppError::msg("קיימת זמינות \"כל היום\" ליום זה — יש למחוק אותה תחילה"));
            }
            let start_norm = normalize_hhmm(&start_time)?;
            let end_norm = normalize_hhmm(&end_time)?;
            let sm = time_to_minutes(&start_norm);
            let em = time_to_minutes(&end_norm);
            if sm >= em {
                return Err(AppError::msg("שעת ההתחלה חייבת להיות לפני שעת הסיום"));
            }
            conn.execute(
                "INSERT INTO availability (employee_id, avail_date, start_time, end_time)
                 VALUES (?1, ?2, ?3, ?4)",
                params![employee_id, avail_date, start_norm, end_norm],
            )?;
            let id = conn.last_insert_rowid();
            let row = conn.query_row(
                "SELECT a.* FROM availability a WHERE a.id = ?",
                [id],
                sqlite_row_to_object,
            )?;
            Ok(row)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_availability_by_id(state: State<'_, AppState>, id: i64) -> Result<Value, String> {
    if id <= 0 {
        return Err("מזהה לא תקין".to_string());
    }
    state
        .with_db_mut(|conn| -> AppResult<Value> {
            let n = conn.execute(
                "DELETE FROM availability WHERE id = ?1 \
                 AND employee_id IN (SELECT id FROM employees WHERE employee_type IN ('extra','reserve','admin'))",
                [id],
            )?;
            if n == 0 {
                return Err(AppError::msg("רשומת זמינות לא נמצאה או שאינה ניתנת למחיקה מכאן"));
            }
            Ok(json!({ "deleted": n, "id": id }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_availability_for_employee_day(
    state: State<'_, AppState>,
    employee_id: i64,
    avail_date: String,
) -> Result<Value, String> {
    validate_ymd(&avail_date)?;
    if employee_id <= 0 {
        return Err("מזהה מפעיל לא תקין".to_string());
    }
    state
        .with_db_mut(|conn| -> AppResult<Value> {
            let tx = conn.transaction()?;
            let n = tx.execute(
                "DELETE FROM availability WHERE employee_id = ?1 AND avail_date = ?2",
                params![employee_id, avail_date],
            )?;
            tx.commit()?;
            Ok(json!({ "deleted": n }))
        })
        .map_err(|e| e.to_string())
}
