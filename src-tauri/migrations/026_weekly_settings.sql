-- Per-Sunday-week UI settings (e.g. required "days in school" for staffing checks).
CREATE TABLE IF NOT EXISTS weekly_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start TEXT NOT NULL UNIQUE,
    days_in_school INTEGER NOT NULL,
    CHECK (days_in_school BETWEEN 0 AND 7)
);

CREATE INDEX IF NOT EXISTS idx_weekly_settings_week_start ON weekly_settings (week_start);
