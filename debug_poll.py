"""
בדיקה ישירה של לוגיקת poll_sheet
"""
import sys
sys.path.insert(0, '.')

from models import get_db
import csv, io, urllib.request, re

conn = get_db()

# Get URL
row = conn.execute("SELECT value FROM settings WHERE key='gsheet_url'").fetchone()
url = row["value"]
print("URL:", url)

# Build CSV URL
m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url)
sheet_id = m.group(1)
gid_m = re.search(r"gid=(\d+)", url)
gid = gid_m.group(1) if gid_m else "0"
csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
print("CSV URL:", csv_url)

# Fetch
req = urllib.request.Request(csv_url, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=10) as resp:
    content = resp.read().decode("utf-8")
print("Content:", content[:200])

reader = csv.DictReader(io.StringIO(content))
rows = list(reader)
print("Rows:", len(rows))
print("Headers:", list(rows[0].keys()))

# Process first row
r = rows[0]
headers = list(r.keys())

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

print("\nCol fname:", col_fname)
print("Col lname:", col_lname)
print("Col date:", col_date)
print("Col start:", col_start)
print("Col end:", col_end)

fname = r.get(col_fname, "").strip()
lname = r.get(col_lname, "").strip() if col_lname else ""
name  = f"{fname} {lname}".strip() if lname else fname
date_raw   = r.get(col_date,  "").strip() if col_date  else ""
start_time = r.get(col_start, "").strip() if col_start else ""
end_time   = r.get(col_end,   "").strip() if col_end   else ""

print("\nName:", name)
print("Date:", date_raw)
print("Start:", start_time)
print("End:", end_time)

def norm_date(d):
    dm = re.match(r"(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{2,4})", d)
    if dm:
        day, mo, y = dm.groups()
        if len(y) == 2: y = "20" + y
        return f"{y}-{mo.zfill(2)}-{day.zfill(2)}"
    return d

def norm_time(t):
    tm = re.match(r"(\d{1,2}):(\d{2})", t)
    return f"{int(tm.group(1)):02d}:{tm.group(2)}" if tm else t

shift_date = norm_date(date_raw)
start_time = norm_time(start_time)
end_time   = norm_time(end_time) if end_time else start_time

print("Normalized date:", shift_date)
print("Normalized start:", start_time)
print("Normalized end:", end_time)

# Try DB insert
c = conn.cursor()
print("\nTrying DB insert...")
try:
    c.execute("""
        INSERT INTO remote_registrations
          (employee_id, employee_name, shift_date, start_time, end_time,
           reg_start, reg_end, status)
        VALUES (?,?,?,?,?,?,?,'submitted')
    """, (None, name, shift_date, start_time, end_time, start_time, end_time))
    conn.commit()
    print("INSERT OK! id:", c.lastrowid)
    # Clean up test row
    c.execute("DELETE FROM remote_registrations WHERE id=?", (c.lastrowid,))
    conn.commit()
    print("Cleanup OK")
except Exception as e:
    print("INSERT ERROR:", type(e).__name__, e)

conn.close()
print("\nDone!")
