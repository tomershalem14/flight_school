//! Poll Google Sheets public CSV export — matches `main.py` `poll_sheet`.

use crate::error::AppError;
use regex::Regex;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::io::Cursor;

fn try_row_i64(
    tx: &rusqlite::Transaction<'_>,
    sql: &str,
    p: impl rusqlite::Params,
) -> rusqlite::Result<Option<i64>> {
    match tx.query_row(sql, p, |r| r.get::<_, i64>(0)) {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

fn try_row_reg(
    tx: &rusqlite::Transaction<'_>,
    name: &str,
    shift_date: &str,
) -> rusqlite::Result<Option<(i64, String, Option<String>, Option<String>)>> {
    match tx.query_row(
        "SELECT id, status, reg_start, reg_end FROM remote_registrations
         WHERE employee_name=? AND shift_date=?
         ORDER BY id DESC LIMIT 1",
        [name, shift_date],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ) {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn poll_sheet(conn: &mut Connection) -> Result<Value, AppError> {
    conn.execute("PRAGMA foreign_keys = OFF", [])
        .map_err(AppError::from)?;

    let url: String = match conn.query_row(
        "SELECT value FROM settings WHERE key='gsheet_url'",
        [],
        |r| r.get(0),
    ) {
        Ok(s) => s,
        Err(rusqlite::Error::QueryReturnedNoRows) => String::new(),
        Err(e) => return Err(AppError::from(e)),
    };

    if url.trim().is_empty() {
        return Err(AppError::msg("לא הוגדר Google Sheet"));
    }

    let sheet_id_re = Regex::new(r"/spreadsheets/d/([a-zA-Z0-9_-]+)").unwrap();
    let gid_re = Regex::new(r"gid=(\d+)").unwrap();

    let sheet_id = sheet_id_re
        .captures(&url)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str())
        .ok_or_else(|| AppError::msg("URL לא תקין"))?;

    let gid = gid_re
        .captures(&url)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str())
        .unwrap_or("0");

    let csv_url = format!(
        "https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    );

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Http(e.to_string()))?;

    let resp = client
        .get(&csv_url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (compatible; HamayishDesktop/1.0)",
        )
        .send()
        .map_err(|e| AppError::Http(e.to_string()))?;

    let content = resp
        .text()
        .map_err(|e| AppError::Http(e.to_string()))?;

    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(Cursor::new(content));

    let headers = reader
        .headers()
        .map_err(|e| AppError::Csv(e.to_string()))?
        .clone();

    let headers_vec: Vec<String> = headers.iter().map(String::from).collect();

    let rows: Vec<csv::StringRecord> = reader
        .records()
        .filter_map(|r| r.ok())
        .collect();

    if rows.is_empty() {
        conn.execute("PRAGMA foreign_keys = ON", []).ok();
        return Ok(json!({ "count": 0, "total": 0, "registrations": [] }));
    }

    fn find_col(headers: &[String], keywords: &[&str]) -> Option<usize> {
        for (i, h) in headers.iter().enumerate() {
            let hl = h.trim().to_lowercase();
            for kw in keywords {
                if hl.contains(&kw.trim().to_lowercase()) {
                    return Some(i);
                }
            }
        }
        None
    }

    let col_fname = find_col(
        &headers_vec,
        &["שם פרטי", "שם מפעיל", "first name", "שם"],
    )
    .ok_or_else(|| AppError::msg(format!("לא נמצאה עמודת שם. עמודות: {headers_vec:?}")))?;

    let col_lname = find_col(&headers_vec, &["שם משפחה", "last name", "משפחה"]);
    let col_date = find_col(&headers_vec, &["תאריך", "date", "יום"]);
    let col_start = find_col(
        &headers_vec,
        &[
            "פתיחת חלון",
            "תחילת חלון",
            "שעת תחילה",
            "התחלה",
            "start",
        ],
    );
    let col_end = find_col(
        &headers_vec,
        &["סיום חלון", "שעת סיום", "סיום", "end"],
    );

    let date_re = Regex::new(r"(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{2,4})").unwrap();
    let time_re = Regex::new(r"(\d{1,2}):(\d{2})").unwrap();

    let norm_date = |d: &str| -> String {
        if let Some(c) = date_re.captures(d.trim()) {
            let day = c.get(1).unwrap().as_str();
            let mo = c.get(2).unwrap().as_str();
            let mut y = c.get(3).unwrap().as_str().to_string();
            if y.len() == 2 {
                y = format!("20{y}");
            }
            format!(
                "{}-{}-{}",
                y,
                format!("{:0>2}", mo.parse::<u32>().unwrap_or(0)),
                format!("{:0>2}", day.parse::<u32>().unwrap_or(0))
            )
        } else {
            d.trim().to_string()
        }
    };

    let norm_time = |t: &str| -> String {
        if let Some(c) = time_re.captures(t.trim()) {
            let h: i32 = c.get(1).unwrap().as_str().parse().unwrap_or(0);
            let m = c.get(2).unwrap().as_str();
            format!("{h:02}:{m}")
        } else {
            t.trim().to_string()
        }
    };

    let mut new_count = 0i64;
    let mut results = Vec::new();
    let tx = conn.transaction().map_err(AppError::from)?;

    for r in &rows {
        let fname = r
            .get(col_fname)
            .map(|s| s.trim())
            .unwrap_or("")
            .to_string();
        let lname = col_lname
            .and_then(|i| r.get(i))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let name = if lname.is_empty() {
            fname.clone()
        } else {
            format!("{fname} {lname}")
        };

        let date_raw = col_date
            .and_then(|i| r.get(i))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let start_time_raw = col_start
            .and_then(|i| r.get(i))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let end_time_raw = col_end
            .and_then(|i| r.get(i))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        if fname.is_empty() || start_time_raw.is_empty() {
            continue;
        }

        let shift_date = norm_date(&date_raw);
        let start_time = norm_time(&start_time_raw);
        let end_time = if end_time_raw.is_empty() {
            start_time.clone()
        } else {
            norm_time(&end_time_raw)
        };

        let mut emp_id = try_row_i64(
            &tx,
            "SELECT id FROM employees WHERE name=? AND is_active=1",
            [&name],
        )
        .map_err(AppError::from)?;

        if emp_id.is_none() {
            emp_id = try_row_i64(
                &tx,
                "SELECT id FROM employees WHERE name LIKE ? AND is_active=1",
                [format!("{fname}%")],
            )
            .map_err(AppError::from)?;
        }
        if emp_id.is_none() {
            emp_id = try_row_i64(
                &tx,
                "SELECT id FROM employees WHERE name LIKE ? AND is_active=1",
                [format!("%{fname}%")],
            )
            .map_err(AppError::from)?;
        }

        let existing = try_row_reg(&tx, &name, &shift_date).map_err(AppError::from)?;

        if let Some((ex_id, ex_status, ex_rs, ex_re)) = existing {
            let hours_changed =
                ex_rs.as_deref() != Some(start_time.as_str()) || ex_re.as_deref() != Some(end_time.as_str());
            if ex_status == "confirmed" {
                if hours_changed {
                    tx.execute(
                        "UPDATE remote_registrations SET reg_start=?, reg_end=?, status='resubmitted' WHERE id=?",
                        params![start_time, end_time, ex_id],
                    )?;
                    new_count += 1;
                }
            } else if hours_changed {
                tx.execute(
                    "UPDATE remote_registrations SET reg_start=?, reg_end=?, status='submitted' WHERE id=?",
                    params![start_time, end_time, ex_id],
                )?;
                new_count += 1;
            }
        } else {
            tx.execute(
                "INSERT INTO remote_registrations
                 (employee_id, employee_name, shift_date, start_time, end_time, reg_start, reg_end, status)
                 VALUES (?,?,?,?,?,?,?,'submitted')",
                params![
                    emp_id,
                    name,
                    shift_date,
                    start_time,
                    end_time,
                    start_time,
                    end_time
                ],
            )?;
            new_count += 1;
        }

        results.push(json!({
            "name": name,
            "date": shift_date,
            "start": start_time,
            "end": end_time,
            "found_employee": emp_id.is_some(),
        }));
    }

    tx.commit().map_err(AppError::from)?;
    conn.execute("PRAGMA foreign_keys = ON", [])
        .map_err(AppError::from)?;

    Ok(json!({
        "count": new_count,
        "total": results.len(),
        "registrations": results,
    }))
}
