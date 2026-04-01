"""
מודלי מסד הנתונים - SQLite
מערכת לוז לבית ספר לטיסה אזרחי
"""

import sqlite3
import sys
import os
from datetime import datetime, date, time

# When running as a PyInstaller exe, place the DB next to the exe (writable).
# When running as a script, place it next to models.py.
if getattr(sys, "frozen", False):
    _BASE = os.path.dirname(sys.executable)
else:
    _BASE = os.path.dirname(os.path.abspath(__file__))

DB_PATH = os.path.join(_BASE, "scheduler.db")


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db():
    conn = get_db()
    c = conn.cursor()

    # דרגי עובדים
    c.execute("""
        CREATE TABLE IF NOT EXISTS roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            can_fly INTEGER DEFAULT 1,
            is_management INTEGER DEFAULT 0,
            color TEXT DEFAULT '#3B82F6'
        )
    """)

    # עובדים
    c.execute("""
        CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            role_id INTEGER NOT NULL,
            is_active INTEGER DEFAULT 1,
            always_present INTEGER DEFAULT 0,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (role_id) REFERENCES roles(id)
        )
    """)

    # סוגי משמרות
    c.execute("""
        CREATE TABLE IF NOT EXISTS shift_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            duration_minutes INTEGER NOT NULL,
            prep_minutes INTEGER NOT NULL,
            recovery_minutes INTEGER NOT NULL,
            color TEXT DEFAULT '#6366F1',
            min_role_id INTEGER,
            allow_fly INTEGER DEFAULT 1,
            max_concurrent_management INTEGER DEFAULT 0,
            notes TEXT,
            FOREIGN KEY (min_role_id) REFERENCES roles(id)
        )
    """)

    # לוז שבועי - משמרות מאויישות
    c.execute("""
        CREATE TABLE IF NOT EXISTS shifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shift_date TEXT NOT NULL,
            shift_type_id INTEGER NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            employee_id INTEGER,
            status TEXT DEFAULT 'draft',
            manually_set INTEGER DEFAULT 0,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (shift_type_id) REFERENCES shift_types(id),
            FOREIGN KEY (employee_id) REFERENCES employees(id)
        )
    """)

    # אילוצי עובדים (חופשות, חסרות, זמינות)
    c.execute("""
        CREATE TABLE IF NOT EXISTS constraints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            start_datetime TEXT NOT NULL,
            end_datetime TEXT NOT NULL,
            constraint_type TEXT NOT NULL,
            reason TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (employee_id) REFERENCES employees(id)
        )
    """)

    # משימות קבועות / הזמנות מראש
    c.execute("""
        CREATE TABLE IF NOT EXISTS fixed_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            shift_date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            task_name TEXT NOT NULL,
            notes TEXT,
            FOREIGN KEY (employee_id) REFERENCES employees(id)
        )
    """)

    # נתוני ביקורת / שינויים
    c.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            entity TEXT NOT NULL,
            entity_id INTEGER,
            old_value TEXT,
            new_value TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # טבלת הגדרות
    c.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)

    # רישום מרחוק
    c.execute("""
        CREATE TABLE IF NOT EXISTS remote_registrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER,
            employee_name TEXT NOT NULL,
            shift_date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            reg_start TEXT,
            reg_end TEXT,
            status TEXT DEFAULT 'pending',
            session_token TEXT,
            form_id TEXT,
            shift_id INTEGER,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (employee_id) REFERENCES employees(id)
        )
    """)

    # הגדרות מערכת
    c.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)

    # מיגרציות - עמודות שנוספו
    for migration in [
        "ALTER TABLE remote_registrations ADD COLUMN reg_start TEXT",
        "ALTER TABLE remote_registrations ADD COLUMN reg_end TEXT",
        "ALTER TABLE remote_registrations ADD COLUMN session_token TEXT",
        "ALTER TABLE remote_registrations ADD COLUMN form_id TEXT",
        "ALTER TABLE remote_registrations ADD COLUMN shift_id INTEGER",
    ]:
        try:
            c.execute(migration)
        except Exception:
            pass  # column already exists

    conn.commit()

    # נתוני ברירת מחדל - דרגים
    c.execute("SELECT COUNT(*) FROM roles")
    if c.fetchone()[0] == 0:
        default_roles = [
            ("מדריך", 1, 0, "#3B82F6"),
            ("מדריך בכיר", 1, 0, "#8B5CF6"),
            ("ניהול", 0, 1, "#EF4444"),
            ("אחראי יום", 0, 1, "#F59E0B"),
        ]
        c.executemany(
            "INSERT INTO roles (name, can_fly, is_management, color) VALUES (?,?,?,?)",
            default_roles
        )

    # נתוני ברירת מחדל - סוגי משמרות
    c.execute("SELECT COUNT(*) FROM shift_types")
    if c.fetchone()[0] == 0:
        default_shifts = [
            # name, duration_min, prep_min, recovery_min, color, min_role_id, allow_fly, max_mgmt, notes
            ("משמרת שעה", 60, 30, 30, "#3B82F6", None, 1, 0, "משמרת טיסה - שעה"),
            ("משמרת שעתיים", 120, 60, 60, "#6366F1", None, 1, 0, "משמרת טיסה - שעתיים רצופות"),
            ("שעה + שעה (הפסקה 2 שעות)", 60, 30, 30, "#8B5CF6", None, 1, 0, "שעה, 2 שעות מנוחה, עוד שעה"),
            ("שעתיים + שעה (הפסקה 3 שעות)", 120, 60, 60, "#A855F7", None, 1, 0, "שעתיים, 3 שעות מנוחה, עוד שעה"),
            ("פתיחת יום", 30, 0, 0, "#F59E0B", 4, 0, 0, "אחראי יום - בוקר"),
            ("סגירת יום", 30, 0, 0, "#EF4444", 4, 0, 0, "אחראי יום - ערב"),
            ("משמרת ניהול", 60, 0, 0, "#10B981", None, 0, 1, "איוש ניהולי - לא יכול לטוס"),
        ]
        c.executemany(
            """INSERT INTO shift_types
               (name, duration_minutes, prep_minutes, recovery_minutes, color,
                min_role_id, allow_fly, max_concurrent_management, notes)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            default_shifts
        )

    conn.commit()
    conn.close()
