//! Violation checks (three rules) and weekly workload for reports.

use chrono::{Duration, NaiveDate, NaiveDateTime, NaiveTime};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};

/// End time at or after this minute-of-day counts as a “late” shift for workload coloring (18:00).
const LATE_SHIFT_END_MIN: i32 = 18 * 60;

#[derive(Debug, Clone, Serialize)]
pub struct Violation {
    pub rule: String,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shift_id: Option<i64>,
    /// Card header: employee name (same employee for all three rules today).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_employee: Option<String>,
    /// Card header: flight `start_time–end_time` per involved shift, ordered for display.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_shift_times: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bunch_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bunch_cap: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub employee_role_level: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_role_level: Option<i64>,
    /// Rule 3: employee's `roles.name`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub employee_role_name: Option<String>,
    /// Rule 3: syllabus role's linked `roles.name` (required minimum role).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_role_name: Option<String>,
}

impl Violation {
    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or_else(|_| {
            json!({
                "rule": &self.rule,
                "severity": &self.severity,
                "message": &self.message,
                "shift_id": self.shift_id,
            })
        })
    }
}

fn format_flight_range(start_time: &str, end_time: &str) -> String {
    format!("{}–{}", start_time.trim(), end_time.trim())
}

fn violation_segment_overlap(sa: &DayShiftRow, sb: &DayShiftRow, detail: &str) -> Violation {
    let sid = sa.id.min(sb.id);
    let en = sa.emp_name.as_deref().unwrap_or("");
    let msg = if sa.id < sb.id {
        format!("'{en}' '{}' vs '{}' | {detail}", sa.type_name, sb.type_name)
    } else {
        format!("'{en}' '{}' vs '{}' | {detail}", sb.type_name, sa.type_name)
    };
    let (first, second) = if sa.id < sb.id { (sa, sb) } else { (sb, sa) };
    Violation {
        rule: "segment_overlap".into(),
        severity: "error".into(),
        message: msg,
        shift_id: Some(sid),
        display_employee: Some(
            first
                .emp_name
                .clone()
                .or_else(|| second.emp_name.clone())
                .unwrap_or_default(),
        ),
        display_shift_times: Some(vec![
            format_flight_range(&first.start_time, &first.end_time),
            format_flight_range(&second.start_time, &second.end_time),
        ]),
        bunch_count: None,
        bunch_cap: None,
        employee_role_level: None,
        required_role_level: None,
        employee_role_name: None,
        required_role_name: None,
    }
}

fn violation_max_in_row_bunch(slice: &[DayShiftRow], s: usize, e: usize, n: i64, cap: i64) -> Violation {
    let first = &slice[s];
    let last = &slice[e - 1];
    let en = first.emp_name.as_deref().unwrap_or("");
    // Bunch span: first shift flight start → last shift flight end (timeline order).
    let times = vec![format_flight_range(&first.start_time, &last.end_time)];
    Violation {
        rule: "max_in_row_bunch".into(),
        severity: "warning".into(),
        message: format!(
            "'{en}' — יותר מדי משמרות רצופות בחבורה ({n} משמרות, מקסימום מותר {cap})"
        ),
        shift_id: Some(first.id),
        display_employee: first.emp_name.clone(),
        display_shift_times: Some(times),
        bunch_count: Some(n),
        bunch_cap: Some(cap),
        employee_role_level: None,
        required_role_level: None,
        employee_role_name: None,
        required_role_name: None,
    }
}

fn violation_syllabus_role_level(
    shift_id: i64,
    en: String,
    emp_lv: i64,
    syl_lv: i64,
    slot: &str,
    srole: &str,
    start_time: String,
    end_time: String,
    employee_role_name: String,
    required_role_name: String,
) -> Violation {
    Violation {
        rule: "syllabus_role_level".into(),
        severity: "warning".into(),
        message: format!(
            "'{en}' — רמת תפקיד בסילבוס ({srole} ב'{slot}') גבוהה מרמת התפקיד של המפעיל"
        ),
        shift_id: Some(shift_id),
        display_employee: Some(en),
        display_shift_times: Some(vec![format_flight_range(&start_time, &end_time)]),
        bunch_count: None,
        bunch_cap: None,
        employee_role_level: Some(emp_lv),
        required_role_level: Some(syl_lv),
        employee_role_name: Some(employee_role_name),
        required_role_name: Some(required_role_name),
    }
}

pub fn time_to_minutes(t: &str) -> i32 {
    let mut parts = t.split(':');
    let h: i32 = parts.next().unwrap_or("").parse().unwrap_or(0);
    let m: i32 = parts.next().unwrap_or("").parse().unwrap_or(0);
    h * 60 + m
}

pub fn parse_iso_datetime(s: &str) -> Option<NaiveDateTime> {
    let t = s.trim();
    NaiveDateTime::parse_from_str(t, "%Y-%m-%dT%H:%M:%S")
        .ok()
        .or_else(|| NaiveDateTime::parse_from_str(t, "%Y-%m-%dT%H:%M").ok())
        .or_else(|| NaiveDateTime::parse_from_str(t, "%Y-%m-%dT%H:%M:%S%.3f").ok())
        .or_else(|| NaiveDateTime::parse_from_str(t, "%Y-%m-%dT%H:%M:%S%.6f").ok())
}

pub(crate) fn parse_hms(t: &str) -> Option<NaiveTime> {
    let t = t.trim();
    NaiveTime::parse_from_str(t, "%H:%M:%S")
        .ok()
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

/// Half-open overlap in minute space: touching `end == start` is not an overlap.
fn intervals_overlap_hhmm(a0: &str, a1: &str, b0: &str, b1: &str) -> bool {
    let a0m = time_to_minutes(a0);
    let a1m = time_to_minutes(a1);
    let b0m = time_to_minutes(b0);
    let b1m = time_to_minutes(b1);
    a0m < b1m && a1m > b0m
}

#[derive(Clone, Debug)]
struct DayShiftRow {
    id: i64,
    employee_id: i64,
    shift_window_id: i64,
    start_time: String,
    end_time: String,
    prep_start: String,
    prep_end: String,
    rest_start: String,
    rest_end: String,
    syllabus_preset_id: i64,
    joint_prep: bool,
    joint_rest: bool,
    max_in_row: i64,
    type_name: String,
    emp_name: Option<String>,
}

impl DayShiftRow {
    fn overlap_segments(&self) -> [(&str, &str, &'static str); 3] {
        [
            (
                self.prep_start.as_str(),
                self.prep_end.as_str(),
                "prep",
            ),
            (
                self.start_time.as_str(),
                self.end_time.as_str(),
                "shift",
            ),
            (
                self.rest_start.as_str(),
                self.rest_end.as_str(),
                "rest",
            ),
        ]
    }
}

/// Returns `true` if this segment pair counts as a rule violation (overlap and not joint-excepted).
fn segment_pair_counts_as_overlap(
    a0: &str,
    a1: &str,
    kind_a: &str,
    b0: &str,
    b1: &str,
    kind_b: &str,
    preset_a: i64,
    preset_b: i64,
    joint_prep: bool,
    joint_rest: bool,
) -> bool {
    if !intervals_overlap_hhmm(a0, a1, b0, b1) {
        return false;
    }
    if kind_a == "prep"
        && kind_b == "prep"
        && preset_a == preset_b
        && joint_prep
    {
        return false;
    }
    if kind_a == "rest"
        && kind_b == "rest"
        && preset_a == preset_b
        && joint_rest
    {
        return false;
    }
    true
}

/// First overlapping segment detail for messaging (after joint exceptions).
fn first_overlap_detail(a: &DayShiftRow, b: &DayShiftRow) -> Option<String> {
    for (a0, a1, ka) in a.overlap_segments() {
        for (b0, b1, kb) in b.overlap_segments() {
            if segment_pair_counts_as_overlap(
                a0,
                a1,
                ka,
                b0,
                b1,
                kb,
                a.syllabus_preset_id,
                b.syllabus_preset_id,
                a.joint_prep,
                a.joint_rest,
            ) {
                return Some(format!(
                    "overlap: {}>{} ({}) vs {}>{} ({})",
                    a0, a1, ka, b0, b1, kb
                ));
            }
        }
    }
    None
}

fn load_day_shifts_for_overlap(
    conn: &Connection,
    shift_date: &str,
) -> rusqlite::Result<Vec<DayShiftRow>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.employee_id, s.shift_window_id, s.start_time, s.end_time,
                s.prep_start, s.prep_end, s.rest_start, s.rest_end,
                s.syllabus_preset_id, sp.joint_prep, sp.joint_rest, sp.max_in_row,
                w.name AS type_name, e.name AS emp_name
         FROM shifts s
         JOIN shift_windows w ON s.shift_window_id = w.id
         JOIN syllabus_presets sp ON s.syllabus_preset_id = sp.id
         LEFT JOIN employees e ON s.employee_id = e.id
         WHERE s.shift_date = ?1 AND s.employee_id IS NOT NULL
         ORDER BY s.employee_id, s.start_time, s.id",
    )?;
    let rows: Vec<DayShiftRow> = stmt
        .query_map([shift_date], |r| {
            Ok(DayShiftRow {
                id: r.get(0)?,
                employee_id: r.get(1)?,
                shift_window_id: r.get(2)?,
                start_time: r.get(3)?,
                end_time: r.get(4)?,
                prep_start: r.get(5)?,
                prep_end: r.get(6)?,
                rest_start: r.get(7)?,
                rest_end: r.get(8)?,
                syllabus_preset_id: r.get(9)?,
                joint_prep: r.get::<_, i32>(10)? != 0,
                joint_rest: r.get::<_, i32>(11)? != 0,
                max_in_row: r.get(12)?,
                type_name: r.get(13)?,
                emp_name: r.get(14)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Rule 1: at most one violation per unordered shift pair; `shift_id` = `min(id_a, id_b)`.
fn segment_overlap_violations_for_date(
    conn: &Connection,
    shift_date: &str,
) -> rusqlite::Result<Vec<Violation>> {
    let rows = load_day_shifts_for_overlap(conn, shift_date)?;
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < rows.len() {
        let emp = rows[i].employee_id;
        let mut j = i + 1;
        while j < rows.len() && rows[j].employee_id == emp {
            j += 1;
        }
        let slice = &rows[i..j];
        for a in 0..slice.len() {
            for b in (a + 1)..slice.len() {
                let sa = &slice[a];
                let sb = &slice[b];
                if let Some(detail) = first_overlap_detail(sa, sb) {
                    out.push(violation_segment_overlap(sa, sb, &detail));
                }
            }
        }
        i = j;
    }
    Ok(out)
}

fn bunch_follows_timeline(prev: &DayShiftRow, cur: &DayShiftRow) -> bool {
    prev.end_time == cur.start_time && prev.shift_window_id == cur.shift_window_id
}

fn bunch_ranges(rows: &[DayShiftRow]) -> Vec<(usize, usize)> {
    if rows.is_empty() {
        return vec![];
    }
    let mut out = Vec::new();
    let mut bunch_start = 0usize;
    for i in 1..rows.len() {
        if !bunch_follows_timeline(&rows[i - 1], &rows[i]) {
            out.push((bunch_start, i));
            bunch_start = i;
        }
    }
    out.push((bunch_start, rows.len()));
    out
}

/// Rule 2: one violation per violating bunch; `shift_id` = first shift in bunch (timeline order).
fn max_in_row_violations_for_date(
    conn: &Connection,
    shift_date: &str,
) -> rusqlite::Result<Vec<Violation>> {
    let rows = load_day_shifts_for_overlap(conn, shift_date)?;
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < rows.len() {
        let emp = rows[i].employee_id;
        let mut j = i + 1;
        while j < rows.len() && rows[j].employee_id == emp {
            j += 1;
        }
        let slice = &rows[i..j];
        for (s, e) in bunch_ranges(slice) {
            let n = e - s;
            if n == 0 {
                continue;
            }
            let mut caps: Vec<i64> = Vec::new();
            for r in &slice[s..e] {
                caps.push(r.max_in_row);
            }
            let cap = caps.into_iter().min().unwrap_or(1);
            if n as i64 > cap {
                out.push(violation_max_in_row_bunch(slice, s, e, n as i64, cap));
            }
        }
        i = j;
    }
    Ok(out)
}

/// Rule 3 only: syllabus role level must not exceed employee role level.
fn syllabus_role_level_violation(conn: &Connection, shift_id: i64) -> rusqlite::Result<Option<Violation>> {
    let row: Option<(
        Option<i64>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
    )> = conn
        .query_row(
            "SELECT s.syllabus_role_id, sr.role_id, er.role_level, sr_r.role_level,
                    e.name, w.name, COALESCE(sr.name, ''), s.start_time, s.end_time,
                    COALESCE(er.name, ''), COALESCE(sr_r.name, '')
             FROM shifts s
             JOIN employees e ON s.employee_id = e.id
             JOIN roles er ON e.role_id = er.id
             JOIN shift_windows w ON s.shift_window_id = w.id
             LEFT JOIN syllabus_roles sr ON s.syllabus_role_id = sr.id
             LEFT JOIN roles sr_r ON sr.role_id = sr_r.id
             WHERE s.id = ?",
            [shift_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                ))
            },
        )
        .optional()?;
    let Some((
        Some(_srid),
        Some(_role_id),
        Some(emp_lv),
        Some(syl_lv),
        en,
        slot,
        srole,
        st,
        et,
        emp_role_name,
        req_role_name,
    )) = row
    else {
        return Ok(None);
    };
    if syl_lv > emp_lv {
        return Ok(Some(violation_syllabus_role_level(
            shift_id,
            en,
            emp_lv,
            syl_lv,
            &slot,
            &srole,
            st,
            et,
            emp_role_name,
            req_role_name,
        )));
    }
    Ok(None)
}

/// Check all three rules for a single shift (overlap + max-in-row return canonical rows when this shift is involved).
pub fn check_shift_violations(conn: &Connection, shift_id: i64) -> rusqlite::Result<Vec<Violation>> {
    let mut violations = Vec::new();

    let head = match conn.query_row(
        "SELECT s.shift_date, s.employee_id FROM shifts s WHERE s.id = ?",
        [shift_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?)),
    ) {
        Ok(x) => x,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(violations),
        Err(e) => return Err(e),
    };
    let (shift_date, employee_id_opt) = head;
    let Some(emp_id) = employee_id_opt else {
        return Ok(violations);
    };

    if let Some(v) = syllabus_role_level_violation(conn, shift_id)? {
        violations.push(v);
    }

    let rows = load_day_shifts_for_overlap(conn, &shift_date)?;
    let mine: Vec<DayShiftRow> = rows
        .iter()
        .filter(|r| r.employee_id == emp_id)
        .cloned()
        .collect();

    for (s, e) in bunch_ranges(&mine) {
        let n = e - s;
        if n == 0 {
            continue;
        }
        let cap: i64 = mine[s..e].iter().map(|r| r.max_in_row).min().unwrap_or(1);
        if n as i64 > cap && mine[s..e].iter().any(|r| r.id == shift_id) {
            violations.push(violation_max_in_row_bunch(&mine, s, e, n as i64, cap));
        }
    }

    for other in &mine {
        if other.id == shift_id {
            continue;
        }
        let Some(me) = mine.iter().find(|r| r.id == shift_id) else {
            continue;
        };
        if let Some(detail) = first_overlap_detail(me, other) {
            violations.push(violation_segment_overlap(me, other, &detail));
        }
    }

    Ok(violations)
}

pub fn check_all_violations_for_date(conn: &Connection, shift_date: &str) -> rusqlite::Result<Vec<Value>> {
    let mut all = Vec::new();
    for v in segment_overlap_violations_for_date(conn, shift_date)? {
        all.push(v.to_json());
    }
    for v in max_in_row_violations_for_date(conn, shift_date)? {
        all.push(v.to_json());
    }
    let mut stmt = conn.prepare("SELECT id FROM shifts WHERE shift_date = ?")?;
    let ids: Vec<i64> = stmt
        .query_map([shift_date], |r| r.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for id in ids {
        if let Some(v) = syllabus_role_level_violation(conn, id)? {
            all.push(v.to_json());
        }
    }
    Ok(all)
}

pub(crate) fn workload_color(shifts_count: i32, late_shifts: i32) -> &'static str {
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
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let total_shifts = rows.len() as i32;
    let late_shifts = rows
        .iter()
        .filter(|r| time_to_minutes(&r.2) >= LATE_SHIFT_END_MIN)
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
    fn half_open_touching_endpoints_no_overlap() {
        assert!(!intervals_overlap_hhmm("08:00", "09:00", "09:00", "10:00"));
        assert!(!intervals_overlap_hhmm("09:00", "10:00", "08:00", "09:00"));
    }

    #[test]
    fn segment_joint_prep_same_preset_skips_prep_prep() {
        let a = DayShiftRow {
            id: 1,
            employee_id: 1,
            shift_window_id: 1,
            start_time: "10:30".into(),
            end_time: "11:30".into(),
            prep_start: "08:00".into(),
            prep_end: "09:30".into(),
            rest_start: "12:30".into(),
            rest_end: "13:00".into(),
            syllabus_preset_id: 100,
            joint_prep: true,
            joint_rest: false,
            max_in_row: 4,
            type_name: "A".into(),
            emp_name: Some("e".into()),
        };
        let b = DayShiftRow {
            id: 2,
            employee_id: 1,
            shift_window_id: 1,
            start_time: "11:30".into(),
            end_time: "12:30".into(),
            prep_start: "09:00".into(),
            prep_end: "10:00".into(),
            rest_start: "13:30".into(),
            rest_end: "14:00".into(),
            syllabus_preset_id: 100,
            joint_prep: true,
            joint_rest: false,
            max_in_row: 4,
            type_name: "B".into(),
            emp_name: Some("e".into()),
        };
        assert!(first_overlap_detail(&a, &b).is_none());
    }

    #[test]
    fn segment_shift_overlap_still_detected() {
        let a = DayShiftRow {
            id: 1,
            employee_id: 1,
            shift_window_id: 1,
            start_time: "09:30".into(),
            end_time: "10:30".into(),
            prep_start: "08:00".into(),
            prep_end: "08:30".into(),
            rest_start: "12:00".into(),
            rest_end: "12:30".into(),
            syllabus_preset_id: 100,
            joint_prep: false,
            joint_rest: false,
            max_in_row: 4,
            type_name: "A".into(),
            emp_name: Some("e".into()),
        };
        let b = DayShiftRow {
            id: 2,
            employee_id: 1,
            shift_window_id: 1,
            start_time: "09:00".into(),
            end_time: "11:00".into(),
            prep_start: "07:00".into(),
            prep_end: "07:30".into(),
            rest_start: "11:00".into(),
            rest_end: "11:30".into(),
            syllabus_preset_id: 101,
            joint_prep: false,
            joint_rest: false,
            max_in_row: 4,
            type_name: "B".into(),
            emp_name: Some("e".into()),
        };
        let d = first_overlap_detail(&a, &b).expect("overlap");
        assert!(d.contains("(shift)"));
    }

    #[test]
    fn joint_rest_same_preset_skips_rest_rest() {
        let a = DayShiftRow {
            id: 1,
            employee_id: 1,
            shift_window_id: 1,
            start_time: "09:00".into(),
            end_time: "10:00".into(),
            prep_start: "08:00".into(),
            prep_end: "08:30".into(),
            rest_start: "11:00".into(),
            rest_end: "12:00".into(),
            syllabus_preset_id: 50,
            joint_prep: false,
            joint_rest: true,
            max_in_row: 4,
            type_name: "A".into(),
            emp_name: None,
        };
        let b = DayShiftRow {
            id: 2,
            employee_id: 1,
            shift_window_id: 1,
            start_time: "10:00".into(),
            end_time: "11:00".into(),
            prep_start: "08:30".into(),
            prep_end: "09:00".into(),
            rest_start: "11:30".into(),
            rest_end: "12:30".into(),
            syllabus_preset_id: 50,
            joint_prep: false,
            joint_rest: true,
            max_in_row: 4,
            type_name: "B".into(),
            emp_name: None,
        };
        assert!(first_overlap_detail(&a, &b).is_none());
    }

    #[test]
    fn bunch_ranges_splits_on_time_gap() {
        let rows = vec![
            row(1, 1, 1, "09:00", "10:00", 100, 4, false, false),
            row(2, 1, 1, "10:00", "11:00", 100, 4, false, false),
            row(3, 1, 1, "14:00", "15:00", 100, 2, false, false),
        ];
        assert_eq!(bunch_ranges(&rows), vec![(0, 2), (2, 3)]);
    }

    #[test]
    fn max_in_row_cap_uses_min_of_preset_limits() {
        let rows = vec![
            row(1, 1, 1, "09:00", "10:00", 100, 4, false, false),
            row(2, 1, 1, "10:00", "11:00", 101, 2, false, false),
            row(3, 1, 1, "11:00", "12:00", 102, 3, false, false),
        ];
        let (s, e) = bunch_ranges(&rows)[0];
        let slice = &rows[s..e];
        let cap: i64 = slice.iter().map(|r| r.max_in_row).min().unwrap();
        assert_eq!(cap, 2);
        assert_eq!(e - s, 3);
        assert!(3 > cap);
    }

    fn row(
        id: i64,
        emp: i64,
        wid: i64,
        st: &str,
        et: &str,
        pid: i64,
        mir: i64,
        jp: bool,
        jr: bool,
    ) -> DayShiftRow {
        DayShiftRow {
            id,
            employee_id: emp,
            shift_window_id: wid,
            start_time: st.into(),
            end_time: et.into(),
            prep_start: "08:00".into(),
            prep_end: "08:15".into(),
            rest_start: "12:00".into(),
            rest_end: "12:15".into(),
            syllabus_preset_id: pid,
            joint_prep: jp,
            joint_rest: jr,
            max_in_row: mir,
            type_name: "t".into(),
            emp_name: None,
        }
    }
}
