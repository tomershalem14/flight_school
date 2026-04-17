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
            commands::roles::delete_role,
            commands::employees::get_employees,
            commands::employees::create_employee,
            commands::employees::update_employee,
            commands::employees::delete_employee,
            commands::employees::reactivate_employee,
            commands::employee_order_presets::list_employee_order_presets,
            commands::employee_order_presets::set_employee_order_active,
            commands::employee_order_presets::create_employee_order_preset,
            commands::employee_order_presets::get_employee_order_preset,
            commands::employee_order_presets::update_employee_order_preset,
            commands::employee_order_presets::delete_employee_order_preset,
            commands::shift_windows::get_shift_windows,
            commands::shift_windows::create_shift_window,
            commands::shift_windows::update_shift_window,
            commands::shift_windows::delete_shift_window,
            commands::syllabus_presets::get_syllabus_presets,
            commands::syllabus_presets::create_syllabus_preset,
            commands::syllabus_presets::update_syllabus_preset,
            commands::syllabus_presets::delete_syllabus_preset,
            commands::shifts::get_shifts,
            commands::shifts::create_shift,
            commands::shifts::reassign_shift_employee,
            commands::shifts::delete_shift,
            commands::shifts::get_shift_violations,
            commands::shifts::get_day_violations,
            commands::schedule_events::get_schedule_events,
            commands::schedule_events::create_schedule_event,
            commands::schedule_events::update_schedule_event,
            commands::schedule_events::delete_schedule_event,
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
            commands::global_rules::get_global_rules,
            commands::global_rules::set_global_rules,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
