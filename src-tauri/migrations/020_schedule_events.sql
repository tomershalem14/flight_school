-- Legacy constraints UI was unused; schedule matrix "events" replace that concept.
DROP TABLE IF EXISTS constraints;

CREATE TABLE IF NOT EXISTS schedule_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_date TEXT NOT NULL,
    employee_id INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    event_kind TEXT NOT NULL CHECK (event_kind IN ('constraint', 'event', 'operational')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    CHECK (trim(name) != '')
);

CREATE INDEX IF NOT EXISTS idx_schedule_events_shift_date
    ON schedule_events (shift_date);

CREATE INDEX IF NOT EXISTS idx_schedule_events_emp_date
    ON schedule_events (employee_id, shift_date);
