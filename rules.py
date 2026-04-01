"""
מנוע חוקי האיוש
מבצע ולידציה ומחזיר רשימת הפרות
"""

from datetime import datetime, date, timedelta
from typing import List, Dict, Optional, Tuple
import sqlite3


def time_to_minutes(t: str) -> int:
    """המרת שעה (HH:MM) לדקות מתחילת היום"""
    h, m = map(int, t.split(":"))
    return h * 60 + m


def minutes_to_time(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


class Violation:
    def __init__(self, rule: str, severity: str, message: str, shift_id: Optional[int] = None):
        self.rule = rule
        self.severity = severity  # "error" | "warning"
        self.message = message
        self.shift_id = shift_id

    def to_dict(self):
        return {
            "rule": self.rule,
            "severity": self.severity,
            "message": self.message,
            "shift_id": self.shift_id,
        }


def check_shift_violations(conn: sqlite3.Connection, shift_id: int) -> List[Violation]:
    """בדיקת חוקים עבור משמרת ספציפית"""
    violations = []
    c = conn.cursor()

    shift = c.execute("""
        SELECT s.*, st.name as type_name, st.duration_minutes, st.prep_minutes,
               st.recovery_minutes, st.allow_fly, st.max_concurrent_management,
               st.min_role_id, e.name as emp_name, e.role_id,
               r.is_management, r.can_fly, r.name as role_name
        FROM shifts s
        JOIN shift_types st ON s.shift_type_id = st.id
        LEFT JOIN employees e ON s.employee_id = e.id
        LEFT JOIN roles r ON e.role_id = r.id
        WHERE s.id = ?
    """, (shift_id,)).fetchone()

    if not shift or not shift["employee_id"]:
        return violations

    emp_id = shift["employee_id"]
    shift_date = shift["shift_date"]
    start_min = time_to_minutes(shift["start_time"])
    end_min = time_to_minutes(shift["end_time"])
    prep = shift["prep_minutes"]
    recovery = shift["recovery_minutes"]

    # --- חוק 1: רמת דרג מינימלית ---
    if shift["min_role_id"] and shift["role_id"]:
        min_role = c.execute("SELECT id FROM roles WHERE id = ?", (shift["min_role_id"],)).fetchone()
        if min_role and shift["role_id"] < shift["min_role_id"]:
            violations.append(Violation(
                "min_role",
                "error",
                f"עובד '{shift['emp_name']}' ({shift['role_name']}) אינו עומד בדרג המינימלי למשמרת זו",
                shift_id
            ))

    # --- חוק 2: ניהול לא יכול לטוס ---
    if shift["is_management"] and shift["allow_fly"]:
        violations.append(Violation(
            "management_no_fly",
            "error",
            f"עובד ניהולי '{shift['emp_name']}' לא יכול להיות מאויש במשמרת טיסה",
            shift_id
        ))

    # --- חוק 3: זמן הכנה ותאוששות - חפיפה עם משמרות אחרות ---
    window_start = start_min - prep
    window_end = end_min + recovery

    other_shifts = c.execute("""
        SELECT s.id, s.start_time, s.end_time, st.prep_minutes, st.recovery_minutes, st.name
        FROM shifts s
        JOIN shift_types st ON s.shift_type_id = st.id
        WHERE s.employee_id = ? AND s.shift_date = ? AND s.id != ?
    """, (emp_id, shift_date, shift_id)).fetchall()

    for os_ in other_shifts:
        other_start = time_to_minutes(os_["start_time"])
        other_end = time_to_minutes(os_["end_time"])
        other_window_start = other_start - os_["prep_minutes"]
        other_window_end = other_end + os_["recovery_minutes"]

        # חפיפה בין חלון הנוכחי לחלון האחר
        if window_start < other_window_end and window_end > other_window_start:
            violations.append(Violation(
                "prep_recovery_overlap",
                "error",
                f"'{shift['emp_name']}' - חפיפה בין זמן הכנה/תאוששות של '{shift['type_name']}' ל'{os_['name']}'",
                shift_id
            ))

    # --- חוק 4: משמרת ערב לא פעמיים ברצף ---
    LATE_THRESHOLD = 18 * 60  # 18:00
    if end_min >= LATE_THRESHOLD:
        # בדוק אם אתמול / מחר גם יש משמרת ערב
        shift_dt = datetime.strptime(shift_date, "%Y-%m-%d").date()
        prev_date = (shift_dt - timedelta(days=1)).strftime("%Y-%m-%d")
        next_date = (shift_dt + timedelta(days=1)).strftime("%Y-%m-%d")

        for check_date, direction in [(prev_date, "אתמול"), (next_date, "מחר")]:
            adjacent_late = c.execute("""
                SELECT s.id FROM shifts s
                WHERE s.employee_id = ? AND s.shift_date = ?
                  AND CAST(substr(s.end_time, 1, 2) AS INTEGER) >= 18
            """, (emp_id, check_date)).fetchone()
            if adjacent_late:
                violations.append(Violation(
                    "no_consecutive_evening",
                    "error",
                    f"'{shift['emp_name']}' - משמרת ערב ברצף ({direction} גם משמרת ערב)",
                    shift_id
                ))
                break

    # --- חוק 5: משמרת אחרונה = לא יכול להיות ב-5 ראשונות ---
    all_day_shifts = c.execute("""
        SELECT s.id, s.start_time, s.employee_id
        FROM shifts s
        WHERE s.shift_date = ? AND s.employee_id IS NOT NULL
        ORDER BY s.start_time
    """, (shift_date,)).fetchall()

    if len(all_day_shifts) >= 5:
        first_5_emp_ids = {row["employee_id"] for row in all_day_shifts[:5]}
        last_emp_id = all_day_shifts[-1]["employee_id"] if all_day_shifts else None

        if last_emp_id == emp_id and emp_id in first_5_emp_ids:
            violations.append(Violation(
                "last_shift_not_in_first_5",
                "error",
                f"'{shift['emp_name']}' - מאויש במשמרת האחרונה וגם באחת מ-5 המשמרות הראשונות",
                shift_id
            ))

    # --- חוק 6: ניהול - לא יותר מניהולי אחד שלא טס (חוץ מהמותר) ---
    if shift["is_management"]:
        mgmt_shifts_same_time = c.execute("""
            SELECT COUNT(*) as cnt FROM shifts s
            JOIN employees e ON s.employee_id = e.id
            JOIN roles r ON e.role_id = r.id
            WHERE s.shift_date = ? AND r.is_management = 1
              AND s.id != ?
              AND s.start_time < ? AND s.end_time > ?
        """, (shift_date, shift_id, shift["end_time"], shift["start_time"])).fetchone()

        if mgmt_shifts_same_time and mgmt_shifts_same_time["cnt"] >= 1:
            violations.append(Violation(
                "management_overlap",
                "error",
                f"'{shift['emp_name']}' - שני אנשי ניהול ביחד (חוץ מניהולי שמורשה לשבת)",
                shift_id
            ))

    # --- חוק 7: אילוצי עובד ---
    constraints = c.execute("""
        SELECT * FROM constraints
        WHERE employee_id = ?
          AND start_datetime <= ? AND end_datetime >= ?
    """, (emp_id,
          f"{shift_date} {shift['end_time']}",
          f"{shift_date} {shift['start_time']}")).fetchall()

    for con in constraints:
        violations.append(Violation(
            "employee_constraint",
            "error",
            f"'{shift['emp_name']}' - מאויש בזמן שהוגדר כאילוץ: {con['reason'] or con['constraint_type']}",
            shift_id
        ))

    return violations


def check_all_violations_for_date(conn: sqlite3.Connection, shift_date: str) -> List[Dict]:
    """בדיקת כל המשמרות ביום נתון"""
    c = conn.cursor()
    shifts = c.execute(
        "SELECT id FROM shifts WHERE shift_date = ?", (shift_date,)
    ).fetchall()

    all_violations = []
    for s in shifts:
        vs = check_shift_violations(conn, s["id"])
        all_violations.extend([v.to_dict() for v in vs])
    return all_violations


def get_workload_color(shifts_count: int, late_shifts: int) -> str:
    """
    מחשב את צבע העומס:
    ירוק = תקין, צהוב = מאתגר, אדום = לא תקין
    """
    if shifts_count > 4 or late_shifts >= 2:
        return "red"
    elif shifts_count >= 3 or late_shifts >= 1:
        return "yellow"
    return "green"


def get_weekly_workload(conn: sqlite3.Connection, employee_id: int, week_start: str) -> Dict:
    """חישוב עומס שבועי לעובד"""
    c = conn.cursor()
    week_dt = datetime.strptime(week_start, "%Y-%m-%d").date()
    week_end = (week_dt + timedelta(days=6)).strftime("%Y-%m-%d")

    shifts = c.execute("""
        SELECT s.shift_date, s.start_time, s.end_time, st.name as type_name,
               st.duration_minutes
        FROM shifts s
        JOIN shift_types st ON s.shift_type_id = st.id
        WHERE s.employee_id = ? AND s.shift_date BETWEEN ? AND ?
    """, (employee_id, week_start, week_end)).fetchall()

    total_shifts = len(shifts)
    late_shifts = sum(
        1 for s in shifts if time_to_minutes(s["end_time"]) >= 18 * 60
    )
    total_minutes = sum(s["duration_minutes"] for s in shifts)

    return {
        "total_shifts": total_shifts,
        "late_shifts": late_shifts,
        "total_hours": round(total_minutes / 60, 1),
        "color": get_workload_color(total_shifts, late_shifts),
    }
