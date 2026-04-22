//! Violation checks (shift overlap, max-in-row, syllabus role) plus global-rules warnings.

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime};
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

// --- Global rules (warnings) -------------------------------------------------

#[derive(Clone, Debug)]
struct GlobalRulesSnapshot {
    rest_between_shifts: i64,
    rest_between_outer: i64,
    max_workday_minutes: i64,
    early_min: i32,
    late_min: i32,
    max_late_days: i64,
    max_early_days: i64,
    max_days_extreme: i64,
}

#[derive(Clone, Debug)]
struct ScheduleEventRow {
    id: i64,
    shift_date: String,
    employee_id: i64,
    start_time: String,
    end_time: String,
    name: String,
    event_kind: String,
}

#[derive(Clone, Debug)]
struct DayShiftWithDate {
    shift_date: String,
    row: DayShiftRow,
}

fn wall_minutes_pair(min_m: i32, max_m: i32) -> i32 {
    let mut span = max_m - min_m;
    if span < 0 {
        span += 24 * 60;
    }
    span
}

fn gap_minutes_same_day(prev_end_hhmm: &str, next_start_hhmm: &str) -> i32 {
    time_to_minutes(next_start_hhmm) - time_to_minutes(prev_end_hhmm)
}

fn week_sunday_for_date(d: NaiveDate) -> NaiveDate {
    d - Duration::days(d.weekday().num_days_from_sunday() as i64)
}

fn default_global_rules_snapshot() -> GlobalRulesSnapshot {
    GlobalRulesSnapshot {
        rest_between_shifts: 0,
        rest_between_outer: 0,
        max_workday_minutes: 720,
        early_min: time_to_minutes("06:00"),
        late_min: time_to_minutes("22:00"),
        max_late_days: 0,
        max_early_days: 0,
        max_days_extreme: 0,
    }
}

fn load_global_rules_snapshot(conn: &Connection) -> rusqlite::Result<GlobalRulesSnapshot> {
    let row: Option<(
        i64,
        i64,
        i64,
        String,
        String,
        i64,
        i64,
        i64,
    )> = conn
        .query_row(
            "SELECT rest_between_shifts, rest_between_outer, max_workday, early_time, late_time,
                    max_late_days, max_early_days, max_days_extreme
             FROM global_rules WHERE id = 1",
            [],
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
                ))
            },
        )
        .optional()?;
    let Some((rbs, rbo, mw, et_early, et_late, mld, mad, mde)) = row else {
        return Ok(default_global_rules_snapshot());
    };
    Ok(GlobalRulesSnapshot {
        rest_between_shifts: rbs,
        rest_between_outer: rbo,
        max_workday_minutes: mw,
        early_min: time_to_minutes(et_early.trim()),
        late_min: time_to_minutes(et_late.trim()),
        max_late_days: mld,
        max_early_days: mad,
        max_days_extreme: mde,
    })
}

fn load_shifts_range(conn: &Connection, lo: &str, hi: &str) -> rusqlite::Result<Vec<DayShiftWithDate>> {
    let mut stmt = conn.prepare(
        "SELECT s.shift_date, s.id, s.employee_id, s.shift_window_id, s.start_time, s.end_time,
                s.prep_start, s.prep_end, s.rest_start, s.rest_end,
                s.syllabus_preset_id, sp.joint_prep, sp.joint_rest, sp.max_in_row,
                w.name AS type_name, e.name AS emp_name
         FROM shifts s
         JOIN shift_windows w ON s.shift_window_id = w.id
         JOIN syllabus_presets sp ON s.syllabus_preset_id = sp.id
         LEFT JOIN employees e ON s.employee_id = e.id
         WHERE s.shift_date >= ?1 AND s.shift_date <= ?2 AND s.employee_id IS NOT NULL
         ORDER BY s.shift_date, s.employee_id, s.start_time, s.id",
    )?;
    let rows = stmt
        .query_map(params![lo, hi], |r| {
            Ok(DayShiftWithDate {
                shift_date: r.get(0)?,
                row: DayShiftRow {
                    id: r.get(1)?,
                    employee_id: r.get(2)?,
                    shift_window_id: r.get(3)?,
                    start_time: r.get(4)?,
                    end_time: r.get(5)?,
                    prep_start: r.get(6)?,
                    prep_end: r.get(7)?,
                    rest_start: r.get(8)?,
                    rest_end: r.get(9)?,
                    syllabus_preset_id: r.get(10)?,
                    joint_prep: r.get::<_, i32>(11)? != 0,
                    joint_rest: r.get::<_, i32>(12)? != 0,
                    max_in_row: r.get(13)?,
                    type_name: r.get(14)?,
                    emp_name: r.get(15)?,
                },
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn load_schedule_events_range(conn: &Connection, lo: &str, hi: &str) -> rusqlite::Result<Vec<ScheduleEventRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, shift_date, employee_id, start_time, end_time, name, event_kind
         FROM schedule_events
         WHERE shift_date >= ?1 AND shift_date <= ?2
         ORDER BY shift_date, employee_id, start_time, id",
    )?;
    let rows = stmt
        .query_map(params![lo, hi], |r| {
            Ok(ScheduleEventRow {
                id: r.get(0)?,
                shift_date: r.get(1)?,
                employee_id: r.get(2)?,
                start_time: r.get(3)?,
                end_time: r.get(4)?,
                name: r.get(5)?,
                event_kind: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn fmt_hours_one_dec(minutes: i64) -> String {
    let h = (minutes as f64 / 60.0 * 10.0).round() / 10.0;
    format!("{h}")
}

fn global_rules_violation(
    rule: &str,
    severity: &str,
    message: String,
    shift_id: Option<i64>,
    display_employee: Option<String>,
    display_shift_times: Option<Vec<String>>,
) -> Violation {
    Violation {
        rule: rule.into(),
        severity: severity.into(),
        message,
        shift_id,
        display_employee,
        display_shift_times,
        bunch_count: None,
        bunch_cap: None,
        employee_role_level: None,
        required_role_level: None,
        employee_role_name: None,
        required_role_name: None,
    }
}

fn global_violation_warning(
    rule: &str,
    message: String,
    shift_id: Option<i64>,
    display_employee: Option<String>,
    display_shift_times: Option<Vec<String>>,
) -> Violation {
    global_rules_violation(
        rule,
        "warning",
        message,
        shift_id,
        display_employee,
        display_shift_times,
    )
}

#[derive(Clone, Debug)]
struct DayEnvelope {
    min_start: i32,
    max_end: i32,
}

/// Rule 4–6 workday envelope: only `event_kind = event` rows extend the day span.
fn envelope_for_day(
    employee_id: i64,
    date: &str,
    shifts: &[DayShiftRow],
    events: &[ScheduleEventRow],
) -> Option<DayEnvelope> {
    let mut mins: Vec<i32> = Vec::new();
    let mut maxs: Vec<i32> = Vec::new();
    for s in shifts {
        mins.push(time_to_minutes(s.prep_start.trim()));
        maxs.push(time_to_minutes(s.rest_end.trim()));
    }
    for ev in events.iter().filter(|e| {
        e.shift_date == date && e.employee_id == employee_id && e.event_kind == "event"
    }) {
        mins.push(time_to_minutes(ev.start_time.trim()));
        maxs.push(time_to_minutes(ev.end_time.trim()));
    }
    if mins.is_empty() {
        return None;
    }
    Some(DayEnvelope {
        min_start: mins.into_iter().min().unwrap_or(0),
        max_end: maxs.into_iter().max().unwrap_or(0),
    })
}

fn collect_employees_on_date(
    query_date: &str,
    dated_shifts: &[DayShiftWithDate],
    events: &[ScheduleEventRow],
) -> Vec<(i64, Option<String>)> {
    let mut out: Vec<(i64, Option<String>)> = Vec::new();
    for d in dated_shifts {
        if d.shift_date == query_date {
            let name = d.row.emp_name.clone();
            if !out.iter().any(|(id, _)| *id == d.row.employee_id) {
                out.push((d.row.employee_id, name));
            }
        }
    }
    for ev in events.iter().filter(|e| e.shift_date == query_date) {
        if !out.iter().any(|(id, _)| *id == ev.employee_id) {
            out.push((ev.employee_id, None));
        }
    }
    out
}

fn events_for_emp_date<'a>(
    events: &'a [ScheduleEventRow],
    emp: i64,
    date: &str,
) -> Vec<&'a ScheduleEventRow> {
    events
        .iter()
        .filter(|e| e.shift_date == date && e.employee_id == emp)
        .collect()
}

/// Rule 1.3: any prep / flight / rest segment, or any `schedule_events` row for that day,
/// must fall entirely inside merged availability windows for that employee and date.
#[derive(Clone, Debug)]
struct AvailabilityRow {
    employee_id: i64,
    avail_date: String,
    start_time: Option<String>,
    end_time: Option<String>,
}

fn availability_row_is_whole_day(r: &AvailabilityRow) -> bool {
    let st = r
        .start_time
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let et = r
        .end_time
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    matches!((st, et), (None, None))
}

fn load_availability_range(
    conn: &Connection,
    lo: &str,
    hi: &str,
) -> rusqlite::Result<Vec<AvailabilityRow>> {
    let mut stmt = conn.prepare(
        "SELECT employee_id, avail_date, start_time, end_time
         FROM availability
         WHERE avail_date >= ?1 AND avail_date <= ?2
         ORDER BY avail_date, employee_id, start_time IS NULL DESC, start_time, id",
    )?;
    let rows = stmt
        .query_map(params![lo, hi], |r| {
            Ok(AvailabilityRow {
                employee_id: r.get(0)?,
                avail_date: r.get(1)?,
                start_time: r.get(2)?,
                end_time: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn merge_minute_intervals(mut segs: Vec<(i32, i32)>) -> Vec<(i32, i32)> {
    if segs.is_empty() {
        return vec![];
    }
    segs.sort_by_key(|x| x.0);
    let mut out: Vec<(i32, i32)> = Vec::new();
    let mut cs = segs[0].0;
    let mut ce = segs[0].1;
    for (s, e) in segs.into_iter().skip(1) {
        if s <= ce {
            ce = ce.max(e);
        } else {
            out.push((cs, ce));
            cs = s;
            ce = e;
        }
    }
    out.push((cs, ce));
    out
}

/// Merged half-open minute ranges `[lo, hi)` within calendar day `0..1440` for enabled matrix time.
fn build_enabled_union_minutes(
    emp_id: i64,
    date: &str,
    avail_all: &[AvailabilityRow],
) -> Vec<(i32, i32)> {
    let rows: Vec<&AvailabilityRow> = avail_all
        .iter()
        .filter(|r| r.employee_id == emp_id && r.avail_date == date)
        .collect();
    if rows.is_empty() {
        return vec![];
    }
    if rows.iter().any(|r| availability_row_is_whole_day(r)) {
        return vec![(0, 24 * 60)];
    }
    let mut raw: Vec<(i32, i32)> = Vec::new();
    for r in rows {
        if availability_row_is_whole_day(r) {
            continue;
        }
        let Some(st) = r
            .start_time
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let Some(et) = r
            .end_time
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let sm = time_to_minutes(st);
        let em0 = time_to_minutes(et);
        if sm == em0 {
            continue;
        }
        let mut em = em0;
        if em <= sm {
            em += 24 * 60;
        }
        if sm < 24 * 60 {
            let hi = em.min(24 * 60).max(sm);
            if sm < hi {
                raw.push((sm, hi));
            }
        }
        if em > 24 * 60 {
            let hi2 = (em - 24 * 60).min(24 * 60);
            if 0 < hi2 {
                raw.push((0, hi2));
            }
        }
    }
    merge_minute_intervals(raw)
}

fn segment_positive_duration_hhmm(start: &str, end: &str) -> bool {
    let s = start.trim();
    let e = end.trim();
    if s.is_empty() || e.is_empty() {
        return false;
    }
    let sm = time_to_minutes(s);
    let em0 = time_to_minutes(e);
    if sm == em0 {
        return false;
    }
    let mut em = em0;
    if em <= sm {
        em += 24 * 60;
    }
    em > sm
}

/// Split wall `[start,end)` into same-calendar-day minute intervals in `0..1440`.
fn clip_wall_segment_to_day_minutes(start: &str, end: &str) -> Vec<(i32, i32)> {
    let s = start.trim();
    let e = end.trim();
    if s.is_empty() || e.is_empty() {
        return vec![];
    }
    let sm = time_to_minutes(s);
    let em0 = time_to_minutes(e);
    if sm == em0 {
        return vec![];
    }
    let mut em = em0;
    if em <= sm {
        em += 24 * 60;
    }
    let mut out = Vec::new();
    if sm < 24 * 60 {
        let hi = em.min(24 * 60).max(sm);
        if sm < hi {
            out.push((sm, hi));
        }
    }
    if em > 24 * 60 {
        let hi2 = (em - 24 * 60).min(24 * 60);
        if 0 < hi2 {
            out.push((0, hi2));
        }
    }
    out
}

fn interval_fully_covered_by_union(lo: i32, hi: i32, union: &[(i32, i32)]) -> bool {
    if lo >= hi {
        return true;
    }
    if union.is_empty() {
        return false;
    }
    let mut p = lo;
    for &(a, b) in union {
        if b <= p {
            continue;
        }
        if a > p {
            return false;
        }
        p = p.max(b);
        if p >= hi {
            return true;
        }
    }
    p >= hi
}

fn wall_segment_outside_availability_union(start: &str, end: &str, union: &[(i32, i32)]) -> bool {
    if !segment_positive_duration_hhmm(start, end) {
        return false;
    }
    for (lo, hi) in clip_wall_segment_to_day_minutes(start, end) {
        if !interval_fully_covered_by_union(lo, hi, union) {
            return true;
        }
    }
    false
}

/// Rule 1.1: shift–calendar overlap uses `event`, `constraint`, and `operational` rows.
fn schedule_event_kind_blocks_shift_segments(kind: &str) -> bool {
    matches!(
        kind.trim(),
        "event" | "constraint" | "operational"
    )
}

fn schedule_calendar_row_label(ev: &ScheduleEventRow) -> String {
    let prefix = match ev.event_kind.as_str() {
        "constraint" => "אילוץ",
        "operational" => "משמרת",
        _ => "אירוע",
    };
    format!("{}: {}", prefix, ev.name.trim())
}

/// Display name for Rule 6 header: shift rows in loaded range first, else `employees.name`.
fn employee_name_for_week_rule(
    conn: &Connection,
    employee_id: i64,
    dated: &[DayShiftWithDate],
) -> rusqlite::Result<String> {
    if let Some(n) = dated
        .iter()
        .find(|d| d.row.employee_id == employee_id)
        .and_then(|d| d.row.emp_name.clone())
    {
        let t = n.trim();
        if !t.is_empty() {
            return Ok(t.to_string());
        }
    }
    let n: Option<String> = conn
        .query_row(
            "SELECT name FROM employees WHERE id = ?",
            [employee_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(n
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("מפעיל {}", employee_id)))
}

fn global_rules_violations_for_query_date(
    conn: &Connection,
    query_date: &str,
) -> rusqlite::Result<Vec<Violation>> {
    let qd = match NaiveDate::parse_from_str(query_date, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => return Ok(vec![]),
    };
    let week_sun = week_sunday_for_date(qd);
    let week_sat = week_sun + Duration::days(6);
    let load_lo = (week_sun - Duration::days(1)).format("%Y-%m-%d").to_string();
    let load_hi = (week_sat + Duration::days(1)).format("%Y-%m-%d").to_string();
    let prev_d = (qd - Duration::days(1)).format("%Y-%m-%d").to_string();
    let next_d = (qd + Duration::days(1)).format("%Y-%m-%d").to_string();

    let rules = load_global_rules_snapshot(conn)?;
    let dated = load_shifts_range(conn, &load_lo, &load_hi)?;
    let events = load_schedule_events_range(conn, &load_lo, &load_hi)?;
    let availability = load_availability_range(conn, &load_lo, &load_hi)?;

    let mut violations: Vec<Violation> = Vec::new();
    let employees = collect_employees_on_date(query_date, &dated, &events);

    for (emp_id, emp_name_opt) in employees {
        let emp_name = emp_name_opt.clone();
        let shifts_q: Vec<DayShiftRow> = dated
            .iter()
            .filter(|d| d.shift_date == query_date && d.row.employee_id == emp_id)
            .map(|d| d.row.clone())
            .collect();
        let ev_q: Vec<&ScheduleEventRow> = events_for_emp_date(&events, emp_id, query_date);

        // Rule 1.1: calendar rows (event | constraint | operational) vs any shift segment;
        // one violation per (shift, calendar row); message uses flight window only.
        let mut seen_shift_event: std::collections::HashSet<(i64, i64)> =
            std::collections::HashSet::new();
        for s in &shifts_q {
            for ev in ev_q
                .iter()
                .filter(|e| schedule_event_kind_blocks_shift_segments(&e.event_kind))
            {
                let overlaps = s.overlap_segments().iter().any(|(a0, a1, _)| {
                    intervals_overlap_hhmm(a0, a1, ev.start_time.trim(), ev.end_time.trim())
                });
                if !overlaps {
                    continue;
                }
                if !seen_shift_event.insert((s.id, ev.id)) {
                    continue;
                }
                let flight_rng = format_flight_range(&s.start_time, &s.end_time);
                let msg = "התנגשות בזמנים בין אירוע לטיסה".to_string();
                let times = vec![flight_rng.clone(), schedule_calendar_row_label(ev)];
                violations.push(global_rules_violation(
                    "global_event_overlap",
                    "error",
                    msg,
                    Some(s.id),
                    emp_name.clone(),
                    Some(times),
                ));
            }
        }

        // Rule 1.3: shift or schedule_event wall time outside merged availability (matrix enabled union).
        let enabled_u = build_enabled_union_minutes(emp_id, query_date, &availability);
        let mut shift_outside_avail: std::collections::HashSet<i64> =
            std::collections::HashSet::new();
        for s in &shifts_q {
            let mut bad = false;
            for (a0, a1, _) in s.overlap_segments() {
                if wall_segment_outside_availability_union(a0, a1, &enabled_u) {
                    bad = true;
                    break;
                }
            }
            if bad && shift_outside_avail.insert(s.id) {
                violations.push(global_rules_violation(
                    "global_shift_outside_availability",
                    "error",
                    "טיסה מחוץ לזמינות".into(),
                    Some(s.id),
                    emp_name.clone(),
                    Some(vec![format_flight_range(&s.start_time, &s.end_time)]),
                ));
            }
        }
        let mut event_outside_avail: std::collections::HashSet<i64> =
            std::collections::HashSet::new();
        for ev in ev_q.iter().copied() {
            if wall_segment_outside_availability_union(
                ev.start_time.trim(),
                ev.end_time.trim(),
                &enabled_u,
            ) && event_outside_avail.insert(ev.id)
            {
                let ev_emp_display = match emp_name_opt.as_ref() {
                    Some(n) if !n.trim().is_empty() => Some(n.trim().to_string()),
                    _ => Some(employee_name_for_week_rule(conn, emp_id, &dated)?),
                };
                let ev_title = ev.name.trim();
                let ev_title_disp = if ev_title.is_empty() {
                    "—"
                } else {
                    ev_title
                };
                violations.push(global_rules_violation(
                    "global_event_outside_availability",
                    "error",
                    "אירוע מחוץ לזמינות".into(),
                    None,
                    ev_emp_display,
                    Some(vec![
                        format_flight_range(&ev.start_time, &ev.end_time),
                        ev_title_disp.to_string(),
                    ]),
                ));
            }
        }

        // Rule 1.2: gaps between consecutive bunches (same day)
        if !shifts_q.is_empty() {
            let bunches = bunch_ranges(&shifts_q);
            for bi in 0..bunches.len().saturating_sub(1) {
                let (_s0, e0) = bunches[bi];
                let (s1, _e1) = bunches[bi + 1];
                let last_in_b0 = &shifts_q[e0 - 1];
                let first_in_b1 = &shifts_q[s1];
                let gap_flight = gap_minutes_same_day(&last_in_b0.end_time, &first_in_b1.start_time);
                if rules.rest_between_shifts > 0 && (gap_flight as i64) < rules.rest_between_shifts {
                    let msg = format!(
                        "מנוחה קצרה מדי בין טיסות, {} דק' כאשר נדרש {} דק'",
                        gap_flight, rules.rest_between_shifts
                    );
                    violations.push(global_violation_warning(
                        "global_rest_between_shifts",
                        msg,
                        Some(first_in_b1.id),
                        emp_name.clone(),
                        Some(vec![
                            format_flight_range(&last_in_b0.start_time, &last_in_b0.end_time),
                            format_flight_range(&first_in_b1.start_time, &first_in_b1.end_time),
                        ]),
                    ));
                }
                let gap_outer =
                    gap_minutes_same_day(&last_in_b0.rest_end, &first_in_b1.prep_start);
                if rules.rest_between_outer > 0 && (gap_outer as i64) < rules.rest_between_outer {
                    let msg = format!(
                        "מנוחה קצרה מדי בין תחקיר לתדריך, {} דק' כאשר נדרש {} דק'",
                        gap_outer, rules.rest_between_outer
                    );
                    violations.push(global_violation_warning(
                        "global_rest_between_outer",
                        msg,
                        Some(first_in_b1.id),
                        emp_name.clone(),
                        Some(vec![
                            format_flight_range(&last_in_b0.rest_start, &last_in_b0.rest_end),
                            format_flight_range(&first_in_b1.prep_start, &first_in_b1.prep_end),
                        ]),
                    ));
                }
            }
        }

        // Rule 4: max workday (same calendar envelope)
        let ev_day: Vec<ScheduleEventRow> = events
            .iter()
            .filter(|e| e.shift_date == query_date && e.employee_id == emp_id)
            .cloned()
            .collect();
        if let Some(env) = envelope_for_day(emp_id, query_date, &shifts_q, &ev_day) {
            let span = wall_minutes_pair(env.min_start, env.max_end);
            if span as i64 > rules.max_workday_minutes {
                let msg = format!(
                    "יום עבודה ארוך מדי, {} שע' כאשר מותר עד' {} שע'",
                    fmt_hours_one_dec(span as i64),
                    fmt_hours_one_dec(rules.max_workday_minutes)
                );
                let sid = shifts_q
                    .iter()
                    .max_by_key(|s| time_to_minutes(s.rest_end.trim()))
                    .map(|s| s.id)
                    .or_else(|| shifts_q.first().map(|s| s.id));
                violations.push(global_violation_warning(
                    "global_max_workday",
                    msg,
                    sid,
                    emp_name.clone(),
                    shifts_q
                        .first()
                        .map(|s| vec![format_flight_range(&s.start_time, &s.end_time)]),
                ));
            }
        }

        // Rule 5: cross-day (needs envelope on query_date even if max-workday not exceeded)
        let ev_day5 = ev_day.clone();
        if let Some(env) = envelope_for_day(emp_id, query_date, &shifts_q, &ev_day5) {
            if let Some(env_prev) = envelope_from_maps(emp_id, &prev_d, &dated, &events) {
                if env_prev.max_end > rules.late_min && env.min_start < rules.early_min {
                    violations.push(global_violation_warning(
                        "global_cross_day_early_late_prev",
                        "יום עבודה מתחיל מוקדם והיום הקודם נגמר מאוחר".into(),
                        shifts_q.first().map(|s| s.id),
                        emp_name.clone(),
                        shifts_q.first().map(|s| {
                            vec![format_flight_range(&s.prep_start, &s.rest_end)]
                        }),
                    ));
                }
            }
            if let Some(env_next) = envelope_from_maps(emp_id, &next_d, &dated, &events) {
                if env.max_end > rules.late_min && env_next.min_start < rules.early_min {
                    violations.push(global_violation_warning(
                        "global_cross_day_early_late_next",
                        "יום עבודה נגמר מאוחר והיום הבא מתחיל מוקדם".into(),
                        shifts_q.first().map(|s| s.id),
                        emp_name.clone(),
                        shifts_q.first().map(|s| {
                            vec![format_flight_range(&s.prep_start, &s.rest_end)]
                        }),
                    ));
                }
            }
        }
    }

    // Rule 6: weekly caps (Sun–Sat) — at most one warning per (rule, employee).
    let week_start_s = week_sun.format("%Y-%m-%d").to_string();
    let week_end_s = week_sat.format("%Y-%m-%d").to_string();
    let mut emps_week: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for d in &dated {
        if d.shift_date >= week_start_s && d.shift_date <= week_end_s {
            emps_week.insert(d.row.employee_id);
        }
    }
    for ev in &events {
        if ev.shift_date >= week_start_s && ev.shift_date <= week_end_s {
            emps_week.insert(ev.employee_id);
        }
    }

    for eid in emps_week {
        let ename = employee_name_for_week_rule(conn, eid, &dated)?;
        let mut late_days = 0i64;
        let mut early_days = 0i64;
        let mut extreme_days = 0i64;
        let mut d0 = week_sun;
        while d0 <= week_sat {
            let ds = d0.format("%Y-%m-%d").to_string();
            let sh: Vec<DayShiftRow> = dated
                .iter()
                .filter(|x| x.shift_date == ds && x.row.employee_id == eid)
                .map(|x| x.row.clone())
                .collect();
            let evd: Vec<ScheduleEventRow> = events
                .iter()
                .filter(|x| x.shift_date == ds && x.employee_id == eid)
                .cloned()
                .collect();
            if let Some(env) = envelope_for_day(eid, &ds, &sh, &evd) {
                let late = env.max_end > rules.late_min;
                let early = env.min_start < rules.early_min;
                if late {
                    late_days += 1;
                }
                if early {
                    early_days += 1;
                }
                if late || early {
                    extreme_days += 1;
                }
            }
            d0 += Duration::days(1);
        }

        // Only surface each week-cap warning on calendar days that contribute to that cap.
        let sh_query: Vec<DayShiftRow> = dated
            .iter()
            .filter(|x| x.shift_date == query_date && x.row.employee_id == eid)
            .map(|x| x.row.clone())
            .collect();
        let ev_query: Vec<ScheduleEventRow> = events
            .iter()
            .filter(|x| x.shift_date == query_date && x.employee_id == eid)
            .cloned()
            .collect();
        let query_env = envelope_for_day(eid, query_date, &sh_query, &ev_query);
        let query_day_late = query_env
            .as_ref()
            .is_some_and(|e| e.max_end > rules.late_min);
        let query_day_early = query_env
            .as_ref()
            .is_some_and(|e| e.min_start < rules.early_min);
        let query_day_extreme = query_day_late || query_day_early;

        if late_days > rules.max_late_days && query_day_late {
            violations.push(global_violation_warning(
                "global_week_late_days",
                format!(
                    "יותר מדי ימים מאוחרים בשבוע, {} כאשר מותר עד {}",
                    late_days, rules.max_late_days
                ),
                None,
                Some(ename.clone()),
                None,
            ));
        }
        if early_days > rules.max_early_days && query_day_early {
            violations.push(global_violation_warning(
                "global_week_early_days",
                format!(
                    "יותר מדי ימים מוקדמים בשבוע, {} כאשר מותר עד {}",
                    early_days, rules.max_early_days
                ),
                None,
                Some(ename.clone()),
                None,
            ));
        }
        if extreme_days > rules.max_days_extreme && query_day_extreme {
            violations.push(global_violation_warning(
                "global_week_extreme_days",
                format!(
                    "יותר מדי ימים קיצוניים בשבוע, {} כאשר מותר עד {}",
                    extreme_days, rules.max_days_extreme
                ),
                None,
                Some(ename.clone()),
                None,
            ));
        }
    }

    Ok(dedupe_global_week_violations(violations))
}

/// At most one `global_week_*` row per (`rule`, `display_employee`) in a single response.
fn dedupe_global_week_violations(violations: Vec<Violation>) -> Vec<Violation> {
    let mut seen: std::collections::HashSet<(String, String)> =
        std::collections::HashSet::new();
    let mut out: Vec<Violation> = Vec::with_capacity(violations.len());
    for v in violations {
        if v.rule.starts_with("global_week") {
            let key = (
                v.rule.clone(),
                v.display_employee.clone().unwrap_or_default(),
            );
            if !seen.insert(key) {
                continue;
            }
        }
        out.push(v);
    }
    out
}

/// Build envelope for (emp, date) using preloaded `dated` + `events` (no extra DB).
fn envelope_from_maps(
    emp_id: i64,
    date: &str,
    dated: &[DayShiftWithDate],
    events: &[ScheduleEventRow],
) -> Option<DayEnvelope> {
    let shifts: Vec<DayShiftRow> = dated
        .iter()
        .filter(|d| d.shift_date == date && d.row.employee_id == emp_id)
        .map(|d| d.row.clone())
        .collect();
    let evd: Vec<ScheduleEventRow> = events
        .iter()
        .filter(|e| e.shift_date == date && e.employee_id == emp_id)
        .cloned()
        .collect();
    envelope_for_day(emp_id, date, &shifts, &evd)
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

    let emp_name: Option<String> = conn
        .query_row(
            "SELECT e.name FROM shifts s JOIN employees e ON s.employee_id = e.id WHERE s.id = ?",
            [shift_id],
            |r| r.get(0),
        )
        .optional()?;

    for v in global_rules_violations_for_query_date(conn, &shift_date)? {
        let applies = v.shift_id == Some(shift_id)
            || v.display_employee
                .as_deref()
                .zip(emp_name.as_deref())
                .is_some_and(|(a, b)| a == b);
        if applies {
            violations.push(v);
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
    for v in global_rules_violations_for_query_date(conn, shift_date)? {
        all.push(v.to_json());
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
    fn week_sunday_for_date_monday_returns_previous_sunday() {
        let mon = NaiveDate::from_ymd_opt(2025, 6, 9).unwrap();
        assert_eq!(
            week_sunday_for_date(mon),
            NaiveDate::from_ymd_opt(2025, 6, 8).unwrap()
        );
    }

    #[test]
    fn week_sunday_for_date_sunday_is_identity() {
        let sun = NaiveDate::from_ymd_opt(2025, 6, 8).unwrap();
        assert_eq!(week_sunday_for_date(sun), sun);
    }

    #[test]
    fn gap_minutes_same_day_between_flights() {
        assert_eq!(gap_minutes_same_day("10:00", "11:00"), 60);
        assert_eq!(gap_minutes_same_day("10:00", "10:00"), 0);
    }

    #[test]
    fn wall_minutes_pair_same_day_span() {
        assert_eq!(wall_minutes_pair(time_to_minutes("06:00"), time_to_minutes("18:00")), 12 * 60);
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
