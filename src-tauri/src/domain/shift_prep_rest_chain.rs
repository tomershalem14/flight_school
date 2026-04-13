//! Chained `prep_start` / `rest_end` for one employee on one calendar day.

use crate::domain::rules::time_to_minutes;
use crate::domain::syllabus::{
    compute_prep_end_rest_start, load_presets_prep_rest_meta, load_preset_prep_rest_meta,
    minutes_to_hhmm, shift_bounds_from_syllabus_num, shift_row_from_syllabus_num,
    PresetPrepRestMeta,
};
use rusqlite::{params, Connection};
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct ChainShiftRow {
    pub id: i64,
    pub shift_window_id: i64,
    pub start_time: String,
    pub end_time: String,
    pub syllabus_preset_id: i64,
}

/// One ordered `(syllabus_preset_id, offset_minutes)` per shift in a bunch; `rest_end` uses
/// last shift `end_time` + offset (Formula A).
fn push_joint_order_rest(
    joint_order: &mut Vec<(i64, i32)>,
    latest_rest: &mut i32,
    syllabus_preset_id: i64,
    rest_minutes: i32,
    joint_rest: bool,
) {
    if !joint_rest {
        let v = *latest_rest + rest_minutes;
        joint_order.push((syllabus_preset_id, v));
        *latest_rest += rest_minutes;
        return;
    }

    let key_in_list = joint_order.iter().any(|(k, _)| *k == syllabus_preset_id);
    if !key_in_list {
        let v = *latest_rest + rest_minutes;
        joint_order.push((syllabus_preset_id, v));
        *latest_rest += rest_minutes;
        return;
    }

    let last_idx = joint_order
        .iter()
        .rposition(|(k, _)| *k == syllabus_preset_id)
        .expect("key_in_list implies last_idx");
    for j in (last_idx + 1)..joint_order.len() {
        joint_order[j].1 -= rest_minutes;
    }
    for p in joint_order.iter_mut() {
        if p.0 == syllabus_preset_id {
            p.1 = *latest_rest;
        }
    }
    joint_order.push((syllabus_preset_id, *latest_rest));
}

fn finalize_bunch_rest_ends(
    shifts: &[ChainShiftRow],
    joint_order: &[(i64, i32)],
    bunch_start: usize,
    bunch_end: usize,
    rest_ends: &mut [String],
) {
    let n = bunch_end - bunch_start;
    debug_assert_eq!(joint_order.len(), n);
    if n == 0 {
        return;
    }
    let final_end_min = time_to_minutes(&shifts[bunch_end - 1].end_time);
    for (j, idx) in (bunch_start..bunch_end).enumerate() {
        rest_ends[idx] = minutes_to_hhmm(final_end_min + joint_order[j].1);
    }
}

/// Ordered shifts + preset meta → (prep_start, rest_end) per row (same order as input).
pub fn compute_chained_prep_rest(
    shifts: &[ChainShiftRow],
    meta: &HashMap<i64, PresetPrepRestMeta>,
) -> Result<Vec<(String, String)>, String> {
    let n = shifts.len();
    if n == 0 {
        return Ok(vec![]);
    }

    let default_meta = PresetPrepRestMeta {
        prep_minutes: 0,
        rest_minutes: 0,
        joint_prep: false,
        joint_rest: false,
    };

    let mut prep_starts: Vec<String> = Vec::with_capacity(n);
    let mut joint_prep_map: HashMap<i64, String> = HashMap::new();
    let mut earliest_prep_raw: i32 = 0;

    let mut rest_ends: Vec<String> = vec![String::new(); n];
    let mut bunch_start: usize = 0;
    let mut joint_order: Vec<(i64, i32)> = Vec::new();
    let mut latest_rest: i32 = 0;

    for i in 0..n {
        let s = &shifts[i];
        let m = meta
            .get(&s.syllabus_preset_id)
            .copied()
            .unwrap_or(default_meta);
        let follows_prev = i > 0
            && shifts[i - 1].end_time == s.start_time
            && shifts[i - 1].shift_window_id == s.shift_window_id;

        if !follows_prev {
            if i > bunch_start {
                finalize_bunch_rest_ends(
                    shifts,
                    &joint_order,
                    bunch_start,
                    i,
                    &mut rest_ends,
                );
            }
            joint_order.clear();
            latest_rest = 0;
            bunch_start = i;
        }

        let prep_start = if !follows_prev {
            joint_prep_map.clear();
            let sm = time_to_minutes(&s.start_time);
            earliest_prep_raw = sm - m.prep_minutes;
            let ps = minutes_to_hhmm(earliest_prep_raw);
            if m.joint_prep {
                joint_prep_map.insert(s.syllabus_preset_id, ps.clone());
            }
            ps
        } else if m.joint_prep && joint_prep_map.contains_key(&s.syllabus_preset_id) {
            joint_prep_map
                .get(&s.syllabus_preset_id)
                .expect("checked")
                .clone()
        } else {
            earliest_prep_raw -= m.prep_minutes;
            let ps = minutes_to_hhmm(earliest_prep_raw);
            if m.joint_prep {
                joint_prep_map.insert(s.syllabus_preset_id, ps.clone());
            }
            ps
        };
        prep_starts.push(prep_start);

        push_joint_order_rest(
            &mut joint_order,
            &mut latest_rest,
            s.syllabus_preset_id,
            m.rest_minutes,
            m.joint_rest,
        );
    }

    finalize_bunch_rest_ends(
        shifts,
        &joint_order,
        bunch_start,
        n,
        &mut rest_ends,
    );

    Ok(prep_starts
        .into_iter()
        .zip(rest_ends.into_iter())
        .collect())
}

/// Existing shifts for one employee on one day (flight times only; chain is recomputed from geometry).
pub fn load_day_chain_for_employee(
    conn: &Connection,
    employee_id: i64,
    shift_date: &str,
) -> Result<Vec<ChainShiftRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, shift_window_id, start_time, end_time, syllabus_preset_id
             FROM shifts
             WHERE employee_id = ?1 AND shift_date = ?2
             ORDER BY start_time, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![employee_id, shift_date], |r| {
            Ok(ChainShiftRow {
                id: r.get(0)?,
                shift_window_id: r.get(1)?,
                start_time: r.get(2)?,
                end_time: r.get(3)?,
                syllabus_preset_id: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub struct SolvedNewShiftTimes {
    pub start_time: String,
    pub end_time: String,
    pub syllabus_preset_id: i64,
    pub prep_start: String,
    pub rest_end: String,
    pub prep_end: String,
    pub rest_start: String,
}

fn row_from_bounds(
    conn: &Connection,
    shift_window_id: i64,
    shift_date: &str,
    syllabus_num: i64,
) -> Result<SolvedNewShiftTimes, String> {
    let (start_time, end_time, syllabus_preset_id, prep_start, rest_end, prep_end, rest_start) =
        shift_row_from_syllabus_num(conn, shift_window_id, shift_date, syllabus_num)?;
    Ok(SolvedNewShiftTimes {
        start_time,
        end_time,
        syllabus_preset_id,
        prep_start,
        rest_end,
        prep_end,
        rest_start,
    })
}

fn synthetic_chain_quad(
    conn: &Connection,
    shift_date: &str,
    new_eid: i64,
    shift_window_id: i64,
    st: &str,
    et: &str,
    pid: i64,
) -> Result<(String, String), String> {
    let mut chain = load_day_chain_for_employee(conn, new_eid, shift_date)?;
    chain.push(ChainShiftRow {
        id: 0,
        shift_window_id,
        start_time: st.to_string(),
        end_time: et.to_string(),
        syllabus_preset_id: pid,
    });
    chain.sort_by(|a, b| {
        time_to_minutes(&a.start_time)
            .cmp(&time_to_minutes(&b.start_time))
            .then_with(|| a.id.cmp(&b.id))
    });
    let idx = chain
        .iter()
        .position(|r| r.id == 0)
        .ok_or_else(|| "שגיאה פנימית בשרשרת סילבוס".to_string())?;

    let preset_ids: Vec<i64> = chain.iter().map(|r| r.syllabus_preset_id).collect();
    let meta = load_presets_prep_rest_meta(conn, &preset_ids).map_err(|e| e.to_string())?;
    for r in &chain {
        if !meta.contains_key(&r.syllabus_preset_id) {
            return Err(format!("סילבוס {} לא נמצא במסד", r.syllabus_preset_id));
        }
    }
    let computed = compute_chained_prep_rest(&chain, &meta)?;
    Ok(computed[idx].clone())
}

/// Wall clock + prep/rest quad for a new shift row (no cross-assignee alignment).
pub fn solve_create_shift_prep_rest(
    conn: &Connection,
    shift_date: &str,
    shift_window_id: i64,
    syllabus_num: i64,
    new_employee_id: Option<i64>,
) -> Result<SolvedNewShiftTimes, String> {
    let (st, et, pid) =
        shift_bounds_from_syllabus_num(conn, shift_window_id, shift_date, syllabus_num)?;
    let meta_one = load_preset_prep_rest_meta(conn, pid).map_err(|e| e.to_string())?;

    if new_employee_id.is_none() {
        return row_from_bounds(conn, shift_window_id, shift_date, syllabus_num);
    }
    let new_eid = new_employee_id.expect("checked");

    let day = load_day_chain_for_employee(conn, new_eid, shift_date)?;
    if day.is_empty() {
        return row_from_bounds(conn, shift_window_id, shift_date, syllabus_num);
    }
    let (ps_star, re_star) =
        synthetic_chain_quad(conn, shift_date, new_eid, shift_window_id, &st, &et, pid)?;
    let (pe_star, rs_star) = compute_prep_end_rest_start(
        &ps_star,
        &re_star,
        meta_one.prep_minutes,
        meta_one.rest_minutes,
    );
    Ok(SolvedNewShiftTimes {
        start_time: st,
        end_time: et,
        syllabus_preset_id: pid,
        prep_start: ps_star,
        rest_end: re_star,
        prep_end: pe_star,
        rest_start: rs_star,
    })
}

/// Reload chained prep/rest for all assigned shifts of `employee_id` on `shift_date`.
pub fn recalc_chained_prep_rest_for_employee_day(
    conn: &Connection,
    employee_id: i64,
    shift_date: &str,
) -> Result<(), String> {
    let rows = load_day_chain_for_employee(conn, employee_id, shift_date)?;

    if rows.is_empty() {
        return Ok(());
    }

    let ids: Vec<i64> = rows.iter().map(|r| r.syllabus_preset_id).collect();
    let meta = load_presets_prep_rest_meta(conn, &ids).map_err(|e| e.to_string())?;

    for r in &rows {
        if !meta.contains_key(&r.syllabus_preset_id) {
            return Err(format!(
                "סילבוס {} לא נמצא במסד",
                r.syllabus_preset_id
            ));
        }
    }

    let computed = compute_chained_prep_rest(&rows, &meta)?;

    for (row, (ps, re)) in rows.iter().zip(computed.iter()) {
        let m = *meta
            .get(&row.syllabus_preset_id)
            .expect("validated above");
        let (pe, rs) = compute_prep_end_rest_start(ps, re, m.prep_minutes, m.rest_minutes);
        conn.execute(
            "UPDATE shifts SET prep_start = ?1, rest_end = ?2, prep_end = ?3, rest_start = ?4 WHERE id = ?5",
            params![ps, re, pe, rs, row.id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::syllabus::compute_prep_end_rest_start;
    use crate::domain::syllabus::shift_row_from_syllabus_num;
    use rusqlite::Connection;

    fn meta(p: i32, r: i32, jp: bool, joint_rest: bool) -> PresetPrepRestMeta {
        PresetPrepRestMeta {
            prep_minutes: p,
            rest_minutes: r,
            joint_prep: jp,
            joint_rest,
        }
    }

    fn row(id: i64, wid: i64, st: &str, et: &str, pid: i64) -> ChainShiftRow {
        ChainShiftRow {
            id,
            shift_window_id: wid,
            start_time: st.to_string(),
            end_time: et.to_string(),
            syllabus_preset_id: pid,
        }
    }

    #[test]
    fn single_shift_isolated() {
        let shifts = vec![row(1, 10, "09:00", "10:00", 100)];
        let mut hm = HashMap::new();
        hm.insert(100, meta(30, 15, false, false));
        let out = compute_chained_prep_rest(&shifts, &hm).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "08:30");
        assert_eq!(out[0].1, "10:15");
        let (pe, rs) = compute_prep_end_rest_start(&out[0].0, &out[0].1, 30, 15);
        assert_eq!(pe, "09:00");
        assert_eq!(rs, "10:00");
    }

    #[test]
    fn two_following_non_joint_stacks_prep_and_rest() {
        let shifts = vec![
            row(1, 1, "09:00", "10:00", 100),
            row(2, 1, "10:00", "11:00", 101),
        ];
        let mut hm = HashMap::new();
        hm.insert(100, meta(30, 15, false, false));
        hm.insert(101, meta(20, 10, false, false));
        let out = compute_chained_prep_rest(&shifts, &hm).unwrap();
        assert_eq!(out[0].0, "08:30");
        assert_eq!(out[1].0, "08:10");
        assert_eq!(out[0].1, "11:15");
        assert_eq!(out[1].1, "11:25");
    }

    #[test]
    fn break_restarts_chain() {
        let shifts = vec![
            row(1, 1, "09:00", "10:00", 100),
            row(2, 1, "10:30", "11:30", 101),
        ];
        let mut hm = HashMap::new();
        hm.insert(100, meta(30, 15, false, false));
        hm.insert(101, meta(20, 10, false, false));
        let out = compute_chained_prep_rest(&shifts, &hm).unwrap();
        assert_eq!(out[0].0, "08:30");
        assert_eq!(out[1].0, "10:10");
    }

    #[test]
    fn joint_prep_shares_prep_start() {
        let shifts = vec![
            row(1, 1, "09:00", "10:00", 100),
            row(2, 1, "10:00", "11:00", 100),
        ];
        let mut hm = HashMap::new();
        hm.insert(100, meta(30, 15, true, true));
        let out = compute_chained_prep_rest(&shifts, &hm).unwrap();
        assert_eq!(out[0].0, "08:30");
        assert_eq!(out[1].0, "08:30");
    }

    #[test]
    fn joint_rest_shares_rest_end() {
        let shifts = vec![
            row(1, 1, "09:00", "10:00", 100),
            row(2, 1, "10:00", "11:00", 100),
        ];
        let mut hm = HashMap::new();
        hm.insert(100, meta(0, 20, false, true));
        let out = compute_chained_prep_rest(&shifts, &hm).unwrap();
        assert_eq!(out[1].1, "11:20");
        assert_eq!(out[0].1, "11:20");
    }

    /// Same wall slot for two employees: prep/rest follows each employee’s own day chain.
    #[test]
    fn recalc_same_slot_differs_when_one_employee_has_extra_flight_that_day() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE syllabus_presets (
                id INTEGER PRIMARY KEY,
                prep_minutes INTEGER NOT NULL DEFAULT 0,
                rest_minutes INTEGER NOT NULL DEFAULT 0,
                joint_prep INTEGER NOT NULL DEFAULT 0,
                joint_rest INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO syllabus_presets VALUES (1, 30, 15, 0, 0);
            INSERT INTO syllabus_presets VALUES (2, 20, 10, 0, 0);
            CREATE TABLE shift_windows (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL
            );
            INSERT INTO shift_windows VALUES (10, 'מבחן');
            CREATE TABLE shifts (
                id INTEGER PRIMARY KEY,
                shift_date TEXT NOT NULL,
                shift_window_id INTEGER NOT NULL,
                syllabus_num INTEGER NOT NULL,
                employee_id INTEGER,
                syllabus_preset_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                prep_start TEXT NOT NULL,
                rest_end TEXT NOT NULL,
                prep_end TEXT NOT NULL,
                rest_start TEXT NOT NULL
            );
            INSERT INTO shifts VALUES
             (1, '2026-04-01', 10, 0, 100, 1, '09:00', '10:00', '08:30', '10:15', '09:00', '10:00'),
             (2, '2026-04-01', 10, 0, 200, 1, '09:00', '10:00', '08:30', '10:15', '09:00', '10:00'),
             (3, '2026-04-01', 10, 1, 200, 2, '10:00', '11:00', '09:40', '11:10', '10:00', '11:00');",
        )
        .unwrap();
        recalc_chained_prep_rest_for_employee_day(&c, 100, "2026-04-01").unwrap();
        recalc_chained_prep_rest_for_employee_day(&c, 200, "2026-04-01").unwrap();
        let re1: String = c
            .query_row("SELECT rest_end FROM shifts WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        let re2: String = c
            .query_row("SELECT rest_end FROM shifts WHERE id = 2", [], |r| r.get(0))
            .unwrap();
        assert_eq!(re1, "10:15");
        assert_eq!(re2, "11:15");
        assert_ne!(re1, re2);
    }

    /// Second shift on the day chains joint-rest with an earlier new slot (geometry only, no DB pins).
    #[test]
    fn assign_chains_with_existing_day_joint_rest() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE syllabus_presets (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                min_role_id INTEGER,
                duration_minutes INTEGER NOT NULL,
                prep_minutes INTEGER NOT NULL DEFAULT 0,
                rest_minutes INTEGER NOT NULL DEFAULT 0,
                max_in_row INTEGER NOT NULL DEFAULT 1,
                joint_prep INTEGER NOT NULL DEFAULT 0,
                joint_rest INTEGER NOT NULL DEFAULT 0,
                notes TEXT,
                system_locked INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO syllabus_presets VALUES (5, 't', NULL, 60, 0, 20, 1, 0, 1, NULL, 0);
            CREATE TABLE shift_windows (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT,
                notes TEXT,
                coverage_start TEXT NOT NULL,
                coverage_end TEXT NOT NULL,
                syllabus_slot_preset_ids TEXT NOT NULL DEFAULT '[]'
            );
            INSERT INTO shift_windows VALUES (10, 'w', '#000', NULL, '2026-04-01T09:00:00', '2026-04-01T18:00:00', '[5,5]');
            CREATE TABLE shifts (
                id INTEGER PRIMARY KEY,
                shift_date TEXT NOT NULL,
                shift_window_id INTEGER NOT NULL,
                syllabus_num INTEGER NOT NULL,
                employee_id INTEGER,
                syllabus_preset_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                prep_start TEXT NOT NULL,
                rest_end TEXT NOT NULL,
                prep_end TEXT NOT NULL,
                rest_start TEXT NOT NULL
            );",
        )
        .unwrap();
        c.execute(
            "INSERT INTO shifts VALUES (1, '2026-04-01', 10, 1, 99, 5, '10:00', '11:00', '10:00', '11:20', '10:00', '11:00')",
            [],
        )
        .unwrap();

        let (_, _, _, _, isolated_re, _, _) =
            shift_row_from_syllabus_num(&c, 10, "2026-04-01", 0).unwrap();
        assert_eq!(isolated_re, "10:20");

        let solved = solve_create_shift_prep_rest(&c, "2026-04-01", 10, 0, Some(99)).unwrap();
        assert_eq!(solved.rest_end, "11:20");
        assert_ne!(solved.rest_end, isolated_re);
    }
}
