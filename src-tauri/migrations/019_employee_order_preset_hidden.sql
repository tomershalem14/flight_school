-- Per-item visibility when a preset is active (0 = shown in matrix/board, 1 = hidden).
PRAGMA foreign_keys = ON;

ALTER TABLE employee_order_preset_items ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
