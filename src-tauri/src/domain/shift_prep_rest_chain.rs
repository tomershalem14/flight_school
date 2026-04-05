//! Chained `prep_start` / `rest_end` for one employee on one calendar day.

use crate::domain::rules::time_to_minutes;
use crate::domain::syllabus::{minutes_to_hhmm, PresetPrepRestMeta};
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

/// Reload chained prep/rest for all assigned shifts of `employee_id` on `shift_date`.
pub fn recalc_chained_prep_rest_for_employee_day(
    conn: &Connection,
    employee_id: i64,
    shift_date: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, shift_window_id, start_time, end_time, syllabus_preset_id
             FROM shifts
             WHERE employee_id = ?1 AND shift_date = ?2
             ORDER BY start_time, id",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<ChainShiftRow> = stmt
        .query_map(params![employee_id, shift_date], |r| {
            Ok(ChainShiftRow {
                id: r.get(0)?,
                shift_window_id: r.get(1)?,
                start_time: r.get(2)?,
                end_time: r.get(3)?,
                syllabus_preset_id: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if rows.is_empty() {
        return Ok(());
    }

    let ids: Vec<i64> = rows.iter().map(|r| r.syllabus_preset_id).collect();
    let meta = crate::domain::syllabus::load_presets_prep_rest_meta(conn, &ids)
        .map_err(|e| e.to_string())?;

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
        conn.execute(
            "UPDATE shifts SET prep_start = ?1, rest_end = ?2 WHERE id = ?3",
            params![ps, re, row.id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
        // Formula A: final bunch end 11:00 + prefix offsets 15 and 25.
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
}
