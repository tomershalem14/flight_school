use crate::db::AppState;
use crate::domain::rules::check_shift_violations;
use crate::domain::shift_prep_rest_chain::{
    heal_slot_group_after_delete, recalc_chained_prep_rest_for_employee_day,
    recalc_largest_bunch_intersecting_slot_group, solve_create_shift_prep_rest,
};
use crate::domain::syllabus::{
    first_syllabus_role_id_for_preset, shift_row_from_syllabus_num,
    syllabus_role_matches_preset,
};
use crate::error::AppError;
use crate::json_util::sqlite_row_to_object;
use chrono::NaiveDate;
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct ShiftCreate {
    pub shift_date: String,
    pub shift_window_id: i64,
    pub syllabus_num: i64,
    pub employee_id: Option<i64>,
    #[serde(default)]
    pub syllabus_role_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ReassignShiftEmployee {
    pub shift_id: i64,
    pub employee_id: i64,
}

#[tauri::command]
pub fn get_shifts(state: State<'_, AppState>, week_start: String) -> Result<Vec<Value>, String> {
    let week_end = parse_week_end(&week_start).map_err(|e| e.to_string())?;
    state
        .with_db(|conn| {
            let sql = format!(
                "{JOINED_SHIFT_SELECT} WHERE s.shift_date BETWEEN ? AND ? ORDER BY s.shift_date, s.start_time"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![week_start, week_end], |row| {
                sqlite_row_to_object(row)
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::from)?);
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())
}

/// Inclusive end of the 7-day window: `week_start` + 6 days (expects Sunday `week_start` from the client).
pub(crate) fn parse_week_end(week_start: &str) -> Result<String, AppError> {
    let dt = NaiveDate::parse_from_str(week_start, "%Y-%m-%d")
        .map_err(|_| AppError::msg("פורמט תאריך שגוי - השתמש ב-YYYY-MM-DD"))?;
    Ok((dt + chrono::Duration::days(6))
        .format("%Y-%m-%d")
        .to_string())
}

fn schedule_err_creation(msg: impl std::fmt::Display) -> AppError {
    AppError::msg(format!("[phase:creation] {}", msg))
}

fn schedule_err_validation(msg: impl std::fmt::Display) -> AppError {
    AppError::msg(format!("[phase:validation] {}", msg))
}

/// Joined `get_shifts` row shape (single source for SELECT body).
const JOINED_SHIFT_SELECT: &str = r#"SELECT s.*, w.name as type_name, w.color as type_color,
                sp.duration_minutes, sp.prep_minutes, sp.rest_minutes,
                e.name as emp_name, r.name as role_name, r.color as role_color,
                srel.name as syllabus_role_name,
                srel.sort_order as syllabus_role_sort_order
         FROM shifts s
         JOIN shift_windows w ON s.shift_window_id = w.id
         JOIN syllabus_presets sp ON s.syllabus_preset_id = sp.id
         LEFT JOIN employees e ON s.employee_id = e.id
         LEFT JOIN roles r ON e.role_id = r.id
         LEFT JOIN syllabus_roles srel ON s.syllabus_role_id = srel.id"#;

fn ensure_employee_exists(conn: &rusqlite::Connection, employee_id: Option<i64>) -> Result<(), String> {
    let Some(eid) = employee_id else {
        return Ok(());
    };
    if eid <= 0 {
        return Err("מזהה מפעיל לא תקין".to_string());
    }
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM employees WHERE id = ?", [eid], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("מפעיל לא נמצא במסד הנתונים".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn create_shift(state: State<'_, AppState>, payload: ShiftCreate) -> Result<Value, String> {
    state
        .with_db_mut(|conn| {
            // One transaction so a failed recalc does not leave an orphan row
            // (autocommit INSERT + later Err used to commit the shift while the API returned error).
            let tx = conn.transaction().map_err(AppError::from)?;
            let solved = solve_create_shift_prep_rest(
                &*tx,
                &payload.shift_date,
                payload.shift_window_id,
                payload.syllabus_num,
                payload.employee_id,
            )
            .map_err(schedule_err_creation)?;
            ensure_employee_exists(&*tx, payload.employee_id).map_err(schedule_err_creation)?;

            let syllabus_role_id = match payload.syllabus_role_id {
                Some(id) => {
                    if !syllabus_role_matches_preset(&*tx, id, solved.syllabus_preset_id)
                        .map_err(schedule_err_creation)?
                    {
                        return Err(schedule_err_creation(
                            "תפקיד הסילבוס אינו שייך לסילבוס של הסלוט",
                        ));
                    }
                    id
                }
                None => first_syllabus_role_id_for_preset(&*tx, solved.syllabus_preset_id)
                    .map_err(schedule_err_creation)?,
            };

            if payload.employee_id.is_some() {
                let taken: i64 = tx
                    .query_row(
                        "SELECT COUNT(*) FROM shifts
                         WHERE shift_date = ?1 AND shift_window_id = ?2 AND syllabus_num = ?3
                           AND syllabus_role_id = ?4 AND employee_id IS NOT NULL",
                        params![
                            &payload.shift_date,
                            payload.shift_window_id,
                            payload.syllabus_num,
                            syllabus_role_id,
                        ],
                        |r| r.get(0),
                    )
                    .map_err(AppError::from)?;
                if taken > 0 {
                    return Err(schedule_err_creation(
                        "תפקיד זה במסגרת הסלוט כבר מאויש",
                    ));
                }
            }

            tx.execute(
                "INSERT INTO shifts (shift_date, shift_window_id, start_time, end_time, syllabus_preset_id, prep_start, rest_end, prep_end, rest_start, employee_id, up_to_date, syllabus_num, syllabus_role_id)
                 VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)",
                params![
                    payload.shift_date,
                    payload.shift_window_id,
                    solved.start_time,
                    solved.end_time,
                    solved.syllabus_preset_id,
                    solved.prep_start,
                    solved.rest_end,
                    solved.prep_end,
                    solved.rest_start,
                    payload.employee_id,
                    payload.syllabus_num,
                    syllabus_role_id,
                ],
            )?;
            let new_id = tx.last_insert_rowid();
            if payload.employee_id.is_some() {
                recalc_largest_bunch_intersecting_slot_group(
                    &*tx,
                    &payload.shift_date,
                    payload.shift_window_id,
                    payload.syllabus_num,
                )
                .map_err(schedule_err_validation)?;
            }
            let mut violations = Vec::new();
            if payload.employee_id.is_some() {
                for v in check_shift_violations(&*tx, new_id).map_err(schedule_err_validation)? {
                    violations.push(v.to_json());
                }
            }
            tx.commit().map_err(AppError::from)?;
            Ok(json!({ "id": new_id, "violations": violations }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reassign_shift_employee(
    state: State<'_, AppState>,
    payload: ReassignShiftEmployee,
) -> Result<Value, String> {
    state
        .with_db_mut(|conn| {
            let (shift_date, wid, syllabus_num, old_emp, old_syllabus_role_id): (
                String,
                i64,
                Option<i64>,
                Option<i64>,
                Option<i64>,
            ) = conn
                .query_row(
                    "SELECT shift_date, shift_window_id, syllabus_num, employee_id, syllabus_role_id FROM shifts WHERE id = ?",
                    [payload.shift_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .map_err(|_| schedule_err_creation("המשמרת לא נמצאה"))?;

            let Some(old) = old_emp else {
                return Err(schedule_err_creation("לא ניתן להעביר משמרת ללא מפעיל"));
            };
            let Some(sn) = syllabus_num else {
                return Err(schedule_err_creation(
                    "לא ניתן להעביר משמרת זו — חסר מספר סילבוס במסד (נסה ליצור משמרת חדשה)",
                ));
            };
            if old == payload.employee_id {
                return Err(schedule_err_creation("המפעיל כבר משויך למשמרת זו"));
            }

            ensure_employee_exists(conn, Some(payload.employee_id)).map_err(schedule_err_creation)?;

            let (_, _, pid_geom, _, _, _, _) =
                shift_row_from_syllabus_num(conn, wid, &shift_date, sn).map_err(schedule_err_creation)?;
            let syllabus_role_id = match old_syllabus_role_id {
                Some(id) => {
                    if !syllabus_role_matches_preset(conn, id, pid_geom).map_err(schedule_err_creation)? {
                        return Err(schedule_err_creation(
                            "תפקיד הסילבוס אינו תואם לסילבוס של הסלוט",
                        ));
                    }
                    id
                }
                None => first_syllabus_role_id_for_preset(conn, pid_geom).map_err(schedule_err_creation)?,
            };

            let dup: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM shifts WHERE shift_date = ?1 AND shift_window_id = ?2 AND syllabus_num = ?3 AND syllabus_role_id = ?4 AND employee_id = ?5 AND id != ?6",
                    params![
                        &shift_date,
                        wid,
                        sn,
                        syllabus_role_id,
                        payload.employee_id,
                        payload.shift_id
                    ],
                    |r| r.get(0),
                )
                .map_err(AppError::from)?;
            if dup > 0 {
                return Err(schedule_err_creation(
                    "למפעיל היעד כבר יש משמרת באותו חלון, מקום סילבוס ותפקיד סילבוס",
                ));
            }

            let tx = conn.transaction().map_err(AppError::from)?;
            tx.execute("DELETE FROM shifts WHERE id = ?", [payload.shift_id])?;
            let solved = solve_create_shift_prep_rest(
                &*tx,
                &shift_date,
                wid,
                sn,
                Some(payload.employee_id),
            )
            .map_err(schedule_err_creation)?;
            tx.execute(
                "INSERT INTO shifts (shift_date, shift_window_id, start_time, end_time, syllabus_preset_id, prep_start, rest_end, prep_end, rest_start, employee_id, up_to_date, syllabus_num, syllabus_role_id)
                 VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)",
                params![
                    shift_date,
                    wid,
                    solved.start_time,
                    solved.end_time,
                    solved.syllabus_preset_id,
                    solved.prep_start,
                    solved.rest_end,
                    solved.prep_end,
                    solved.rest_start,
                    payload.employee_id,
                    sn,
                    syllabus_role_id,
                ],
            )?;
            let new_id = tx.last_insert_rowid();

            recalc_chained_prep_rest_for_employee_day(&*tx, old, &shift_date)
                .map_err(schedule_err_validation)?;
            recalc_chained_prep_rest_for_employee_day(&*tx, payload.employee_id, &shift_date)
                .map_err(schedule_err_validation)?;
            recalc_largest_bunch_intersecting_slot_group(&*tx, &shift_date, wid, sn)
                .map_err(schedule_err_validation)?;

            let mut violations = Vec::new();
            for v in check_shift_violations(&*tx, new_id).map_err(schedule_err_validation)? {
                violations.push(v.to_json());
            }
            tx.commit().map_err(AppError::from)?;
            Ok(json!({ "id": new_id, "violations": violations }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_shift(state: State<'_, AppState>, shift_id: i64) -> Result<Value, String> {
    state
        .with_db_mut(|conn| {
            let before: Option<(String, i64, Option<i64>, Option<i64>)> = conn
                .query_row(
                    "SELECT shift_date, shift_window_id, syllabus_num, employee_id FROM shifts WHERE id = ?",
                    [shift_id],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, i64>(1)?,
                            r.get::<_, Option<i64>>(2)?,
                            r.get::<_, Option<i64>>(3)?,
                        ))
                    },
                )
                .optional()
                .map_err(AppError::from)?;
            let tx = conn.transaction().map_err(AppError::from)?;
            tx.execute("DELETE FROM shifts WHERE id = ?", [shift_id])
                .map_err(AppError::from)?;
            if let Some((date, eid)) = before
                .as_ref()
                .and_then(|(d, _, _, e)| e.map(|id| (d.clone(), id)))
            {
                recalc_chained_prep_rest_for_employee_day(&*tx, eid, &date)
                    .map_err(schedule_err_validation)?;
            }
            if let Some((ref date, wid, Some(sn), _)) = before {
                heal_slot_group_after_delete(&*tx, date, wid, sn).map_err(schedule_err_validation)?;
            }
            tx.commit().map_err(AppError::from)?;
            Ok(json!({ "ok": true }))
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_shift_violations(state: State<'_, AppState>, shift_id: i64) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            let mut out = Vec::new();
            for v in check_shift_violations(conn, shift_id).map_err(AppError::from)? {
                out.push(v.to_json());
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_day_violations(state: State<'_, AppState>, date: String) -> Result<Vec<Value>, String> {
    state
        .with_db(|conn| {
            crate::domain::rules::check_all_violations_for_date(conn, &date)
                .map_err(AppError::from)
        })
        .map_err(|e| e.to_string())
}
