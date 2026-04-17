use crate::commands::shifts::parse_week_end;
use crate::db::AppState;
use crate::error::{AppError, AppResult};
use crate::json_util::sqlite_row_to_object;
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

const EVENT_KINDS: &[&str] = &["constraint", "event", "operational"];

#[derive(Debug, Deserialize)]
pub struct ScheduleEventCreate {
    pub shift_date: String,
    pub employee_id: i64,
    pub start_time: String,
    pub end_time: String,
    pub name: String,
    #[serde(default)]
    pub notes: Option<String>,
    pub event_kind: String,
}

fn normalize_hm(raw: &str) -> Result<String, String> {
    let t = raw.trim();
    let (hstr, rest) = t
        .split_once(':')
        .ok_or_else(|| "פורמט שעה לא תקין".to_string())?;
    let mstr = rest
        .split_once(':')
        .map(|(a, _)| a)
        .unwrap_or(rest);
    let h: i64 = hstr
        .parse()
        .map_err(|_| "שעה לא תקינה".to_string())?;
    let min: i64 = mstr
        .parse()
        .map_err(|_| "דקות לא תקינות".to_string())?;
    if !(0..=23).contains(&h) || !(0..=59).contains(&min) {
        return Err("שעה מחוץ לטווח".to_string());
    }
    Ok(format!("{:02}:{:02}", h, min))
}

fn validate_ymd(s: &str) -> Result<(), String> {
    if s.len() != 10 || s.chars().nth(4) != Some('-') || s.chars().nth(7) != Some('-') {
        return Err("פורמט תאריך שגוי".to_string());
    }
    Ok(())
}

/// Minutes since midnight for normalized `HH:mm` (same calendar day; no overnight).
fn minutes_since_midnight_hm(hm: &str) -> Result<i64, String> {
    let t = normalize_hm(hm)?;
    let (h, m) = t.split_once(':').unwrap();
    let hh: i64 = h.parse().map_err(|_| "שעה לא תקינה".to_string())?;
    let mm: i64 = m.parse().map_err(|_| "דקות לא תקינות".to_string())?;
    Ok(hh * 60 + mm)
}

#[derive(Debug, Deserialize)]
pub struct ScheduleEventUpdateTimes {
    pub event_id: i64,
    pub start_time: String,
    pub end_time: String,
}

#[tauri::command]
pub fn get_schedule_events(
    state: State<'_, AppState>,
    week_start: String,
) -> Result<Vec<Value>, String> {
    let week_end = parse_week_end(&week_start).map_err(|e| e.to_string())?;
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT se.*, e.name as emp_name
                 FROM schedule_events se
                 JOIN employees e ON se.employee_id = e.id
                 WHERE se.shift_date BETWEEN ?1 AND ?2
                 ORDER BY se.shift_date, se.start_time, se.id",
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
pub fn create_schedule_event(
    state: State<'_, AppState>,
    payload: ScheduleEventCreate,
) -> Result<Value, String> {
    let name = payload.name.trim();
    if name.is_empty() || name.chars().count() > 18 {
        return Err("שם האירוע חייב להיות עד 18 תווים".to_string());
    }
    if !EVENT_KINDS.contains(&payload.event_kind.as_str()) {
        return Err("סוג אירוע לא תקין".to_string());
    }
    validate_ymd(&payload.shift_date)?;
    let start_time = normalize_hm(&payload.start_time)?;
    let end_time = normalize_hm(&payload.end_time)?;
    if payload.employee_id <= 0 {
        return Err("מזהה מפעיל לא תקין".to_string());
    }
    let notes = payload.notes.unwrap_or_default();

    state
        .with_db_mut(|conn| -> AppResult<Value> {
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) FROM employees WHERE id = ?",
                [payload.employee_id],
                |r| r.get(0),
            )?;
            if n == 0 {
                return Err(AppError::msg("מפעיל לא נמצא"));
            }
            conn.execute(
                "INSERT INTO schedule_events (shift_date, employee_id, start_time, end_time, name, notes, event_kind)
                 VALUES (?,?,?,?,?,?,?)",
                params![
                    payload.shift_date,
                    payload.employee_id,
                    start_time,
                    end_time,
                    name,
                    notes,
                    payload.event_kind,
                ],
            )?;
            let id = conn.last_insert_rowid();
            Ok(json!({ "id": id }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_schedule_event(
    state: State<'_, AppState>,
    payload: ScheduleEventUpdateTimes,
) -> Result<Value, String> {
    if payload.event_id <= 0 {
        return Err("מזהה אירוע לא תקין".to_string());
    }
    let start_time = normalize_hm(&payload.start_time)?;
    let end_time = normalize_hm(&payload.end_time)?;
    let sm = minutes_since_midnight_hm(&start_time)?;
    let em = minutes_since_midnight_hm(&end_time)?;
    if em <= sm {
        return Err("שעת סיום חייבת להיות אחרי שעת ההתחלה".to_string());
    }
    if em - sm < 15 {
        return Err("משך האירוע חייב להיות לפחות 15 דקות".to_string());
    }

    state
        .with_db_mut(|conn| -> AppResult<Value> {
            let n = conn.execute(
                "UPDATE schedule_events SET start_time = ?, end_time = ? WHERE id = ?",
                params![start_time, end_time, payload.event_id],
            )?;
            if n == 0 {
                return Err(AppError::msg("אירוע לא נמצא"));
            }
            Ok(json!({ "ok": true }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_schedule_event(state: State<'_, AppState>, event_id: i64) -> Result<Value, String> {
    if event_id <= 0 {
        return Err("מזהה אירוע לא תקין".to_string());
    }
    state
        .with_db_mut(|conn| -> AppResult<Value> {
            let n = conn.execute("DELETE FROM schedule_events WHERE id = ?", [event_id])?;
            if n == 0 {
                return Err(AppError::msg("אירוע לא נמצא"));
            }
            Ok(json!({ "ok": true }))
        })
        .map_err(|e| e.to_string())
}
