-- Singular app-wide scheduling rule parameters (persistence only; no engine wiring yet).
CREATE TABLE IF NOT EXISTS global_rules (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    rest_between_shifts INTEGER NOT NULL DEFAULT 0,
    max_workday INTEGER NOT NULL DEFAULT 720,
    early_time TEXT NOT NULL DEFAULT '06:00',
    late_time TEXT NOT NULL DEFAULT '22:00',
    max_late_days INTEGER NOT NULL DEFAULT 0,
    max_early_days INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO global_rules (
    id,
    rest_between_shifts,
    max_workday,
    early_time,
    late_time,
    max_late_days,
    max_early_days
) VALUES (1, 0, 720, '06:00', '22:00', 0, 0);
