use crate::db::AppState;
use crate::domain::syllabus::{cascade_preset_delete_or_duration_change, default_syllabus_preset_id};
use crate::error::AppError;
use crate::json_util::sqlite_row_to_object;
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct SyllabusPresetCreate {
    pub name: String,
    pub min_role_id: Option<i64>,
    pub duration_minutes: i64,
    pub prep_minutes: i64,
    pub recovery_minutes: i64,
    #[serde(default = "default_max_in_row")]
    pub max_in_row: i64,
    #[serde(default)]
    pub joint_prep: bool,
    #[serde(default)]
    pub joint_recovery: bool,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct SyllabusPresetUpdate {
    pub name: Option<String>,
    pub min_role_id: Option<Value>,
    pub duration_minutes: Option<i64>,
    pub prep_minutes: Option<i64>,
    pub recovery_minutes: Option<i64>,
    pub max_in_row: Option<i64>,
    pub joint_prep: Option<bool>,
    pub joint_recovery: Option<bool>,
    pub notes: Option<String>,
}

fn default_max_in_row() -> i64 {
    1
}

fn normalize_preset_name(s: &str) -> String {
    s.trim().to_string()
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
                "SELECT sp.*, r.name AS min_role_name
                 FROM syllabus_presets sp
                 LEFT JOIN roles r ON sp.min_role_id = r.id
                 ORDER BY sp.system_locked DESC, sp.id",
            )?;
            let rows = stmt.query_map([], |row| sqlite_row_to_object(row))?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::from)?);
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())
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
    state
        .with_db(|conn| {
            if syllabus_name_in_use(conn, &name, None)? {
                return Err(AppError::msg("שם הסילבוס כבר קיים"));
            }
            conn.execute(
                "INSERT INTO syllabus_presets
                 (name, min_role_id, duration_minutes, prep_minutes, recovery_minutes,
                  max_in_row, joint_prep, joint_recovery, notes, system_locked)
                 VALUES (?,?,?,?,?,?,?,?,?,0)",
                params![
                    name,
                    payload.min_role_id,
                    payload.duration_minutes,
                    payload.prep_minutes,
                    payload.recovery_minutes,
                    payload.max_in_row,
                    payload.joint_prep as i32,
                    payload.joint_recovery as i32,
                    payload.notes,
                ],
            )
            .map_err(map_sqlite_unique_name)?;
            let id = conn.last_insert_rowid();
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
            if let Some(v) = &payload.min_role_id {
                match v {
                    Value::Null => {
                        tx.execute(
                            "UPDATE syllabus_presets SET min_role_id = NULL WHERE id = ?",
                            [preset_id],
                        )?;
                    }
                    Value::Number(num) => {
                        let rid = num.as_i64().ok_or_else(|| AppError::msg("min_role_id לא תקין"))?;
                        tx.execute(
                            "UPDATE syllabus_presets SET min_role_id = ?1 WHERE id = ?2",
                            params![rid, preset_id],
                        )?;
                    }
                    _ => return Err(AppError::msg("min_role_id לא תקין")),
                }
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
            if let Some(r) = payload.recovery_minutes {
                tx.execute(
                    "UPDATE syllabus_presets SET recovery_minutes = ?1 WHERE id = ?2",
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
            if let Some(j) = payload.joint_recovery {
                tx.execute(
                    "UPDATE syllabus_presets SET joint_recovery = ?1 WHERE id = ?2",
                    params![j as i32, preset_id],
                )?;
            }
            if let Some(n) = &payload.notes {
                tx.execute(
                    "UPDATE syllabus_presets SET notes = ?1 WHERE id = ?2",
                    params![n, preset_id],
                )?;
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
