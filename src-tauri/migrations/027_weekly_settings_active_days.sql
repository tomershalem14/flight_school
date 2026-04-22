-- Which weekdays (Sun=0 .. Sat=6) show columns in the weekly availability grid.
ALTER TABLE weekly_settings ADD COLUMN active_days_mask INTEGER NOT NULL DEFAULT 31 CHECK (active_days_mask BETWEEN 1 AND 127);
