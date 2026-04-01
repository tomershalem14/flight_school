"""
תיקון סכמת DB - מאפשר employee_id להיות NULL
"""
import sqlite3, os, sys

_BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_BASE, "scheduler.db")

conn = sqlite3.connect(DB_PATH, timeout=15)
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA journal_mode = WAL")

print("מתקן טבלת remote_registrations...")

# Check current constraint
cols = conn.execute("PRAGMA table_info(remote_registrations)").fetchall()
for c in cols:
    if c["name"] == "employee_id":
        print(f"employee_id: notnull={c['notnull']}, dflt={c['dflt_value']}")

# SQLite doesn't support ALTER COLUMN - need to recreate table
print("יוצר טבלה חדשה...")
conn.execute("BEGIN")

try:
    # Create new table without NOT NULL on employee_id
    conn.execute("""
        CREATE TABLE IF NOT EXISTS remote_registrations_new (
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
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (employee_id) REFERENCES employees(id)
        )
    """)
    
    # Copy existing data
    conn.execute("""
        INSERT INTO remote_registrations_new
        SELECT id, employee_id, employee_name, shift_date, start_time, end_time,
               reg_start, reg_end, status, session_token, form_id, shift_id, notes, created_at
        FROM remote_registrations
    """)
    
    # Drop old, rename new
    conn.execute("DROP TABLE remote_registrations")
    conn.execute("ALTER TABLE remote_registrations_new RENAME TO remote_registrations")
    
    conn.execute("COMMIT")
    print("✅ טבלה תוקנה בהצלחה!")

    # Test insert
    c = conn.cursor()
    c.execute("""
        INSERT INTO remote_registrations
          (employee_id, employee_name, shift_date, start_time, end_time, reg_start, reg_end, status)
        VALUES (?,?,?,?,?,?,?,'submitted')
    """, (None, "בדיקה", "2026-03-14", "12:00", "15:00", "12:00", "15:00"))
    conn.commit()
    print("✅ INSERT עם NULL עובד! id:", c.lastrowid)
    conn.execute("DELETE FROM remote_registrations WHERE employee_name='בדיקה'")
    conn.commit()
    print("✅ ניקיון בדיקה הצליח")

except Exception as e:
    conn.execute("ROLLBACK")
    print("❌ שגיאה:", e)

conn.close()
print("סיום!")
