use crate::db::AppState;
use crate::domain::syllabus::{cascade_preset_delete_or_duration_change, default_syllabus_preset_id};
use crate::error::AppError;
use crate::json_util::sqlite_row_to_object;
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::State;

#[derive(Debug, Deserialize, Default)]
pub struct SyllabusRoleInput {
    #[serde(default)]
    pub name: String,
    pub role_id: Option<i64>,
    #[serde(default)]
    pub special: String,
}

#[derive(Debug, Deserialize)]
pub struct SyllabusPresetCreate {
    pub name: String,
    pub duration_minutes: i64,
    pub prep_minutes: i64,
    pub rest_minutes: i64,
    #[serde(default = "default_max_in_row")]
    pub max_in_row: i64,
    #[serde(default)]
    pub joint_prep: bool,
    #[serde(default)]
    pub joint_rest: bool,
    pub notes: Option<String>,
    #[serde(default)]
    pub syllabus_roles: Vec<SyllabusRoleInput>,
}

#[derive(Debug, Deserialize, Default)]
pub struct SyllabusPresetUpdate {
    pub name: Option<String>,
    pub duration_minutes: Option<i64>,
    pub prep_minutes: Option<i64>,
    pub rest_minutes: Option<i64>,
    pub max_in_row: Option<i64>,
    pub joint_prep: Option<bool>,
    pub joint_rest: Option<bool>,
    pub notes: Option<String>,
    pub syllabus_roles: Option<Vec<SyllabusRoleInput>>,
}

fn default_max_in_row() -> i64 {
    1
}

/// Empty `syllabus_roles.name` is stored as this label.
const DEFAULT_SYLLABUS_ROLE_NAME: &str = "מדריך";

fn normalize_preset_name(s: &str) -> String {
    s.trim().to_string()
}

fn normalize_syllabus_roles(mut rows: Vec<SyllabusRoleInput>) -> Vec<SyllabusRoleInput> {
    if rows.is_empty() {
        rows.push(SyllabusRoleInput::default());
    }
    rows
}

fn insert_syllabus_roles_for_preset(
    tx: &rusqlite::Transaction<'_>,
    preset_id: i64,
    rows: &[SyllabusRoleInput],
) -> rusqlite::Result<()> {
    for (order, row) in rows.iter().enumerate() {
        let name = {
            let n = normalize_preset_name(&row.name);
            if n.is_empty() {
                DEFAULT_SYLLABUS_ROLE_NAME.to_string()
            } else {
                n
            }
        };
        let special = row.special.trim().to_string();
        tx.execute(
            "INSERT INTO syllabus_roles (name, role_id, special, syllabus_preset_id, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                name,
                row.role_id,
                special,
                preset_id,
                order as i64
            ],
        )?;
    }
    Ok(())
}

fn syllabus_name_in_use(
    conn: &rusqlite::Connection,
    name: &str,
    exclude_id: Option<i64>,
) -> rusqlite::Result<bool> {
    let n: i64 = match exclude_id {
        Some(id) => conn.query_row(
            "SELECT COUNT(*) FROM syllabus_presets WHERE name = ?1 COLLATE NOCASE AND id != ?2",
            params![name, id],
            |r| r.get(0),
        )?,
        None => conn.query_row(
            "SELECT COUNT(*) FROM syllabus_presets WHERE name = ?1 COLLATE NOCASE",
            [name],
            |r| r.get(0),
        )?,
    };
    Ok(n > 0)
}

fn map_sqlite_unique_name(err: rusqlite::Error) -> AppError {
    let s = err.to_string();
    if s.contains("UNIQUE")
        && (s.contains("syllabus_presets") || s.contains("idx_syllabus_presets_name"))
    {
        AppError::msg("שם הסילבוס כבר קיים")
    } else {
        AppError::Sqlite(err)
    }
}

#[tauri::command]
pub fn get_syllabus_presets(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM syllabus_presets ORDER BY system_locked DESC, id",
            )?;
            let rows = stmt.query_map([], |row| sqlite_row_to_object(row))?;
            let mut out: Vec<Value> = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::from)?);
            }
            drop(stmt);

            let mut by_pid: HashMap<i64, Vec<Value>> = HashMap::new();
            if table_exists(conn, "syllabus_roles")? {
                let mut sr = conn.prepare(
                    "SELECT sr.id, sr.name, sr.role_id, sr.special, sr.syllabus_preset_id, sr.sort_order,
                            r.name AS role_name
                     FROM syllabus_roles sr
                     LEFT JOIN roles r ON sr.role_id = r.id
                     ORDER BY sr.syllabus_preset_id, sr.sort_order, sr.id",
                )?;
                for row in sr.query_map([], |row| sqlite_row_to_object(row))? {
                    let obj = row.map_err(AppError::from)?;
                    let pid = obj
                        .get("syllabus_preset_id")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    by_pid.entry(pid).or_default().push(obj);
                }
            }

            for v in &mut out {
                if let Some(m) = v.as_object_mut() {
                    if let Some(id) = m.get("id").and_then(|x| x.as_i64()) {
                        let arr = by_pid.remove(&id).unwrap_or_default();
                        m.insert("syllabus_roles".into(), Value::Array(arr));
                    }
                }
            }

            Ok(out)
        })
        .map_err(|e| e.to_string())
}

fn table_exists(conn: &rusqlite::Connection, name: &str) -> rusqlite::Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [name],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

#[tauri::command]
pub fn create_syllabus_preset(
    state: State<'_, AppState>,
    payload: SyllabusPresetCreate,
) -> Result<Value, String> {
    if payload.max_in_row < 1 {
        return Err("max_in_row חייב להיות לפחות 1".to_string());
    }
    let name = normalize_preset_name(&payload.name);
    if name.is_empty() {
        return Err("נא להזין שם".to_string());
    }
    let roles = normalize_syllabus_roles(payload.syllabus_roles);
    state
        .with_db_mut(|conn| {
            if syllabus_name_in_use(conn, &name, None)? {
                return Err(AppError::msg("שם הסילבוס כבר קיים"));
            }
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO syllabus_presets
                 (name, duration_minutes, prep_minutes, rest_minutes,
                  max_in_row, joint_prep, joint_rest, notes, system_locked)
                 VALUES (?,?,?,?,?,?,?,?,0)",
                params![
                    name,
                    payload.duration_minutes,
                    payload.prep_minutes,
                    payload.rest_minutes,
                    payload.max_in_row,
                    payload.joint_prep as i32,
                    payload.joint_rest as i32,
                    payload.notes,
                ],
            )
            .map_err(map_sqlite_unique_name)?;
            let id = tx.last_insert_rowid();
            insert_syllabus_roles_for_preset(&tx, id, &roles).map_err(AppError::from)?;
            tx.commit()?;
            Ok(json!({ "id": id }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_syllabus_preset(
    state: State<'_, AppState>,
    preset_id: i64,
    payload: SyllabusPresetUpdate,
) -> Result<Value, String> {
    state
        .with_db_mut(|conn| {
            let locked: i32 = conn.query_row(
                "SELECT system_locked FROM syllabus_presets WHERE id = ?",
                [preset_id],
                |r| r.get(0),
            )
            .map_err(|_| AppError::msg("סילבוס לא נמצא"))?;
            if locked != 0 {
                return Err(AppError::msg("לא ניתן לערוך את סילבוס ברירת המחדל"));
            }

            let old_dur: i32 = conn.query_row(
                "SELECT duration_minutes FROM syllabus_presets WHERE id = ?",
                [preset_id],
                |r| r.get(0),
            )
            .map_err(|_| AppError::msg("סילבוס לא נמצא"))?;

            if let Some(m) = payload.max_in_row {
                if m < 1 {
                    return Err(AppError::msg("max_in_row חייב להיות לפחות 1"));
                }
            }

            let tx = conn.transaction()?;

            if let Some(n) = &payload.name {
                let nn = normalize_preset_name(n);
                if nn.is_empty() {
                    return Err(AppError::msg("נא להזין שם"));
                }
                if syllabus_name_in_use(&tx, &nn, Some(preset_id))? {
                    return Err(AppError::msg("שם הסילבוס כבר קיים"));
                }
                tx.execute(
                    "UPDATE syllabus_presets SET name = ?1 WHERE id = ?2",
                    params![nn, preset_id],
                )?;
            }
            if let Some(d) = payload.duration_minutes {
                tx.execute(
                    "UPDATE syllabus_presets SET duration_minutes = ?1 WHERE id = ?2",
                    params![d, preset_id],
                )?;
            }
            if let Some(p) = payload.prep_minutes {
                tx.execute(
                    "UPDATE syllabus_presets SET prep_minutes = ?1 WHERE id = ?2",
                    params![p, preset_id],
                )?;
            }
            if let Some(r) = payload.rest_minutes {
                tx.execute(
                    "UPDATE syllabus_presets SET rest_minutes = ?1 WHERE id = ?2",
                    params![r, preset_id],
                )?;
            }
            if let Some(m) = payload.max_in_row {
                tx.execute(
                    "UPDATE syllabus_presets SET max_in_row = ?1 WHERE id = ?2",
                    params![m, preset_id],
                )?;
            }
            if let Some(j) = payload.joint_prep {
                tx.execute(
                    "UPDATE syllabus_presets SET joint_prep = ?1 WHERE id = ?2",
                    params![j as i32, preset_id],
                )?;
            }
            if let Some(j) = payload.joint_rest {
                tx.execute(
                    "UPDATE syllabus_presets SET joint_rest = ?1 WHERE id = ?2",
                    params![j as i32, preset_id],
                )?;
            }
            if let Some(n) = &payload.notes {
                tx.execute(
                    "UPDATE syllabus_presets SET notes = ?1 WHERE id = ?2",
                    params![n, preset_id],
                )?;
            }

            if let Some(role_rows) = payload.syllabus_roles {
                let roles = normalize_syllabus_roles(role_rows);
                tx.execute(
                    "DELETE FROM syllabus_roles WHERE syllabus_preset_id = ?1",
                    [preset_id],
                )?;
                insert_syllabus_roles_for_preset(&tx, preset_id, &roles).map_err(AppError::from)?;
            }

            let new_dur: i32 = tx.query_row(
                "SELECT duration_minutes FROM syllabus_presets WHERE id = ?",
                [preset_id],
                |r| r.get(0),
            )?;

            if new_dur != old_dur {
                cascade_preset_delete_or_duration_change(&tx, preset_id)
                    .map_err(|e| AppError::msg(e))?;
            }

            tx.commit()?;
            Ok(json!({ "ok": true, "id": preset_id }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_syllabus_preset(state: State<'_, AppState>, preset_id: i64) -> Result<Value, String> {
    state
        .with_db_mut(|conn| {
            let locked: i32 = conn.query_row(
                "SELECT system_locked FROM syllabus_presets WHERE id = ?",
                [preset_id],
                |r| r.get(0),
            )
            .map_err(|_| AppError::msg("סילבוס לא נמצא"))?;
            if locked != 0 {
                return Err(AppError::msg("לא ניתן למחוק את סילבוס ברירת המחדל"));
            }

            let tx = conn.transaction()?;
            cascade_preset_delete_or_duration_change(&tx, preset_id)
                .map_err(|e| AppError::msg(e))?;

            let def_id = default_syllabus_preset_id(&*tx).map_err(|e| AppError::msg(e.to_string()))?;
            tx.execute(
                "UPDATE shifts SET syllabus_preset_id = ?1 WHERE syllabus_preset_id = ?2",
                params![def_id, preset_id],
            )
            .map_err(AppError::from)?;

            let n = tx.execute(
                "DELETE FROM syllabus_presets WHERE id = ? AND system_locked = 0",
                [preset_id],
            )?;
            if n == 0 {
                return Err(AppError::msg("סילבוס לא נמצא"));
            }
            tx.commit()?;
            Ok(json!({ "ok": true }))
        })
        .map_err(|e| e.to_string())
}
