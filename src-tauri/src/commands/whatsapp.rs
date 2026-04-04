use crate::commands::shifts::parse_week_end;
use crate::db::AppState;
use crate::error::AppError;
use chrono::{Datelike, NaiveDate, Weekday};
use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;

const DAYS_HE: [&str; 7] = [
    "ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת",
];

#[tauri::command]
pub fn send_whatsapp(state: State<'_, AppState>, week_start: String) -> Result<Vec<Value>, String> {
    let week_end = parse_week_end(&week_start).map_err(|e| e.to_string())?;
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, phone FROM employees WHERE is_active = 1 AND phone IS NOT NULL",
            )?;
            let emps: Vec<(i64, String, String)> = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .filter_map(|x| x.ok())
                .collect();

            let mut results = Vec::new();

            for (eid, name, phone) in emps {
                let mut sstmt = conn.prepare(
                    "SELECT s.shift_date, s.start_time, s.end_time, st.name as type_name
                     FROM shifts s
                     JOIN shift_windows st ON s.shift_window_id = st.id
                     WHERE s.employee_id = ? AND s.shift_date BETWEEN ? AND ?
                     ORDER BY s.shift_date, s.start_time",
                )?;
                let shifts: Vec<(String, String, String, String)> = sstmt
                    .query_map(params![eid, week_start, week_end], |r| {
                        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
                    })?
                    .filter_map(|x| x.ok())
                    .collect();

                if shifts.is_empty() {
                    continue;
                }

                let mut lines = vec![format!("שלום {name},\nלוז משמרות לשבוע {week_start}:\n")];
                for (sd, st, et, tname) in shifts {
                    let d = NaiveDate::parse_from_str(&sd, "%Y-%m-%d")
                        .unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap());
                    // Match Python: (weekday + 1) % 7 with Mon=0 ... Sun=6
                    let py_wd = match d.weekday() {
                        Weekday::Mon => 0,
                        Weekday::Tue => 1,
                        Weekday::Wed => 2,
                        Weekday::Thu => 3,
                        Weekday::Fri => 4,
                        Weekday::Sat => 5,
                        Weekday::Sun => 6,
                    };
                    let idx = (py_wd + 1) % 7;
                    let day_name = DAYS_HE[idx];
                    lines.push(format!("• {day_name} {sd} | {st}-{et} | {tname}"));
                }

                let message = lines.join("\n");
                let mut p = phone.replace(['-', '+', ' '], "");
                if p.starts_with('0') {
                    p = format!("972{}", &p[1..]);
                }
                let encoded = urlencoding::encode(&message);
                let wa_url = format!("https://wa.me/{p}?text={encoded}");

                results.push(json!({
                    "employee_name": name,
                    "phone": phone,
                    "message": message,
                    "wa_url": wa_url,
                }));
            }

            Ok(results)
        })
        .map_err(|e: AppError| e.to_string())
}
