-- Instructor availability (whole day or time window per calendar day).
CREATE TABLE IF NOT EXISTS availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    avail_date TEXT NOT NULL,
    start_time TEXT NULL,
    end_time TEXT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    CHECK (
        (start_time IS NULL AND end_time IS NULL)
        OR (start_time IS NOT NULL AND end_time IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_availability_date ON availability (avail_date);
CREATE INDEX IF NOT EXISTS idx_availability_emp_date ON availability (employee_id, avail_date);
