//! Flight School desktop app — Tauri shell, SQLite persistence, scheduling rules in Rust.

mod commands;
mod db;
mod domain;
mod error;
mod integration;
mod json_util;

use db::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app
                .handle()
                .path()
                .app_data_dir()
                .map_err(|e| format!("app_data_dir: {e}"))?;
            std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
            let db_path = dir.join("scheduler.db");
            let state = AppState::open(db_path).map_err(|e| e.to_string())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::roles::get_roles,
            commands::roles::create_role,
            commands::roles::update_role,
            commands::employees::get_employees,
            commands::employees::create_employee,
            commands::employees::update_employee,
            commands::employees::delete_employee,
            commands::shift_types::get_shift_types,
            commands::shift_types::create_shift_type,
            commands::shifts::get_shifts,
            commands::shifts::create_shift,
            commands::shifts::update_shift,
            commands::shifts::delete_shift,
            commands::shifts::get_shift_violations,
            commands::shifts::get_day_violations,
            commands::constraints::get_constraints,
            commands::constraints::create_constraint,
            commands::constraints::update_constraint,
            commands::constraints::delete_constraint,
            commands::fixed_assignments::get_fixed_assignments,
            commands::fixed_assignments::create_fixed_assignment,
            commands::fixed_assignments::delete_fixed_assignment,
            commands::reports::get_workload_report,
            commands::reports::get_employee_history,
            commands::reports::get_last_shift,
            commands::reports::get_shift_count_report,
            commands::whatsapp::send_whatsapp,
            commands::remote_reg::create_reg_session,
            commands::remote_reg::get_remote_registrations,
            commands::remote_reg::get_reg_form,
            commands::remote_reg::submit_registration,
            commands::remote_reg::update_remote_registration,
            commands::remote_reg::delete_remote_registration,
            commands::sheet::save_sheet_config,
            commands::sheet::get_sheet_config,
            commands::sheet::sheet_poll,
            commands::ui_kv::ui_kv_get,
            commands::ui_kv::ui_kv_set,
            commands::ui_kv::ui_kv_remove,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
