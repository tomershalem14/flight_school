//! Syllabus presets, shift-window slot lists, expansion, and shift boundary denormalization.

use crate::domain::rules::{parse_hms, parse_iso_datetime, time_to_minutes};
use chrono::{Duration, NaiveDate, NaiveDateTime, Timelike};
use rusqlite::{params, Connection, Transaction};
use serde_json;
use std::collections::HashMap;

/// Default materialized slot length for migration / cascade (matches locked system preset).
pub const DEFAULT_SLOT_MINUTES: i32 = 60;

#[derive(Clone, Debug)]
pub struct SegmentInput {
    pub syllabus_preset_id: i64,
    /// Wall time HH:mm or HH:mm:ss (same day semantics as coverage).
    pub segment_start_time: String,
}

/// Minutes along one logical day from coverage_start clock to coverage_end clock (overnight window supported).
pub fn coverage_daily_span_minutes(
    coverage_start_iso: &str,
    coverage_end_iso: &str,
) -> Result<i64, String> {
    let cs = parse_iso_datetime(coverage_start_iso)
        .ok_or_else(|| "coverage_start לא תקין".to_string())?;
    let ce = parse_iso_datetime(coverage_end_iso)
        .ok_or_else(|| "coverage_end לא תקין".to_string())?;
    let m0 = cs.hour() as i64 * 60 + cs.minute() as i64;
    let m1 = ce.hour() as i64 * 60 + ce.minute() as i64;
    Ok(if m1 > m0 {
        m1 - m0
    } else {
        24 * 60 - m0 + m1
    })
}

pub fn floor_slot_count(span_minutes: i64, slot_minutes: i32) -> usize {
    if span_minutes <= 0 || slot_minutes <= 0 {
        return 0;
    }
    (span_minutes / slot_minutes as i64) as usize
}

pub fn json_preset_slot_array(preset_id: i64, count: usize) -> String {
    let v: Vec<i64> = vec![preset_id; count];
    serde_json::to_string(&v).unwrap_or_else(|_| "[]".to_string())
}

pub fn parse_slot_preset_ids(json: &str) -> Result<Vec<i64>, String> {
    serde_json::from_str(json).map_err(|e| e.to_string())
}

pub fn default_syllabus_preset_id(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT id FROM syllabus_presets WHERE system_locked = 1 LIMIT 1",
        [],
        |r| r.get(0),
    )
}

/// Load duration_minutes for preset ids (missing id -> omitted).
pub fn load_preset_durations(
    conn: &Connection,
    ids: &[i64],
) -> rusqlite::Result<HashMap<i64, i32>> {
    let mut map = HashMap::new();
    for &id in ids {
        if map.contains_key(&id) {
            continue;
        }
        let d: Result<i32, rusqlite::Error> = conn.query_row(
            "SELECT duration_minutes FROM syllabus_presets WHERE id = ?",
            [id],
            |r| r.get(0),
        );
        if let Ok(v) = d {
            map.insert(id, v);
        }
    }
    Ok(map)
}

pub fn load_preset_timings(
    conn: &Connection,
    preset_id: i64,
) -> rusqlite::Result<(i32, i32)> {
    conn.query_row(
        "SELECT prep_minutes, rest_minutes FROM syllabus_presets WHERE id = ?",
        [preset_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
}

/// Prep and rest minutes plus joint flags for chained prep_start / rest_end.
#[derive(Clone, Copy, Debug)]
pub struct PresetPrepRestMeta {
    pub prep_minutes: i32,
    pub rest_minutes: i32,
    pub joint_prep: bool,
    pub joint_rest: bool,
}

pub fn load_preset_prep_rest_meta(
    conn: &Connection,
    preset_id: i64,
) -> rusqlite::Result<PresetPrepRestMeta> {
    conn.query_row(
        "SELECT prep_minutes, rest_minutes, joint_prep, joint_rest FROM syllabus_presets WHERE id = ?",
        [preset_id],
        |r| {
            let jp: i32 = r.get(2)?;
            let jrest: i32 = r.get(3)?;
            Ok(PresetPrepRestMeta {
                prep_minutes: r.get(0)?,
                rest_minutes: r.get(1)?,
                joint_prep: jp != 0,
                joint_rest: jrest != 0,
            })
        },
    )
}

pub fn load_presets_prep_rest_meta(
    conn: &Connection,
    ids: &[i64],
) -> rusqlite::Result<HashMap<i64, PresetPrepRestMeta>> {
    let mut out = HashMap::new();
    for &id in ids {
        if out.contains_key(&id) {
            continue;
        }
        if let Ok(m) = load_preset_prep_rest_meta(conn, id) {
            out.insert(id, m);
        }
    }
    Ok(out)
}

/// Anchor datetime on `shift_date` using the time-of-day from `coverage_start_iso`.
fn coverage_anchor_on_date(coverage_start_iso: &str, shift_date: &str) -> Result<NaiveDateTime, String> {
    let cs = parse_iso_datetime(coverage_start_iso)
        .ok_or_else(|| "coverage_start לא תקין".to_string())?;
    let d = NaiveDate::parse_from_str(shift_date, "%Y-%m-%d")
        .map_err(|_| "תאריך משמרת לא תקין".to_string())?;
    Ok(NaiveDateTime::new(d, cs.time()))
}

fn shift_start_datetime(shift_date: &str, start_time: &str) -> Result<NaiveDateTime, String> {
    let d = NaiveDate::parse_from_str(shift_date, "%Y-%m-%d")
        .map_err(|_| "תאריך משמרת לא תקין".to_string())?;
    let t = parse_hms(start_time).ok_or_else(|| "שעת התחלה לא תקינה".to_string())?;
    Ok(NaiveDateTime::new(d, t))
}

/// Segment wall time placed on the coverage timeline (same calendar day as `cov_start`, or next day if before anchor clock).
fn segment_instant_on_timeline(cov_start: NaiveDateTime, hhmm: &str) -> Result<NaiveDateTime, String> {
    let t = parse_hms(hhmm).ok_or_else(|| "שעת סגמנט לא תקינה".to_string())?;
    let d = cov_start.date();
    let mut dt = NaiveDateTime::new(d, t);
    if dt < cov_start {
        dt += Duration::days(1);
    }
    Ok(dt)
}

/// Returns slot index if `start_time` falls in `[T_i, T_i + duration_i)`.
pub fn slot_index_for_shift_start(
    coverage_start_iso: &str,
    shift_date: &str,
    start_time: &str,
    slot_preset_ids: &[i64],
    durations: &HashMap<i64, i32>,
) -> Result<Option<usize>, String> {
    if slot_preset_ids.is_empty() {
        return Ok(None);
    }
    let mut t = coverage_anchor_on_date(coverage_start_iso, shift_date)?;
    let start_dt = shift_start_datetime(shift_date, start_time)?;
    for (i, &pid) in slot_preset_ids.iter().enumerate() {
        let dur = *durations
            .get(&pid)
            .ok_or_else(|| format!("סילבוס {pid} לא נמצא"))?;
        if dur <= 0 {
            return Err("משך סילבוס חייב להיות חיובי".to_string());
        }
        let end_slot = t + Duration::minutes(dur as i64);
        if start_dt >= t && start_dt < end_slot {
            return Ok(Some(i));
        }
        t = end_slot;
    }
    Ok(None)
}

/// Wall-clock HH:mm from minutes since midnight (0..1440 wrapped).
pub fn minutes_to_hhmm(mut m: i32) -> String {
    m = m.rem_euclid(24 * 60);
    format!("{:02}:{:02}", m / 60, m % 60)
}

pub fn compute_prep_start_rest_end(
    start_time: &str,
    end_time: &str,
    prep_minutes: i32,
    rest_minutes: i32,
) -> (String, String) {
    let sm = time_to_minutes(start_time);
    let em = time_to_minutes(end_time);
    let prep_start = minutes_to_hhmm(sm - prep_minutes);
    let rest_end = minutes_to_hhmm(em + rest_minutes);
    (prep_start, rest_end)
}

/// Slot `syllabus_num` (0-based) → wall-clock start/end on `shift_date` and preset id.
pub fn shift_bounds_from_syllabus_num(
    conn: &Connection,
    shift_window_id: i64,
    shift_date: &str,
    syllabus_num: i64,
) -> Result<(String, String, i64), String> {
    if syllabus_num < 0 {
        return Err("מספר סילבוס לא תקין".to_string());
    }
    let idx = syllabus_num as usize;
    let (cov_start, _cov_end, slots_json): (String, String, String) = conn
        .query_row(
            "SELECT coverage_start, coverage_end, syllabus_slot_preset_ids FROM shift_windows WHERE id = ?",
            [shift_window_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "חלון משמרת לא נמצא".to_string())?;

    let slot_ids = parse_slot_preset_ids(&slots_json)?;
    if idx >= slot_ids.len() {
        return Err("מספר סילבוס לא תקף לחלון זה".to_string());
    }
    let durs = load_preset_durations(conn, &slot_ids).map_err(|e| e.to_string())?;

    let mut t = coverage_anchor_on_date(&cov_start, shift_date)?;
    for i in 0..idx {
        let pid = slot_ids[i];
        let dur = *durs
            .get(&pid)
            .ok_or_else(|| format!("סילבוס {pid} לא נמצא"))?;
        if dur <= 0 {
            return Err("משך סילבוס חייב להיות חיובי".to_string());
        }
        t += Duration::minutes(dur as i64);
    }
    let preset_id = slot_ids[idx];
    let dur = *durs
        .get(&preset_id)
        .ok_or_else(|| format!("סילבוס {preset_id} לא נמצא"))?;
    if dur <= 0 {
        return Err("משך סילבוס חייב להיות חיובי".to_string());
    }
    let slot_end = t + Duration::minutes(dur as i64);
    let start_hhmm = format!(
        "{:02}:{:02}",
        t.time().hour(),
        t.time().minute()
    );
    let end_hhmm = format!(
        "{:02}:{:02}",
        slot_end.time().hour(),
        slot_end.time().minute()
    );
    Ok((start_hhmm, end_hhmm, preset_id))
}

/// Full denormalized row fields for `create_shift` from `syllabus_num`.
pub fn shift_row_from_syllabus_num(
    conn: &Connection,
    shift_window_id: i64,
    shift_date: &str,
    syllabus_num: i64,
) -> Result<(String, String, i64, String, String), String> {
    let (st, et, pid) = shift_bounds_from_syllabus_num(conn, shift_window_id, shift_date, syllabus_num)?;
    let (prep_m, rest_m) = load_preset_timings(conn, pid).map_err(|e| e.to_string())?;
    let (ps, re) = compute_prep_start_rest_end(&st, &et, prep_m, rest_m);
    Ok((st, et, pid, ps, re))
}

/// Resolve syllabus + boundaries for a shift row.
pub fn resolve_shift_syllabus_and_boundaries(
    conn: &Connection,
    shift_window_id: i64,
    shift_date: &str,
    start_time: &str,
    end_time: &str,
) -> Result<(i64, String, String), String> {
    let def_id = default_syllabus_preset_id(conn).map_err(|e| e.to_string())?;
    let (cov_start, _cov_end, slots_json): (String, String, String) = conn
        .query_row(
            "SELECT coverage_start, coverage_end, syllabus_slot_preset_ids FROM shift_windows WHERE id = ?",
            [shift_window_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "חלון משמרת לא נמצא".to_string())?;

    let slot_ids = parse_slot_preset_ids(&slots_json)?;
    let durs = load_preset_durations(conn, &slot_ids).map_err(|e| e.to_string())?;

    let idx = slot_index_for_shift_start(
        &cov_start,
        shift_date,
        start_time,
        &slot_ids,
        &durs,
    )?;

    let preset_id = if let Some(i) = idx {
        slot_ids[i]
    } else {
        def_id
    };

    let (prep_m, rest_m) = load_preset_timings(conn, preset_id).map_err(|e| e.to_string())?;
    let (prep_start, rest_end) = compute_prep_start_rest_end(start_time, end_time, prep_m, rest_m);
    Ok((preset_id, prep_start, rest_end))
}

/// Validate segment grid; row 0 time matches coverage_start clock.
fn validate_authoring_segments(
    cov_start: NaiveDateTime,
    segments: &[SegmentInput],
    duration_fn: impl Fn(i64) -> Option<i32>,
) -> Result<(), String> {
    if segments.is_empty() {
        return Err("נדרש לפחות שורת סילבוס אחת".to_string());
    }
    let t0 = parse_hms(&segments[0].segment_start_time)
        .ok_or_else(|| "שעת סגמנט לא תקינה".to_string())?;
    if t0 != cov_start.time() {
        return Err("שורה ראשונה חייבת להתחיל בזמן של coverage_start".to_string());
    }

    let mut prev_inst = segment_instant_on_timeline(cov_start, &segments[0].segment_start_time)?;
    let mut prev_dur = duration_fn(segments[0].syllabus_preset_id)
        .ok_or_else(|| "משך סילבוס לא נמצא".to_string())?;
    if prev_dur <= 0 {
        return Err("משך סילבוס חייב להיות חיובי".to_string());
    }

    for k in 1..segments.len() {
        let inst = segment_instant_on_timeline(cov_start, &segments[k].segment_start_time)?;
        let delta = (inst - prev_inst).num_minutes();
        if delta <= 0 || delta % prev_dur as i64 != 0 {
            return Err("שעת סגמנט לא על רשת משכי הסילבוס הקודם".to_string());
        }
        prev_inst = inst;
        prev_dur = duration_fn(segments[k].syllabus_preset_id)
            .ok_or_else(|| "משך סילבוס לא נמצא".to_string())?;
        if prev_dur <= 0 {
            return Err("משך סילבוס חייב להיות חיובי".to_string());
        }
    }
    Ok(())
}

/// Overflow-safe expansion from authoring segments into preset id list.
pub fn expand_segments_to_slot_ids(
    coverage_start_iso: &str,
    coverage_end_iso: &str,
    segments: &[SegmentInput],
    duration_fn: impl Fn(i64) -> Option<i32>,
) -> Result<Vec<i64>, String> {
    let cov_start = parse_iso_datetime(coverage_start_iso)
        .ok_or_else(|| "coverage_start לא תקין".to_string())?;
    let cov_end = parse_iso_datetime(coverage_end_iso)
        .ok_or_else(|| "coverage_end לא תקין".to_string())?;
    if cov_end <= cov_start {
        return Err("חלון כיסוי חייב להיות עם סיום אחרי התחלה".to_string());
    }

    validate_authoring_segments(cov_start, segments, |id| duration_fn(id))?;

    let seg_points: Vec<(NaiveDateTime, i64)> = segments
        .iter()
        .map(|s| {
            Ok((
                segment_instant_on_timeline(cov_start, &s.segment_start_time)?,
                s.syllabus_preset_id,
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let mut t = cov_start;
    let mut out: Vec<i64> = Vec::new();

    while t < cov_end {
        let mut choice: Option<(NaiveDateTime, i64, i32)> = None;
        for &(sd, pid) in &seg_points {
            if sd <= t {
                let d = duration_fn(pid).ok_or_else(|| "משך סילבוס לא נמצא".to_string())?;
                if d <= 0 {
                    return Err("משך סילבוס חייב להיות חיובי".to_string());
                }
                match choice {
                    None => choice = Some((sd, pid, d)),
                    Some((best_sd, _, _)) if sd > best_sd => choice = Some((sd, pid, d)),
                    _ => {}
                }
            }
        }
        let Some((_, pid, d)) = choice else {
            break;
        };
        let next_t = t + Duration::minutes(d as i64);
        if next_t > cov_end {
            break;
        }
        out.push(pid);
        t = next_t;
    }

    Ok(out)
}

/// Reconstruct authoring segments from slot list (run-length encoding).
pub fn run_length_segments_from_slots(
    coverage_start_iso: &str,
    slot_preset_ids: &[i64],
    duration_fn: impl Fn(i64) -> Option<i32>,
) -> Result<Vec<SegmentInput>, String> {
    if slot_preset_ids.is_empty() {
        return Ok(vec![]);
    }
    let anchor = parse_iso_datetime(coverage_start_iso)
        .ok_or_else(|| "coverage_start לא תקין".to_string())?;
    let mut t = anchor;
    let mut i = 0;
    let mut out: Vec<SegmentInput> = Vec::new();
    while i < slot_preset_ids.len() {
        let pid = slot_preset_ids[i];
        let dur = duration_fn(pid).ok_or_else(|| "משך סילבוס לא נמצא".to_string())?;
        if dur <= 0 {
            return Err("משך סילבוס חייב להיות חיובי".to_string());
        }
        let time_s = t.format("%H:%M").to_string();
        out.push(SegmentInput {
            syllabus_preset_id: pid,
            segment_start_time: time_s,
        });
        while i < slot_preset_ids.len() && slot_preset_ids[i] == pid {
            t += Duration::minutes(dur as i64);
            i += 1;
        }
    }
    Ok(out)
}

/// Reset all windows that reference `preset_id` to an all-default slot list.
/// Marks every shift in those windows `up_to_date = 0`. Does not infer new times from `start_time`.
pub fn cascade_preset_delete_or_duration_change(
    tx: &Transaction<'_>,
    affected_preset_id: i64,
) -> Result<(), String> {
    let def_id = default_syllabus_preset_id(tx).map_err(|e| e.to_string())?;
    let span_slot_minutes: i32 = tx
        .query_row(
            "SELECT duration_minutes FROM syllabus_presets WHERE id = ?",
            [def_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = tx
        .prepare("SELECT id, coverage_start, coverage_end, syllabus_slot_preset_ids FROM shift_windows")
        .map_err(|e| e.to_string())?;
    let rows: Vec<(i64, String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect();
    drop(stmt);

    let mut stale_window_ids: Vec<i64> = Vec::new();
    for (wid, _cs, _ce, sj) in &rows {
        let ids = parse_slot_preset_ids(sj).map_err(|e| e.to_string())?;
        if ids.contains(&affected_preset_id) {
            stale_window_ids.push(*wid);
        }
    }

    for wid in &stale_window_ids {
        tx.execute(
            "UPDATE shifts SET up_to_date = 0 WHERE shift_window_id = ?1",
            [wid],
        )
        .map_err(|e| e.to_string())?;
    }

    for (wid, cs, ce, sj) in rows {
        let ids = parse_slot_preset_ids(&sj).map_err(|e| e.to_string())?;
        if !ids.contains(&affected_preset_id) {
            continue;
        }
        let span = coverage_daily_span_minutes(&cs, &ce)?;
        let n = floor_slot_count(span, span_slot_minutes);
        let new_json = json_preset_slot_array(def_id, n);
        tx.execute(
            "UPDATE shift_windows SET syllabus_slot_preset_ids = ?1 WHERE id = ?2",
            params![new_json, wid],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daily_span_same_day() {
        let s = coverage_daily_span_minutes(
            "2000-01-01T06:00:00",
            "2000-01-01T21:00:00",
        )
        .unwrap();
        assert_eq!(s, 15 * 60);
    }

    #[test]
    fn floor_slots() {
        assert_eq!(floor_slot_count(900, 60), 15);
        assert_eq!(floor_slot_count(30, 60), 0);
    }

    #[test]
    fn expand_two_presets_example() {
        let durs: HashMap<i64, i32> = [(1, 60), (2, 60)].into_iter().collect();
        let df = |id: i64| durs.get(&id).copied();
        let segs = vec![
            SegmentInput {
                syllabus_preset_id: 1,
                segment_start_time: "08:00".into(),
            },
            SegmentInput {
                syllabus_preset_id: 2,
                segment_start_time: "10:00".into(),
            },
        ];
        let out = expand_segments_to_slot_ids(
            "2025-06-01T08:00:00",
            "2025-06-01T12:00:00",
            &segs,
            df,
        )
        .unwrap();
        assert_eq!(out, vec![1, 1, 2, 2]);
    }
}
