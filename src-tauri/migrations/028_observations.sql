-- Schedule matrix: at most one observation per shift; cascade when shift is deleted
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL UNIQUE REFERENCES shifts(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_observations_employee_id ON observations(employee_id);
CREATE INDEX IF NOT EXISTS idx_observations_shift_id ON observations(shift_id);
