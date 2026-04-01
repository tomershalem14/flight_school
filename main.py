"""
FastAPI Backend - מערכת לוז בית ספר לטיסה
"""

import sys
import os
import webbrowser
import subprocess
import sqlite3
from multiprocessing import freeze_support
from datetime import datetime, date, timedelta
from typing import Optional, List

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

from models import get_db, init_db, DB_PATH
from rules import (
    check_shift_violations,
    check_all_violations_for_date,
    get_weekly_workload,
)

# ─── PyInstaller support ───
# When frozen (exe), static files are bundled inside _MEIPASS.
# The DB lives next to the exe so it stays writable.
if getattr(sys, "frozen", False):
    BASE_DIR = sys._MEIPASS          # bundled resources (static/)
    EXE_DIR  = os.path.dirname(sys.executable)  # folder next to .exe
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    EXE_DIR  = BASE_DIR

STATIC_DIR = os.path.join(BASE_DIR, "static")

app = FastAPI(title="מערכת לוז - בית ספר לטיסה", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.on_event("startup")
def startup():
    init_db()


# ─────────────────────────── ROOT ───────────────────────────

@app.get("/", response_class=HTMLResponse)
def root():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# ─────────────────────────── ROLES ───────────────────────────

@app.get("/api/roles")
def get_roles():
    conn = get_db()
    rows = conn.execute("SELECT * FROM roles ORDER BY id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


class RoleCreate(BaseModel):
    name: str
    can_fly: bool = True
    is_management: bool = False
    color: str = "#3B82F6"


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    can_fly: Optional[bool] = None
    is_management: Optional[bool] = None
    color: Optional[str] = None

@app.put("/api/roles/{role_id}")
def update_role(role_id: int, role: RoleUpdate):
    conn = get_db()
    c = conn.cursor()
    existing = c.execute("SELECT * FROM roles WHERE id = ?", (role_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "דרג לא נמצא")
    updates = {k: v for k, v in role.dict().items() if v is not None or isinstance(v, bool)}
    if not updates:
        conn.close()
        return {"ok": True}
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [role_id]
    c.execute(f"UPDATE roles SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return {"ok": True}

@app.post("/api/roles")
def create_role(role: RoleCreate):
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO roles (name, can_fly, is_management, color) VALUES (?,?,?,?)",
        (role.name, int(role.can_fly), int(role.is_management), role.color)
    )
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return {"id": new_id, **role.dict()}


# ─────────────────────────── EMPLOYEES ───────────────────────────

@app.get("/api/employees")
def get_employees(active_only: bool = True):
    conn = get_db()
    query = """
        SELECT e.*, r.name as role_name, r.color as role_color,
               r.is_management, r.can_fly
        FROM employees e
        JOIN roles r ON e.role_id = r.id
    """
    if active_only:
        query += " WHERE e.is_active = 1"
    query += " ORDER BY r.id, e.name"
    rows = conn.execute(query).fetchall()
    conn.close()
    return [dict(r) for r in rows]


class EmployeeCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    role_id: int
    always_present: bool = False
    affiliation: Optional[str] = None
    notes: Optional[str] = None


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    role_id: Optional[int] = None
    always_present: Optional[bool] = None
    is_active: Optional[bool] = None
    affiliation: Optional[str] = None
    notes: Optional[str] = None


@app.post("/api/employees")
def create_employee(emp: EmployeeCreate):
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO employees (name, phone, role_id, always_present, affiliation, notes) VALUES (?,?,?,?,?,?)",
        (emp.name, emp.phone, emp.role_id, int(emp.always_present), emp.affiliation, emp.notes)
    )
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return {"id": new_id, **emp.dict()}


@app.put("/api/employees/{emp_id}")
def update_employee(emp_id: int, emp: EmployeeUpdate):
    conn = get_db()
    c = conn.cursor()
    existing = c.execute("SELECT * FROM employees WHERE id = ?", (emp_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "עובד לא נמצא")

    updates = {k: v for k, v in emp.dict().items() if v is not None or isinstance(v, bool)}
    if not updates:
        conn.close()
        return {"ok": True}

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [emp_id]
    c.execute(f"UPDATE employees SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/employees/{emp_id}")
def deactivate_employee(emp_id: int):
    conn = get_db()
    conn.execute("UPDATE employees SET is_active = 0 WHERE id = ?", (emp_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ─────────────────────────── SHIFT TYPES ───────────────────────────

@app.get("/api/shift-types")
def get_shift_types():
    conn = get_db()
    rows = conn.execute("""
        SELECT st.*, r.name as min_role_name
        FROM shift_types st
        LEFT JOIN roles r ON st.min_role_id = r.id
        ORDER BY st.id
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


class ShiftTypeCreate(BaseModel):
    name: str
    duration_minutes: int
    prep_minutes: int
    recovery_minutes: int
    color: str = "#6366F1"
    min_role_id: Optional[int] = None
    allow_fly: bool = True
    max_concurrent_management: int = 0
    notes: Optional[str] = None


@app.post("/api/shift-types")
def create_shift_type(st: ShiftTypeCreate):
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        INSERT INTO shift_types
        (name, duration_minutes, prep_minutes, recovery_minutes, color,
         min_role_id, allow_fly, max_concurrent_management, notes)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, (st.name, st.duration_minutes, st.prep_minutes, st.recovery_minutes,
          st.color, st.min_role_id, int(st.allow_fly), st.max_concurrent_management,
          st.notes))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return {"id": new_id, **st.dict()}


# ─────────────────────────── SHIFTS (SCHEDULE) ───────────────────────────

@app.get("/api/shifts")
def get_shifts(week_start: str):
    """קבלת כל המשמרות לשבוע נתון (YYYY-MM-DD של ראשון)"""
    try:
        dt = datetime.strptime(week_start, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "פורמט תאריך שגוי - השתמש ב-YYYY-MM-DD")

    week_end = (dt + timedelta(days=6)).strftime("%Y-%m-%d")

    conn = get_db()
    rows = conn.execute("""
        SELECT s.*, st.name as type_name, st.color as type_color,
               st.duration_minutes, st.prep_minutes, st.recovery_minutes,
               e.name as emp_name, r.name as role_name, r.color as role_color
        FROM shifts s
        JOIN shift_types st ON s.shift_type_id = st.id
        LEFT JOIN employees e ON s.employee_id = e.id
        LEFT JOIN roles r ON e.role_id = r.id
        WHERE s.shift_date BETWEEN ? AND ?
        ORDER BY s.shift_date, s.start_time
    """, (week_start, week_end)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


class ShiftCreate(BaseModel):
    shift_date: str
    shift_type_id: int
    start_time: str
    end_time: str
    employee_id: Optional[int] = None
    notes: Optional[str] = None


class ShiftUpdate(BaseModel):
    employee_id: Optional[int] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = None


@app.post("/api/shifts")
def create_shift(shift: ShiftCreate):
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        INSERT INTO shifts (shift_date, shift_type_id, start_time, end_time,
                            employee_id, manually_set, notes)
        VALUES (?,?,?,?,?,1,?)
    """, (shift.shift_date, shift.shift_type_id, shift.start_time, shift.end_time,
          shift.employee_id, shift.notes))
    conn.commit()
    new_id = c.lastrowid

    violations = []
    if shift.employee_id:
        vs = check_shift_violations(conn, new_id)
        violations = [v.to_dict() for v in vs]

    conn.close()
    return {"id": new_id, "violations": violations}


@app.put("/api/shifts/{shift_id}")
def update_shift(shift_id: int, shift: ShiftUpdate):
    conn = get_db()
    c = conn.cursor()
    existing = c.execute("SELECT * FROM shifts WHERE id = ?", (shift_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "משמרת לא נמצאה")

    updates = {k: v for k, v in shift.dict().items() if v is not None}
    if not updates:
        conn.close()
        return {"ok": True, "violations": []}

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [shift_id]
    c.execute(f"UPDATE shifts SET {set_clause}, manually_set = 1 WHERE id = ?", values)
    conn.commit()

    violations = []
    emp_id = shift.employee_id or existing["employee_id"]
    if emp_id:
        vs = check_shift_violations(conn, shift_id)
        violations = [v.to_dict() for v in vs]

    conn.close()
    return {"ok": True, "violations": violations}


@app.delete("/api/shifts/{shift_id}")
def delete_shift(shift_id: int):
    conn = get_db()
    conn.execute("DELETE FROM shifts WHERE id = ?", (shift_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/shifts/{shift_id}/violations")
def get_shift_violations(shift_id: int):
    conn = get_db()
    vs = check_shift_violations(conn, shift_id)
    conn.close()
    return [v.to_dict() for v in vs]


@app.get("/api/violations")
def get_day_violations(date: str):
    conn = get_db()
    vs = check_all_violations_for_date(conn, date)
    conn.close()
    return vs


# ─────────────────────────── CONSTRAINTS ───────────────────────────

@app.get("/api/constraints")
def get_constraints(employee_id: Optional[int] = None):
    conn = get_db()
    query = """
        SELECT c.*, e.name as emp_name
        FROM constraints c
        JOIN employees e ON c.employee_id = e.id
    """
    params = []
    if employee_id:
        query += " WHERE c.employee_id = ?"
        params.append(employee_id)
    query += " ORDER BY c.start_datetime"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


class ConstraintCreate(BaseModel):
    employee_id: int
    start_datetime: str
    end_datetime: str
    constraint_type: str  # "absence" | "vacation" | "unavailable" | "preferred"
    reason: Optional[str] = None


@app.post("/api/constraints")
def create_constraint(con: ConstraintCreate):
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        INSERT INTO constraints (employee_id, start_datetime, end_datetime, constraint_type, reason)
        VALUES (?,?,?,?,?)
    """, (con.employee_id, con.start_datetime, con.end_datetime, con.constraint_type, con.reason))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return {"id": new_id, **con.dict()}


class ConstraintUpdate(BaseModel):
    employee_id: Optional[int] = None
    start_datetime: Optional[str] = None
    end_datetime: Optional[str] = None
    constraint_type: Optional[str] = None
    reason: Optional[str] = None


@app.put("/api/constraints/{con_id}")
def update_constraint(con_id: int, con: ConstraintUpdate):
    conn = get_db()
    c = conn.cursor()
    existing = c.execute("SELECT * FROM constraints WHERE id = ?", (con_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "אילוץ לא נמצא")
    updates = {k: v for k, v in con.dict().items() if v is not None}
    if not updates:
        conn.close()
        return {"ok": True}
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [con_id]
    c.execute(f"UPDATE constraints SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/constraints/{con_id}")
def delete_constraint(con_id: int):
    conn = get_db()
    conn.execute("DELETE FROM constraints WHERE id = ?", (con_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ─────────────────────────── FIXED ASSIGNMENTS ───────────────────────────

@app.get("/api/fixed-assignments")
def get_fixed_assignments(employee_id: Optional[int] = None, shift_date: Optional[str] = None):
    conn = get_db()
    query = """
        SELECT fa.*, e.name as emp_name FROM fixed_assignments fa
        JOIN employees e ON fa.employee_id = e.id WHERE 1=1
    """
    params = []
    if employee_id:
        query += " AND fa.employee_id = ?"
        params.append(employee_id)
    if shift_date:
        query += " AND fa.shift_date = ?"
        params.append(shift_date)
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


class FixedAssignmentCreate(BaseModel):
    employee_id: int
    shift_date: str
    start_time: str
    end_time: str
    task_name: str
    notes: Optional[str] = None


@app.post("/api/fixed-assignments")
def create_fixed_assignment(fa: FixedAssignmentCreate):
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        INSERT INTO fixed_assignments (employee_id, shift_date, start_time, end_time, task_name, notes)
        VALUES (?,?,?,?,?,?)
    """, (fa.employee_id, fa.shift_date, fa.start_time, fa.end_time, fa.task_name, fa.notes))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return {"id": new_id, **fa.dict()}


@app.delete("/api/fixed-assignments/{fa_id}")
def delete_fixed_assignment(fa_id: int):
    conn = get_db()
    conn.execute("DELETE FROM fixed_assignments WHERE id = ?", (fa_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ─────────────────────────── REPORTS ───────────────────────────

@app.get("/api/reports/workload")
def get_workload_report(week_start: str):
    """דוח עומסים שבועי לכל העובדים"""
    conn = get_db()
    employees = conn.execute(
        "SELECT id, name FROM employees WHERE is_active = 1"
    ).fetchall()

    report = []
    for emp in employees:
        wl = get_weekly_workload(conn, emp["id"], week_start)
        wl["employee_id"] = emp["id"]
        wl["employee_name"] = emp["name"]
        report.append(wl)

    conn.close()
    return report


@app.get("/api/reports/history/{employee_id}")
def get_employee_history(employee_id: int, limit: int = 20):
    """היסטוריית משמרות של עובד"""
    conn = get_db()
    rows = conn.execute("""
        SELECT s.id, s.shift_date, s.start_time, s.end_time, s.notes,
               st.name as type_name, st.color as type_color
        FROM shifts s
        JOIN shift_types st ON s.shift_type_id = st.id
        WHERE s.employee_id = ?
        ORDER BY s.shift_date DESC, s.start_time DESC
        LIMIT ?
    """, (employee_id, limit)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/reports/last-shift/{employee_id}")
def get_last_shift(employee_id: int):
    """המשמרת האחרונה של עובד"""
    conn = get_db()
    row = conn.execute("""
        SELECT s.shift_date, s.start_time, s.end_time, st.name as type_name
        FROM shifts s
        JOIN shift_types st ON s.shift_type_id = st.id
        WHERE s.employee_id = ? AND s.shift_date <= date('now')
        ORDER BY s.shift_date DESC, s.start_time DESC
        LIMIT 1
    """, (employee_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


@app.get("/api/reports/shift-count")
def get_shift_count_report(week_start: str):
    """טבלת מעקב - כמות משמרות לכל עובד לפי סוג"""
    try:
        dt = datetime.strptime(week_start, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "פורמט תאריך שגוי")

    week_end = (dt + timedelta(days=6)).strftime("%Y-%m-%d")

    conn = get_db()
    rows = conn.execute("""
        SELECT e.name as emp_name, st.name as type_name, COUNT(*) as count
        FROM shifts s
        JOIN employees e ON s.employee_id = e.id
        JOIN shift_types st ON s.shift_type_id = st.id
        WHERE s.shift_date BETWEEN ? AND ? AND s.employee_id IS NOT NULL
        GROUP BY e.id, st.id
        ORDER BY e.name, st.name
    """, (week_start, week_end)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─────────────────────────── WHATSAPP ───────────────────────────

@app.post("/api/whatsapp/send")
def send_whatsapp(week_start: str):
    """
    מייצר קישורי WhatsApp Web לכל עובד עם סיכום המשמרות שלו בשבוע
    """
    try:
        dt = datetime.strptime(week_start, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "פורמט תאריך שגוי")

    week_end = (dt + timedelta(days=6)).strftime("%Y-%m-%d")
    conn = get_db()

    employees = conn.execute(
        "SELECT id, name, phone FROM employees WHERE is_active = 1 AND phone IS NOT NULL"
    ).fetchall()

    results = []
    DAYS_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]

    for emp in employees:
        shifts = conn.execute("""
            SELECT s.shift_date, s.start_time, s.end_time, st.name as type_name
            FROM shifts s
            JOIN shift_types st ON s.shift_type_id = st.id
            WHERE s.employee_id = ? AND s.shift_date BETWEEN ? AND ?
            ORDER BY s.shift_date, s.start_time
        """, (emp["id"], week_start, week_end)).fetchall()

        if not shifts:
            continue

        lines = [f"שלום {emp['name']},\nלוז משמרות לשבוע {week_start}:\n"]
        for s in shifts:
            sd = datetime.strptime(s["shift_date"], "%Y-%m-%d").date()
            day_name = DAYS_HE[sd.weekday() if sd.weekday() != 6 else 6]
            # Python: Mon=0...Sun=6 → ראשון=Sun=6 → shift by +1
            weekday = (sd.weekday() + 1) % 7
            day_name = DAYS_HE[weekday]
            lines.append(f"• {day_name} {s['shift_date']} | {s['start_time']}-{s['end_time']} | {s['type_name']}")

        message = "\n".join(lines)
        phone = emp["phone"].replace("-", "").replace("+", "").replace(" ", "")
        if phone.startswith("0"):
            phone = "972" + phone[1:]

        import urllib.parse
        url = f"https://wa.me/{phone}?text={urllib.parse.quote(message)}"
        results.append({
            "employee_name": emp["name"],
            "phone": emp["phone"],
            "message": message,
            "wa_url": url,
        })

    conn.close()
    return results


# ─────────────────────────── TUNNEL (SSH / serveo.net) ───────────────────────────

import socket, threading, re as _re

_tunnel_state = {"url": None, "thread": None, "status": "stopped"}


def _local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


@app.get("/api/tunnel/status")
def tunnel_status():
    local_url  = f"http://{_local_ip()}:5050"
    public_url = _tunnel_state.get("url")
    return {
        "status":     _tunnel_state["status"],
        "public_url": public_url,
        "local_url":  local_url,
        "base_url":   public_url or local_url,
        "has_tunnel": bool(public_url),
        "exe_found":  True,
    }


@app.post("/api/tunnel/start")
def start_tunnel():
    if _tunnel_state["status"] in ("starting", "running"):
        return {"ok": True, "message": "מנהרה כבר פעילה"}
    t = threading.Thread(target=_run_tunnel, args=(5050,), daemon=True)
    _tunnel_state["thread"] = t
    t.start()
    return {"ok": True}


@app.post("/api/tunnel/stop")
def stop_tunnel():
    proc = _tunnel_state.get("proc")
    if proc:
        try: proc.terminate()
        except Exception: pass
    _tunnel_state["url"]    = None
    _tunnel_state["status"] = "stopped"
    return {"ok": True}


@app.get("/api/tunnel/debug")
def tunnel_debug():
    import shutil
    ssh_path = shutil.which("ssh")
    return {
        "ssh_found":      bool(ssh_path),
        "ssh_path":       ssh_path or "לא נמצא",
        "tunnel_state":   _tunnel_state["status"],
        "tunnel_url":     _tunnel_state.get("url"),
        "tunnel_error":   _tunnel_state.get("error"),
        "last_line":      _tunnel_state.get("last_line", ""),
    }


# ─────────────────────────── REMOTE REGISTRATION ───────────────────────────

class RemoteRegSession(BaseModel):
    session_token: str
    employee_id: int
    employee_name: str
    shift_date: str
    from_time: str
    to_time: str

class RemoteRegSubmit(BaseModel):
    token: str
    start_time: str
    end_time: str

class RemoteRegUpdate(BaseModel):
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    reg_start: Optional[str] = None
    reg_end: Optional[str] = None
    status: Optional[str] = None
    shift_id: Optional[int] = None


@app.post("/api/remote-registrations/session")
def create_reg_session(s: RemoteRegSession):
    conn = get_db()
    c = conn.cursor()
    existing = c.execute(
        "SELECT id FROM remote_registrations WHERE employee_id=? AND shift_date=? AND status='pending'",
        (s.employee_id, s.shift_date)
    ).fetchone()
    if existing:
        c.execute(
            "UPDATE remote_registrations SET start_time=?, end_time=?, session_token=? WHERE id=?",
            (s.from_time, s.to_time, s.session_token, existing["id"])
        )
        reg_id = existing["id"]
    else:
        c.execute("""
            INSERT INTO remote_registrations
              (employee_id, employee_name, shift_date, start_time, end_time, status, session_token)
            VALUES (?,?,?,?,?,'pending',?)
        """, (s.employee_id, s.employee_name, s.shift_date,
              s.from_time, s.to_time, s.session_token))
        reg_id = c.lastrowid
    conn.commit()
    conn.close()
    return {"id": reg_id, "token": s.session_token}


@app.get("/api/remote-registrations")
def get_remote_registrations(week_start: Optional[str] = None, status: Optional[str] = None):
    conn = get_db()
    q = "SELECT * FROM remote_registrations WHERE 1=1"
    params = []
    if week_start:
        try:
            dt = datetime.strptime(week_start, "%Y-%m-%d").date()
            week_end = (dt + timedelta(days=6)).strftime("%Y-%m-%d")
            q += " AND shift_date BETWEEN ? AND ?"
            params += [week_start, week_end]
        except ValueError:
            pass
    if status:
        q += " AND status = ?"
        params.append(status)
    q += " ORDER BY shift_date, employee_name"
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/remote-registrations/form/{token}")
def get_reg_form(token: str):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM remote_registrations WHERE session_token=?", (token,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "טופס לא נמצא או פג תוקפו")
    return dict(row)


@app.post("/api/remote-registrations/submit")
def submit_registration(sub: RemoteRegSubmit):
    conn = get_db()
    c = conn.cursor()
    row = c.execute(
        "SELECT * FROM remote_registrations WHERE session_token=?", (sub.token,)
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "טופס לא נמצא")
    c.execute("""
        UPDATE remote_registrations
        SET reg_start=?, reg_end=?, status='submitted'
        WHERE session_token=?
    """, (sub.start_time, sub.end_time, sub.token))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.put("/api/remote-registrations/{reg_id}")
def update_remote_registration(reg_id: int, upd: RemoteRegUpdate):
    conn = get_db()
    c = conn.cursor()
    existing = c.execute("SELECT * FROM remote_registrations WHERE id=?", (reg_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "רישום לא נמצא")
    updates = {k: v for k, v in upd.dict().items() if v is not None}
    if updates:
        set_clause = ", ".join(f"{k}=?" for k in updates)
        c.execute(f"UPDATE remote_registrations SET {set_clause} WHERE id=?",
                  list(updates.values()) + [reg_id])
        conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/remote-registrations/{reg_id}")
def delete_remote_registration(reg_id: int):
    conn = get_db()
    conn.execute("DELETE FROM remote_registrations WHERE id = ?", (reg_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/register", response_class=HTMLResponse)
def register_page():
    return FileResponse(os.path.join(STATIC_DIR, "register.html"))


# ─────────────────────────── GOOGLE SHEET POLLING ───────────────────────────

import csv, io, urllib.request as _urllib

class SheetConfigUpdate(BaseModel):
    sheet_url: str   # full Google Sheets URL

@app.post("/api/sheet-config")
def save_sheet_config(cfg: SheetConfigUpdate):
    """Save the Google Sheet URL to DB settings."""
    conn = get_db()
    conn.execute("""
        INSERT OR REPLACE INTO settings (key, value) VALUES ('gsheet_url', ?)
    """, (cfg.sheet_url,))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.get("/api/sheet-config")
def get_sheet_config():
    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key='gsheet_url'").fetchone()
    conn.close()
    return {"sheet_url": row["value"] if row else ""}

def _sheet_url_to_csv(url: str) -> str:
    """Convert any Google Sheets URL to CSV export URL."""
    import re
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url)
    if not m:
        raise ValueError("URL לא תקין")
    sheet_id = m.group(1)
    # Extract gid if present
    gid_match = re.search(r"gid=(\d+)", url)
    gid = gid_match.group(1) if gid_match else "0"
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"

@app.get("/api/sheet-poll")
def poll_sheet():
    """Poll Google Sheet for new registrations."""
    import csv, io, urllib.request as _ur, re as _re

    conn = get_db()
    conn.execute("PRAGMA foreign_keys = OFF")
    row = conn.execute("SELECT value FROM settings WHERE key='gsheet_url'").fetchone()
    if not row or not row["value"]:
        conn.close()
        raise HTTPException(400, "לא הוגדר Google Sheet")

    # Build CSV export URL
    url = row["value"]
    m = _re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url)
    if not m:
        conn.close()
        raise HTTPException(400, "URL לא תקין")
    sheet_id = m.group(1)
    gid_m = _re.search(r"gid=(\d+)", url)
    gid = gid_m.group(1) if gid_m else "0"
    csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"

    # Fetch CSV
    try:
        req = _ur.Request(csv_url, headers={"User-Agent": "Mozilla/5.0"})
        with _ur.urlopen(req, timeout=10) as resp:
            content = resp.read().decode("utf-8")
    except Exception as e:
        conn.close()
        raise HTTPException(500, f"שגיאה בקריאת Sheet: {e}")

    reader = csv.DictReader(io.StringIO(content))
    rows = list(reader)
    if not rows:
        conn.close()
        return {"count": 0, "total": 0, "registrations": []}

    headers = list(rows[0].keys())

    def find_col(keywords):
        for h in headers:
            for kw in keywords:
                if kw.strip().lower() in h.strip().lower():
                    return h
        return None

    col_fname = find_col(["שם פרטי", "שם מפעיל", "first name", "שם"])
    col_lname = find_col(["שם משפחה", "last name", "משפחה"])
    col_date  = find_col(["תאריך", "date", "יום"])
    col_start = find_col(["פתיחת חלון", "תחילת חלון", "שעת תחילה", "התחלה", "start"])
    col_end   = find_col(["סיום חלון", "שעת סיום", "סיום", "end"])

    if not col_fname:
        conn.close()
        raise HTTPException(400, f"לא נמצאה עמודת שם. עמודות: {headers}")

    def norm_date(d):
        dm = _re.match(r"(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{2,4})", d)
        if dm:
            day, mo, y = dm.groups()
            if len(y) == 2: y = "20" + y
            return f"{y}-{mo.zfill(2)}-{day.zfill(2)}"
        return d

    def norm_time(t):
        tm = _re.match(r"(\d{1,2}):(\d{2})", t)
        return f"{int(tm.group(1)):02d}:{tm.group(2)}" if tm else t

    new_count = 0
    results   = []
    c = conn.cursor()

    for r in rows:
        fname = r.get(col_fname, "").strip()
        lname = r.get(col_lname, "").strip() if col_lname else ""
        name  = f"{fname} {lname}".strip() if lname else fname
        date_raw   = r.get(col_date,  "").strip() if col_date  else ""
        start_time = r.get(col_start, "").strip() if col_start else ""
        end_time   = r.get(col_end,   "").strip() if col_end   else ""

        if not fname or not start_time:
            continue

        shift_date = norm_date(date_raw)
        start_time = norm_time(start_time)
        end_time   = norm_time(end_time) if end_time else start_time

        # Find employee
        emp = c.execute(
            "SELECT id FROM employees WHERE name=? AND is_active=1", (name,)
        ).fetchone()
        if not emp and fname:
            emp = c.execute(
                "SELECT id FROM employees WHERE name LIKE ? AND is_active=1",
                (f"{fname}%",)
            ).fetchone()
        if not emp:
            emp = c.execute(
                "SELECT id FROM employees WHERE name LIKE ? AND is_active=1",
                (f"%{fname}%",)
            ).fetchone()
        emp_id = emp["id"] if emp else None

        # Upsert logic
        existing = c.execute("""
            SELECT id, status, reg_start, reg_end FROM remote_registrations
            WHERE employee_name=? AND shift_date=?
            ORDER BY id DESC LIMIT 1
        """, (name, shift_date)).fetchone()

        if not existing:
            c.execute("""
                INSERT INTO remote_registrations
                  (employee_id, employee_name, shift_date, start_time, end_time,
                   reg_start, reg_end, status)
                VALUES (?,?,?,?,?,?,?,'submitted')
            """, (emp_id, name, shift_date,
                  start_time, end_time, start_time, end_time))
            new_count += 1
        else:
            ex_status = existing["status"]
            hours_changed = (existing["reg_start"] != start_time or
                           existing["reg_end"] != end_time)
            if ex_status == "confirmed":
                if hours_changed:
                    c.execute("""
                        UPDATE remote_registrations
                        SET reg_start=?, reg_end=?, status='resubmitted'
                        WHERE id=?
                    """, (start_time, end_time, existing["id"]))
                    new_count += 1
            elif hours_changed:
                c.execute("""
                    UPDATE remote_registrations
                    SET reg_start=?, reg_end=?, status='submitted'
                    WHERE id=?
                """, (start_time, end_time, existing["id"]))
                new_count += 1

        results.append({
            "name": name, "date": shift_date,
            "start": start_time, "end": end_time,
            "found_employee": bool(emp_id)
        })

    conn.commit()
    conn.close()
    return {"count": new_count, "total": len(results), "registrations": results}


# ─────────────────────────── ENTRY POINT ───────────────────────────

if __name__ == "__main__":
    freeze_support()
    import uvicorn
    port = 5050
    print(f"\n  מערכת לוז - בית ספר לטיסה")
    print(f"   http://localhost:{port}\n")
    webbrowser.open(f"http://localhost:{port}")
    if getattr(sys, "frozen", False):
        uvicorn.run(app, host="0.0.0.0", port=port, reload=False, workers=1)
    else:
        uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
