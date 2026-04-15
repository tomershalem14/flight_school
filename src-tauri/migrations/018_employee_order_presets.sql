-- Custom matrix employee order presets (regular instructors only in items).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS employee_order_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS employee_order_preset_items (
    preset_id INTEGER NOT NULL REFERENCES employee_order_presets(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    sort_index INTEGER NOT NULL,
    PRIMARY KEY (preset_id, employee_id),
    UNIQUE (preset_id, sort_index)
);
