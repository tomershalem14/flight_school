-- Shift types: dated coverage window; drop UNIQUE on name (identity is id).
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE shift_types_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    prep_minutes INTEGER NOT NULL,
    recovery_minutes INTEGER NOT NULL,
    color TEXT DEFAULT '#6366F1',
    min_role_id INTEGER,
    allow_fly INTEGER DEFAULT 1,
    max_concurrent_management INTEGER DEFAULT 0,
    notes TEXT,
    coverage_start TEXT NOT NULL,
    coverage_end TEXT NOT NULL,
    FOREIGN KEY (min_role_id) REFERENCES roles(id)
);

INSERT INTO shift_types_new (
    id, name, duration_minutes, prep_minutes, recovery_minutes, color,
    min_role_id, allow_fly, max_concurrent_management, notes,
    coverage_start, coverage_end
)
SELECT
    id, name, duration_minutes, prep_minutes, recovery_minutes, color,
    min_role_id, allow_fly, max_concurrent_management, notes,
    '2000-01-01T06:00:00',
    '2099-12-31T21:00:00'
FROM shift_types;

DROP TABLE shift_types;
ALTER TABLE shift_types_new RENAME TO shift_types;

COMMIT;

PRAGMA foreign_keys = ON;
