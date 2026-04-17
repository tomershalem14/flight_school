//! Violation checks and weekly workload — behavior matches legacy Python implementation.

use chrono::{Duration, NaiveDate, NaiveDateTime, NaiveTime};
use rusqlite::{params, Connection, Row};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize)]
pub struct Violation {
    pub rule: String,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shift_id: Option<i64>,
}

impl Violation {
    pub fn to_json(&self) -> Value {
        json!({
            "rule": self.rule,
            "severity": self.severity,
            "message": self.message,
            "shift_id": self.shift_id,
        })
    }
}

pub fn time_to_minutes(t: &str) -> i32 {
    let parts: Vec<&str> = t.split(':').collect();
    if parts.len() < 2 {
        return 0;
    }
    let h: i32 = parts[0].parse().unwrap_or(0);
    let m: i32 = parts[1].parse().unwrap_or(0);
    h * 60 + m
}

fn parse_shift_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

pub fn parse_iso_datetime(s: &str) -> Option<NaiveDateTime> {
    let t = s.trim();
    NaiveDateTime::parse_from_str(t, "%Y-%m-%dT%H:%M:%S").ok()
        .or_else(|| NaiveDateTime::parse_from_str(t, "%Y-%m-%dT%H:%M").ok())
        .or_else(|| NaiveDateTime::parse_from_str(t, "%Y-%m-%dT%H:%M:%S%.3f").ok())
        .or_else(|| NaiveDateTime::parse_from_str(t, "%Y-%m-%dT%H:%M:%S%.6f").ok())
}

pub(crate) fn parse_hms(t: &str) -> Option<NaiveTime> {
    let t = t.trim();
    NaiveTime::parse_from_str(t, "%H:%M:%S").ok()
        .or_else(|| NaiveTime::parse_from_str(t, "%H:%M").ok())
}

/// Concrete shift interval on the timeline (handles end before start as next-day end).
#[cfg(test)]
fn shift_span_on_calendar(
    shift_date: &str,
    start_time: &str,
    end_time: &str,
) -> Option<(NaiveDateTime, NaiveDateTime)> {
    let d = NaiveDate::parse_from_str(shift_date, "%Y-%m-%d").ok()?;
    let st = parse_hms(start_time)?;
    let end_trim = end_time.trim();
    let (et, end_next_day) = if end_trim == "24:00" || end_trim == "24:00:00" {
        (NaiveTime::from_hms_opt(0, 0, 0)?, true)
    } else {
        let et = parse_hms(end_time)?;
        (et, et <= st)
    };
    let start_dt = d.and_time(st);
    let end_date = if end_next_day {
        d + Duration::days(1)
    } else {
        d
    };
    let end_dt = end_date.and_time(et);
    Some((start_dt, end_dt))
}

fn wall_shift_duration_minutes(start_time: &str, end_time: &str) -> i32 {
    let a = time_to_minutes(start_time);
    let b = time_to_minutes(end_time);
    let mut d = b - a;
    if d < 0 {
        d += 24 * 60;
    }
    d
}

/// Wall-clock blocks for rule 3: prep, flight (`start_time`–`end_time`), rest.
#[derive(Clone, Debug)]
pub struct PrepRestShiftBlocks {
    pub prep_start: String,
    pub prep_end: String,
    pub start_time: String,
    pub end_time: String,
    pub rest_start: String,
    pub rest_end: String,
}

/// Half-open-style overlap in minute space (same as legacy envelope check).
pub fn intervals_overlap_hhmm(a0: &str, a1: &str, b0: &str, b1: &str) -> bool {
    let a0m = time_to_minutes(a0);
    let a1m = time_to_minutes(a1);
    let b0m = time_to_minutes(b0);
    let b1m = time_to_minutes(b1);
    a0m < b1m && a1m > b0m
}

/// Prep, flight (`start_time`–`end_time`), and rest as labeled wall intervals for Rule 3.
fn prep_rest_rule3_segments(s: &PrepRestShiftBlocks) -> [(&str, &str, &'static str); 3] {
    [
        (
            s.prep_start.as_str(),
            s.prep_end.as_str(),
            "prep",
        ),
        (
            s.start_time.as_str(),
            s.end_time.as_str(),
            "shift",
        ),
        (
            s.rest_start.as_str(),
            s.rest_end.as_str(),
            "rest",
        ),
    ]
}

/// First overlapping segment pair: `candidate` vs `other`, each `start>end (kind)`.
pub fn prep_rest_rule3_overlap_detail(
    candidate: &PrepRestShiftBlocks,
    other: &PrepRestShiftBlocks,
) -> Option<String> {
    for (a0, a1, ka) in prep_rest_rule3_segments(candidate) {
        for (b0, b1, kb) in prep_rest_rule3_segments(other) {
            if intervals_overlap_hhmm(a0, a1, b0, b1) {
                return Some(format!(
                    "overlap: {}>{} ({}) vs {}>{} ({})",
                    a0, a1, ka, b0, b1, kb
                ));
            }
        }
    }
    None
}

/// Check rules for a single shift row (joined columns match Python query).
pub fn check_shift_violations(conn: &Connection, shift_id: i64) -> rusqlite::Result<Vec<Violation>> {
    let mut violations = Vec::new();

    let shift = match conn.query_row(
        "SELECT s.id, s.shift_date, s.start_time, s.end_time, s.employee_id,
                s.prep_start, s.prep_end, s.rest_start, s.rest_end,
                w.name AS type_name,
                e.name AS emp_name
         FROM shifts s
         JOIN shift_windows w ON s.shift_window_id = w.id
         LEFT JOIN employees e ON s.employee_id = e.id
         WHERE s.id = ?",
        [shift_id],
        ShiftRow::from_row,
    ) {
        Ok(s) => s,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(violations),
        Err(e) => return Err(e),
    };

    let Some(emp_id) = shift.employee_id else {
        return Ok(violations);
    };

    let shift_date = shift.shift_date.clone();
    let subject = PrepRestShiftBlocks {
        prep_start: shift.prep_start.clone(),
        prep_end: shift.prep_end.clone(),
        start_time: shift.start_time.clone(),
        end_time: shift.end_time.clone(),
        rest_start: shift.rest_start.clone(),
        rest_end: shift.rest_end.clone(),
    };

    // Rule 3: prep/rest segments vs other shift's prep, flight, or rest (not full prep_start–rest_end envelope)
    let mut stmt = conn.prepare(
        "SELECT s.prep_start, s.prep_end, s.start_time, s.end_time, s.rest_start, s.rest_end, w.name
         FROM shifts s
         JOIN shift_windows w ON s.shift_window_id = w.id
         WHERE s.employee_id = ? AND s.shift_date = ? AND s.id != ?",
    )?;
    let others = stmt.query_map(params![emp_id, shift_date, shift_id], |r| {
        Ok((
            PrepRestShiftBlocks {
                prep_start: r.get(0)?,
                prep_end: r.get(1)?,
                start_time: r.get(2)?,
                end_time: r.get(3)?,
                rest_start: r.get(4)?,
                rest_end: r.get(5)?,
            },
            r.get::<_, String>(6)?,
        ))
    })?;

    let en = shift.emp_name.as_deref().unwrap_or("");
    let tn = &shift.type_name;
    for o in others.flatten() {
        let (blocks, oname) = o;
        if let Some(detail) = prep_rest_rule3_overlap_detail(&subject, &blocks) {
            violations.push(Violation {
                rule: "prep_rest_overlap".into(),
                severity: "error".into(),
                message: format!("'{en}' '{tn}' vs '{oname}' | {detail}"),
                shift_id: Some(shift_id),
            });
        }
    }

    // Rule 4: no consecutive evening (end >= 18:00)
    const LATE_THRESHOLD: i32 = 18 * 60;
    let end_min = time_to_minutes(&shift.end_time);
    if end_min >= LATE_THRESHOLD {
        if let Some(dt) = parse_shift_date(&shift_date) {
            for (check_date, direction) in [
                (dt - Duration::days(1), "אתמול"),
                (dt + Duration::days(1), "מחר"),
            ] {
                let ds = check_date.format("%Y-%m-%d").to_string();
                let adjacent = match conn.query_row(
                    "SELECT s.id FROM shifts s
                     WHERE s.employee_id = ? AND s.shift_date = ?
                       AND CAST(substr(s.end_time, 1, 2) AS INTEGER) >= 18",
                    params![emp_id, ds],
                    |r| r.get::<_, i64>(0),
                ) {
                    Ok(v) => Some(v),
                    Err(rusqlite::Error::QueryReturnedNoRows) => None,
                    Err(e) => return Err(e),
                };
                if adjacent.is_some() {
                    violations.push(Violation {
                        rule: "no_consecutive_evening".into(),
                        severity: "error".into(),
                        message: format!(
                            "'{en}' - משמרת ערב ברצף ({direction} גם משמרת ערב)"
                        ),
                        shift_id: Some(shift_id),
                    });
                    break;
                }
            }
        }
    }

    Ok(violations)
}

struct ShiftRow {
    shift_date: String,
    start_time: String,
    end_time: String,
    employee_id: Option<i64>,
    prep_start: String,
    prep_end: String,
    rest_start: String,
    rest_end: String,
    type_name: String,
    emp_name: Option<String>,
}

impl ShiftRow {
    fn from_row(r: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            shift_date: r.get("shift_date")?,
            start_time: r.get("start_time")?,
            end_time: r.get("end_time")?,
            employee_id: r.get("employee_id")?,
            prep_start: r.get("prep_start")?,
            prep_end: r.get("prep_end")?,
            rest_start: r.get("rest_start")?,
            rest_end: r.get("rest_end")?,
            type_name: r.get("type_name")?,
            emp_name: r.get("emp_name")?,
        })
    }
}

pub fn check_all_violations_for_date(conn: &Connection, shift_date: &str) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT id FROM shifts WHERE shift_date = ?")?;
    let ids: Vec<i64> = stmt
        .query_map([shift_date], |r| r.get(0))?
        .filter_map(|x| x.ok())
        .collect();
    let mut all = Vec::new();
    for id in ids {
        for v in check_shift_violations(conn, id)? {
            all.push(v.to_json());
        }
    }
    Ok(all)
}

pub fn workload_color(shifts_count: i32, late_shifts: i32) -> &'static str {
    if shifts_count > 4 || late_shifts >= 2 {
        "red"
    } else if shifts_count >= 3 || late_shifts >= 1 {
        "yellow"
    } else {
        "green"
    }
}

pub fn get_weekly_workload(
    conn: &Connection,
    employee_id: i64,
    week_start: &str,
) -> Result<Value, String> {
    let week_dt = NaiveDate::parse_from_str(week_start, "%Y-%m-%d")
        .map_err(|_| "פורמט תאריך שגוי".to_string())?;
    let week_end = (week_dt + Duration::days(6)).format("%Y-%m-%d").to_string();

    let mut stmt = conn
        .prepare(
            "SELECT s.shift_date, s.start_time, s.end_time, w.name as type_name
         FROM shifts s
         JOIN shift_windows w ON s.shift_window_id = w.id
         WHERE s.employee_id = ? AND s.shift_date BETWEEN ? AND ?",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String, String, String)> = stmt
        .query_map(params![employee_id, week_start, week_end], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect();

    let total_shifts = rows.len() as i32;
    let late_shifts = rows
        .iter()
        .filter(|r| time_to_minutes(&r.2) >= 18 * 60)
        .count() as i32;
    let total_minutes: i32 = rows
        .iter()
        .map(|r| wall_shift_duration_minutes(&r.1, &r.2))
        .sum();

    Ok(json!({
        "total_shifts": total_shifts,
        "late_shifts": late_shifts,
        "total_hours": (total_minutes as f64 / 60.0 * 10.0).round() / 10.0,
        "color": workload_color(total_shifts, late_shifts),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workload_color_thresholds() {
        assert_eq!(workload_color(2, 0), "green");
        assert_eq!(workload_color(3, 0), "yellow");
        assert_eq!(workload_color(4, 0), "yellow");
        assert_eq!(workload_color(5, 0), "red");
        assert_eq!(workload_color(2, 2), "red");
    }

    #[test]
    fn time_to_minutes_parses() {
        assert_eq!(time_to_minutes("08:30"), 8 * 60 + 30);
        assert_eq!(time_to_minutes("00:00"), 0);
    }

    #[test]
    fn shift_span_parses_24_00_as_next_midnight() {
        let (s, e) =
            shift_span_on_calendar("2025-06-01", "23:00", "24:00").expect("span");
        assert_eq!(s, NaiveDate::from_ymd_opt(2025, 6, 1).unwrap().and_hms_opt(23, 0, 0).unwrap());
        assert_eq!(e, NaiveDate::from_ymd_opt(2025, 6, 2).unwrap().and_hms_opt(0, 0, 0).unwrap());
    }

    #[test]
    fn shift_span_midnight_end_next_day() {
        let (start, end) =
            shift_span_on_calendar("2025-06-01", "23:00", "00:00").expect("span");
        assert_eq!(
            start,
            NaiveDate::from_ymd_opt(2025, 6, 1)
                .unwrap()
                .and_hms_opt(23, 0, 0)
                .unwrap()
        );
        assert_eq!(
            end,
            NaiveDate::from_ymd_opt(2025, 6, 2)
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap()
        );
    }

    #[test]
    fn rule3_symmetric_detects_shift_overlap() {
        let a = PrepRestShiftBlocks {
            prep_start: "08:00".into(),
            prep_end: "08:30".into(),
            start_time: "09:30".into(),
            end_time: "10:30".into(),
            rest_start: "12:00".into(),
            rest_end: "12:30".into(),
        };
        let b = PrepRestShiftBlocks {
            prep_start: "07:00".into(),
            prep_end: "07:30".into(),
            start_time: "09:00".into(),
            end_time: "11:00".into(),
            rest_start: "11:00".into(),
            rest_end: "11:30".into(),
        };
        assert!(prep_rest_rule3_overlap_detail(&a, &b).is_some());
        let d = prep_rest_rule3_overlap_detail(&a, &b).expect("detail");
        assert!(d.contains("(shift)"));
    }

    #[test]
    fn rule3_prep_segment_overlaps_other_shift_segment() {
        let other = PrepRestShiftBlocks {
            prep_start: "08:00".into(),
            prep_end: "08:30".into(),
            start_time: "08:30".into(),
            end_time: "09:30".into(),
            rest_start: "09:30".into(),
            rest_end: "10:00".into(),
        };
        let candidate = PrepRestShiftBlocks {
            prep_start: "09:00".into(),
            prep_end: "09:30".into(),
            start_time: "09:30".into(),
            end_time: "10:30".into(),
            rest_start: "10:30".into(),
            rest_end: "11:00".into(),
        };
        assert!(prep_rest_rule3_overlap_detail(&candidate, &other).is_some());
    }
}
