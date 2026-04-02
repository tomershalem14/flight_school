//! Violation checks and weekly workload — behavior matches legacy Python implementation.

use chrono::{Duration, NaiveDate};
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

/// Check rules for a single shift row (joined columns match Python query).
pub fn check_shift_violations(conn: &Connection, shift_id: i64) -> rusqlite::Result<Vec<Violation>> {
    let mut violations = Vec::new();

    let shift = match conn.query_row(
        "SELECT s.id, s.shift_date, s.start_time, s.end_time, s.employee_id,
                st.name as type_name, st.duration_minutes, st.prep_minutes,
                st.recovery_minutes, st.allow_fly, st.max_concurrent_management,
                st.min_role_id, e.name as emp_name, e.role_id,
                r.is_management, r.can_fly, r.name as role_name
         FROM shifts s
         JOIN shift_types st ON s.shift_type_id = st.id
         LEFT JOIN employees e ON s.employee_id = e.id
         LEFT JOIN roles r ON e.role_id = r.id
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

    let start_min = time_to_minutes(&shift.start_time);
    let end_min = time_to_minutes(&shift.end_time);
    let prep = shift.prep_minutes;
    let recovery = shift.recovery_minutes;
    let shift_date = shift.shift_date.clone();

    // Rule 1: min role
    if let (Some(min_rid), Some(role_id)) = (shift.min_role_id, shift.role_id) {
        let exists: bool = conn
            .query_row("SELECT 1 FROM roles WHERE id = ?", [min_rid], |_| Ok(true))
            .unwrap_or(false);
        if exists && role_id < min_rid {
            let en = shift.emp_name.as_deref().unwrap_or("");
            let rn = shift.role_name.as_deref().unwrap_or("");
            violations.push(Violation {
                rule: "min_role".into(),
                severity: "error".into(),
                message: format!("עובד '{en}' ({rn}) אינו עומד בדרג המינימלי למשמרת זו"),
                shift_id: Some(shift_id),
            });
        }
    }

    // Rule 2: management cannot fly shift
    if shift.is_management == Some(1) && shift.allow_fly == 1 {
        let en = shift.emp_name.as_deref().unwrap_or("");
        violations.push(Violation {
            rule: "management_no_fly".into(),
            severity: "error".into(),
            message: format!("עובד ניהולי '{en}' לא יכול להיות מאויש במשמרת טיסה"),
            shift_id: Some(shift_id),
        });
    }

    // Rule 3: prep/recovery overlap
    let window_start = start_min - prep;
    let window_end = end_min + recovery;

    let mut stmt = conn.prepare(
        "SELECT s.id, s.start_time, s.end_time, st.prep_minutes, st.recovery_minutes, st.name
         FROM shifts s
         JOIN shift_types st ON s.shift_type_id = st.id
         WHERE s.employee_id = ? AND s.shift_date = ? AND s.id != ?",
    )?;
    let others = stmt.query_map(params![emp_id, shift_date, shift_id], |r| {
        Ok((
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i32>(3)?,
            r.get::<_, i32>(4)?,
            r.get::<_, String>(5)?,
        ))
    })?;

    let en = shift.emp_name.as_deref().unwrap_or("");
    let tn = &shift.type_name;
    for o in others.flatten() {
        let (ost, oet, oprep, orec, oname) = o;
        let other_start = time_to_minutes(&ost);
        let other_end = time_to_minutes(&oet);
        let other_ws = other_start - oprep;
        let other_we = other_end + orec;
        if window_start < other_we && window_end > other_ws {
            violations.push(Violation {
                rule: "prep_recovery_overlap".into(),
                severity: "error".into(),
                message: format!(
                    "'{en}' - חפיפה בין זמן הכנה/תאוששות של '{tn}' ל'{oname}'"
                ),
                shift_id: Some(shift_id),
            });
        }
    }

    // Rule 4: no consecutive evening (end >= 18:00)
    const LATE_THRESHOLD: i32 = 18 * 60;
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

    // Rule 5: last shift vs first 5
    let mut stmt = conn.prepare(
        "SELECT s.id, s.start_time, s.employee_id
         FROM shifts s
         WHERE s.shift_date = ? AND s.employee_id IS NOT NULL
         ORDER BY s.start_time",
    )?;
    let all_day: Vec<(i64, Option<i64>)> = stmt
        .query_map([&shift_date], |r| Ok((r.get(0)?, r.get(2)?)))?
        .filter_map(|x| x.ok())
        .collect();

    if all_day.len() >= 5 {
        let first_5: std::collections::HashSet<i64> =
            all_day.iter().take(5).filter_map(|(_, eid)| *eid).collect();
        if let Some((_, Some(last_eid))) = all_day.last() {
            if last_eid == &emp_id && first_5.contains(&emp_id) {
                violations.push(Violation {
                    rule: "last_shift_not_in_first_5".into(),
                    severity: "error".into(),
                    message: format!(
                        "'{en}' - מאויש במשמרת האחרונה וגם באחת מ-5 המשמרות הראשונות"
                    ),
                    shift_id: Some(shift_id),
                });
            }
        }
    }

    // Rule 6: management overlap
    if shift.is_management == Some(1) {
        let cnt: i64 = conn.query_row(
            "SELECT COUNT(*) FROM shifts s
             JOIN employees e ON s.employee_id = e.id
             JOIN roles r ON e.role_id = r.id
             WHERE s.shift_date = ? AND r.is_management = 1
               AND s.id != ?
               AND s.start_time < ? AND s.end_time > ?",
            params![shift_date, shift_id, shift.end_time, shift.start_time],
            |r| r.get(0),
        )?;
        if cnt >= 1 {
            violations.push(Violation {
                rule: "management_overlap".into(),
                severity: "error".into(),
                message: format!(
                    "'{en}' - שני אנשי ניהול ביחד (חוץ מניהולי שמורשה לשבת)"
                ),
                shift_id: Some(shift_id),
            });
        }
    }

    // Rule 7: constraints
    let mut cstmt = conn.prepare(
        "SELECT constraint_type, reason FROM constraints
         WHERE employee_id = ?
           AND start_datetime <= ? AND end_datetime >= ?",
    )?;
    let end_dt = format!("{} {}", shift_date, shift.end_time);
    let start_dt = format!("{} {}", shift_date, shift.start_time);
    let cons = cstmt.query_map(params![emp_id, end_dt, start_dt], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
    })?;
    for c in cons.flatten() {
        let reason = c.1.unwrap_or_default();
        let label = if reason.is_empty() {
            c.0.clone()
        } else {
            reason
        };
        violations.push(Violation {
            rule: "employee_constraint".into(),
            severity: "error".into(),
            message: format!("'{en}' - מאויש בזמן שהוגדר כאילוץ: {label}"),
            shift_id: Some(shift_id),
        });
    }

    Ok(violations)
}

struct ShiftRow {
    shift_date: String,
    start_time: String,
    end_time: String,
    employee_id: Option<i64>,
    type_name: String,
    prep_minutes: i32,
    recovery_minutes: i32,
    allow_fly: i32,
    min_role_id: Option<i64>,
    emp_name: Option<String>,
    role_id: Option<i64>,
    is_management: Option<i32>,
    role_name: Option<String>,
}

impl ShiftRow {
    fn from_row(r: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            shift_date: r.get(1)?,
            start_time: r.get(2)?,
            end_time: r.get(3)?,
            employee_id: r.get(4)?,
            type_name: r.get(5)?,
            prep_minutes: r.get(7)?,
            recovery_minutes: r.get(8)?,
            allow_fly: r.get(9)?,
            min_role_id: r.get(11)?,
            emp_name: r.get(12)?,
            role_id: r.get(13)?,
            is_management: r.get(14)?,
            role_name: r.get(16)?,
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
            "SELECT s.shift_date, s.start_time, s.end_time, st.name as type_name,
                st.duration_minutes
         FROM shifts s
         JOIN shift_types st ON s.shift_type_id = st.id
         WHERE s.employee_id = ? AND s.shift_date BETWEEN ? AND ?",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String, String, String, i32)> = stmt
        .query_map(params![employee_id, week_start, week_end], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect();

    let total_shifts = rows.len() as i32;
    let late_shifts = rows
        .iter()
        .filter(|r| time_to_minutes(&r.2) >= 18 * 60)
        .count() as i32;
    let total_minutes: i32 = rows.iter().map(|r| r.4).sum();

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
}
