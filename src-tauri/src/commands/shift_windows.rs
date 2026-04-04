use crate::db::AppState;
use crate::domain::rules::parse_iso_datetime;
use crate::domain::syllabus::{
    expand_segments_to_slot_ids, parse_slot_preset_ids, run_length_segments_from_slots, SegmentInput,
};
use crate::error::AppError;
use crate::json_util::sqlite_row_to_object;
use chrono::{Duration, NaiveDate};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct WindowSegment {
    pub syllabus_preset_id: i64,
    pub segment_start_time: String,
}

#[derive(Debug, Deserialize)]
pub struct ShiftWindowCreate {
    pub name: String,
    #[serde(default = "default_color")]
    pub color: String,
    pub notes: Option<String>,
    pub coverage_start: String,
    pub coverage_end: String,
    pub segments: Vec<WindowSegment>,
}

#[derive(Debug, Deserialize)]
pub struct ShiftWindowUpdate {
    pub name: String,
    #[serde(default = "default_color")]
    pub color: String,
    pub notes: Option<String>,
    pub coverage_start: String,
    pub coverage_end: String,
    pub segments: Vec<WindowSegment>,
}

fn default_color() -> String {
    "#6366F1".to_string()
}

fn validate_coverage_window(start: &str, end: &str) -> Result<(), String> {
    let cs = parse_iso_datetime(start).ok_or_else(|| "coverage_start לא תקין".to_string())?;
    let ce = parse_iso_datetime(end).ok_or_else(|| "coverage_end לא תקין".to_string())?;
    if ce <= cs {
        return Err("חלון כיסוי חייב להיות עם סיום אחרי התחלה".to_string());
    }
    Ok(())
}

fn day_overlap_bounds(ymd: &str) -> Result<(String, String), String> {
    let dt = NaiveDate::parse_from_str(ymd, "%Y-%m-%d")
        .map_err(|_| "פורמט תאריך שגוי — השתמש ב-YYYY-MM-DD".to_string())?;
    let next = dt + Duration::days(1);
    Ok((
        format!("{}T00:00:00", dt.format("%Y-%m-%d")),
        format!("{}T00:00:00", next.format("%Y-%m-%d")),
    ))
}

fn duration_lookup(
    conn: &rusqlite::Connection,
) -> impl Fn(i64) -> Option<i32> + '_ {
    |id: i64| {
        conn
            .query_row(
                "SELECT duration_minutes FROM syllabus_presets WHERE id = ?",
                [id],
                |r| r.get(0),
            )
            .ok()
    }
}

fn expand_and_json(
    conn: &rusqlite::Connection,
    coverage_start: &str,
    coverage_end: &str,
    segments: &[WindowSegment],
) -> Result<String, String> {
    if segments.is_empty() {
        return Err("נדרש לפחות שורת סילבוס אחת".to_string());
    }
    let segs: Vec<SegmentInput> = segments
        .iter()
        .map(|s| SegmentInput {
            syllabus_preset_id: s.syllabus_preset_id,
            segment_start_time: s.segment_start_time.clone(),
        })
        .collect();
    let dl = duration_lookup(conn);
    let ids = expand_segments_to_slot_ids(coverage_start, coverage_end, &segs, |id| dl(id))?;
    serde_json::to_string(&ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_shift_windows(
    state: State<'_, AppState>,
    date: Option<String>,
) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            let mut out = Vec::new();
            if let Some(ref d) = date {
                let (day_start, day_end_excl) = day_overlap_bounds(d).map_err(AppError::msg)?;
                let mut stmt = conn.prepare(
                    "SELECT w.*
                     FROM shift_windows w
                     WHERE w.coverage_start < ?1 AND w.coverage_end > ?2
                     ORDER BY w.id",
                )?;
                let rows = stmt.query_map(params![day_end_excl, day_start], |row| {
                    sqlite_row_to_object(row)
                })?;
                for r in rows {
                    let mut v = r.map_err(crate::error::AppError::from)?;
                    enrich_window_json(conn, &mut v)?;
                    out.push(v);
                }
            } else {
                let mut stmt = conn.prepare("SELECT w.* FROM shift_windows w ORDER BY w.id")?;
                let rows = stmt.query_map([], |row| sqlite_row_to_object(row))?;
                for r in rows {
                    let mut v = r.map_err(crate::error::AppError::from)?;
                    enrich_window_json(conn, &mut v)?;
                    out.push(v);
                }
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())
}

fn enrich_window_json(conn: &rusqlite::Connection, v: &mut Value) -> Result<(), AppError> {
    let obj = v.as_object_mut().ok_or_else(|| AppError::msg("שורה לא תקינה"))?;
    let sj = obj
        .get("syllabus_slot_preset_ids")
        .and_then(|x| x.as_str())
        .unwrap_or("[]")
        .to_string();
    let cs = obj
        .get("coverage_start")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let slot_ids = parse_slot_preset_ids(&sj).map_err(AppError::msg)?;
    let dl = duration_lookup(conn);
    let segments = run_length_segments_from_slots(&cs, &slot_ids, |id| dl(id)).map_err(AppError::msg)?;
    let seg_json: Vec<Value> = segments
        .into_iter()
        .map(|s| {
            json!({
                "syllabus_preset_id": s.syllabus_preset_id,
                "segment_start_time": s.segment_start_time,
            })
        })
        .collect();
    obj.insert("segments".into(), Value::Array(seg_json));
    Ok(())
}

#[tauri::command]
pub fn create_shift_window(
    state: State<'_, AppState>,
    payload: ShiftWindowCreate,
) -> Result<Value, String> {
    validate_coverage_window(&payload.coverage_start, &payload.coverage_end)?;
    state
        .with_db(|conn| {
            let slots_json = expand_and_json(
                conn,
                &payload.coverage_start,
                &payload.coverage_end,
                &payload.segments,
            )
            .map_err(AppError::msg)?;
            conn.execute(
                "INSERT INTO shift_windows
                 (name, color, notes, coverage_start, coverage_end, syllabus_slot_preset_ids)
                 VALUES (?,?,?,?,?,?)",
                params![
                    payload.name,
                    payload.color,
                    payload.notes,
                    payload.coverage_start,
                    payload.coverage_end,
                    slots_json,
                ],
            )?;
            let id = conn.last_insert_rowid();
            Ok(json!({ "id": id }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_shift_window(
    state: State<'_, AppState>,
    shift_window_id: i64,
    payload: ShiftWindowUpdate,
) -> Result<Value, String> {
    validate_coverage_window(&payload.coverage_start, &payload.coverage_end)?;
    state
        .with_db(|conn| {
            let slots_json = expand_and_json(
                conn,
                &payload.coverage_start,
                &payload.coverage_end,
                &payload.segments,
            )
            .map_err(AppError::msg)?;
            let n = conn.execute(
                "UPDATE shift_windows SET
                    name = ?1,
                    color = ?2,
                    notes = ?3,
                    coverage_start = ?4,
                    coverage_end = ?5,
                    syllabus_slot_preset_ids = ?6
                 WHERE id = ?7",
                params![
                    payload.name,
                    payload.color,
                    payload.notes,
                    payload.coverage_start,
                    payload.coverage_end,
                    slots_json,
                    shift_window_id,
                ],
            )?;
            if n == 0 {
                return Err(crate::error::AppError::msg("חלון משמרת לא נמצא"));
            }

            conn.execute(
                "UPDATE shifts SET up_to_date = 0 WHERE shift_window_id = ?",
                [shift_window_id],
            )
            .map_err(AppError::from)?;

            Ok(json!({ "ok": true, "id": shift_window_id }))
        })
        .map_err(|e| e.to_string())
}

/// Deletes all shifts for this window, then the window row.
#[tauri::command]
pub fn delete_shift_window(state: State<'_, AppState>, shift_window_id: i64) -> Result<Value, String> {
    state
        .with_db_mut(|conn| {
            let tx = conn.transaction().map_err(crate::error::AppError::from)?;
            let deleted_shifts = tx
                .execute(
                    "DELETE FROM shifts WHERE shift_window_id = ?1",
                    params![shift_window_id],
                )
                .map_err(crate::error::AppError::from)?;
            let deleted = tx
                .execute("DELETE FROM shift_windows WHERE id = ?1", params![shift_window_id])
                .map_err(crate::error::AppError::from)?;
            if deleted == 0 {
                return Err(crate::error::AppError::msg("חלון משמרת לא נמצא"));
            }
            tx.commit().map_err(crate::error::AppError::from)?;
            Ok(json!({
                "ok": true,
                "deleted_shifts": deleted_shifts,
            }))
        })
        .map_err(|e| e.to_string())
}
