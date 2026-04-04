-- Remove shift metadata columns; assignments are the source of truth.
PRAGMA foreign_keys = ON;

ALTER TABLE shifts DROP COLUMN notes;
ALTER TABLE shifts DROP COLUMN manually_set;
ALTER TABLE shifts DROP COLUMN status;
