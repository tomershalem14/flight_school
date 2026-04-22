/**
 * Typed wrappers around Tauri `invoke`.
 * Top-level argument keys use camelCase (Tauri v2 IPC); nested payload fields
 * stay snake_case to match Rust struct fields (e.g. EmployeeCreate.role_id).
 */
import { invoke } from "@tauri-apps/api/core";

export type JsonObject = Record<string, unknown>;

export async function getRoles(): Promise<JsonObject[]> {
  return invoke("get_roles");
}

export async function createRole(payload: JsonObject): Promise<JsonObject> {
  return invoke("create_role", { payload });
}

export async function updateRole(
  role_id: number,
  payload: JsonObject,
): Promise<JsonObject> {
  return invoke("update_role", { roleId: role_id, payload });
}

export async function deleteRole(role_id: number): Promise<JsonObject> {
  return invoke("delete_role", { roleId: role_id });
}

export async function getEmployees(active_only = true): Promise<JsonObject[]> {
  return invoke("get_employees", { activeOnly: active_only });
}

export async function createEmployee(payload: JsonObject): Promise<JsonObject> {
  return invoke("create_employee", { payload });
}

export async function updateEmployee(
  emp_id: number,
  payload: JsonObject,
): Promise<JsonObject> {
  return invoke("update_employee", { empId: emp_id, payload });
}

export async function deleteEmployee(emp_id: number): Promise<JsonObject> {
  return invoke("delete_employee", { empId: emp_id });
}

export async function reactivateEmployee(emp_id: number): Promise<JsonObject> {
  return invoke("reactivate_employee", { empId: emp_id });
}

export async function listEmployeeOrderPresets(): Promise<JsonObject[]> {
  return invoke("list_employee_order_presets", {});
}

export async function setEmployeeOrderActive(
  preset_id: number | null,
): Promise<JsonObject> {
  return invoke("set_employee_order_active", { presetId: preset_id });
}

export async function createEmployeeOrderPreset(name: string): Promise<JsonObject> {
  return invoke("create_employee_order_preset", { payload: { name } });
}

export async function getEmployeeOrderPreset(preset_id: number): Promise<JsonObject> {
  return invoke("get_employee_order_preset", { presetId: preset_id });
}

export async function updateEmployeeOrderPreset(
  preset_id: number,
  payload: JsonObject,
): Promise<JsonObject> {
  return invoke("update_employee_order_preset", { presetId: preset_id, payload });
}

export async function deleteEmployeeOrderPreset(preset_id: number): Promise<JsonObject> {
  return invoke("delete_employee_order_preset", { presetId: preset_id });
}

export async function getShiftWindows(date?: string): Promise<JsonObject[]> {
  if (date === undefined) {
    return invoke("get_shift_windows", {});
  }
  return invoke("get_shift_windows", { date });
}

export async function createShiftWindow(payload: JsonObject): Promise<JsonObject> {
  return invoke("create_shift_window", { payload });
}

export async function updateShiftWindow(
  shiftWindowId: number,
  payload: JsonObject,
): Promise<JsonObject> {
  return invoke("update_shift_window", { shiftWindowId, payload });
}

export async function deleteShiftWindow(shiftWindowId: number): Promise<JsonObject> {
  return invoke("delete_shift_window", { shiftWindowId });
}

export async function getSyllabusPresets(): Promise<JsonObject[]> {
  return invoke("get_syllabus_presets");
}

export async function createSyllabusPreset(payload: JsonObject): Promise<JsonObject> {
  return invoke("create_syllabus_preset", { payload });
}

export async function updateSyllabusPreset(
  presetId: number,
  payload: JsonObject,
): Promise<JsonObject> {
  return invoke("update_syllabus_preset", { presetId, payload });
}

export async function deleteSyllabusPreset(presetId: number): Promise<JsonObject> {
  return invoke("delete_syllabus_preset", { presetId });
}

export async function getShifts(week_start: string): Promise<JsonObject[]> {
  return invoke("get_shifts", { weekStart: week_start });
}

export async function createShift(payload: JsonObject): Promise<JsonObject> {
  return invoke("create_shift", { payload });
}

export async function reassignShiftEmployee(payload: JsonObject): Promise<JsonObject> {
  return invoke("reassign_shift_employee", { payload });
}

export async function deleteShift(shift_id: number): Promise<JsonObject> {
  return invoke("delete_shift", { shiftId: shift_id });
}

export async function getDayViolations(date: string): Promise<JsonObject[]> {
  return invoke("get_day_violations", { date });
}

export async function getScheduleEvents(week_start: string): Promise<JsonObject[]> {
  return invoke("get_schedule_events", { weekStart: week_start });
}

export async function listAvailabilityForWeek(week_start: string): Promise<JsonObject[]> {
  return invoke("list_availability_for_week", { weekStart: week_start });
}

export async function createAvailabilityWholeDay(
  employee_id: number,
  avail_date: string,
): Promise<JsonObject> {
  return invoke("create_availability_whole_day", {
    employeeId: employee_id,
    availDate: avail_date,
  });
}

export async function deleteAvailabilityForEmployeeDay(
  employee_id: number,
  avail_date: string,
): Promise<JsonObject> {
  return invoke("delete_availability_for_employee_day", {
    employeeId: employee_id,
    availDate: avail_date,
  });
}

export async function createAvailabilityTimed(
  employee_id: number,
  avail_date: string,
  start_time: string,
  end_time: string,
): Promise<JsonObject> {
  return invoke("create_availability_timed", {
    employeeId: employee_id,
    availDate: avail_date,
    startTime: start_time,
    endTime: end_time,
  });
}

export async function deleteAvailabilityById(id: number): Promise<JsonObject> {
  return invoke("delete_availability_by_id", { id });
}

export async function getWeeklySettings(
  week_start: string,
): Promise<JsonObject | null> {
  return invoke("get_weekly_settings", { weekStart: week_start });
}

export async function saveWeeklySettings(
  week_start: string,
  payload: { daysInSchool: number; activeDaysMask: number },
): Promise<JsonObject> {
  return invoke("save_weekly_settings", {
    weekStart: week_start,
    daysInSchool: payload.daysInSchool,
    activeDaysMask: payload.activeDaysMask,
  });
}

export async function createScheduleEvent(payload: JsonObject): Promise<JsonObject> {
  return invoke("create_schedule_event", { payload });
}

export async function updateScheduleEvent(payload: JsonObject): Promise<JsonObject> {
  return invoke("update_schedule_event", { payload });
}

export async function deleteScheduleEvent(event_id: number): Promise<JsonObject> {
  return invoke("delete_schedule_event", { eventId: event_id });
}

export async function getWorkloadReport(week_start: string): Promise<JsonObject[]> {
  return invoke("get_workload_report", { weekStart: week_start });
}

export async function getShiftCountReport(week_start: string): Promise<JsonObject[]> {
  return invoke("get_shift_count_report", { weekStart: week_start });
}

export async function getEmployeeHistory(
  employee_id: number,
  limit?: number,
): Promise<JsonObject[]> {
  return invoke("get_employee_history", { employeeId: employee_id, limit });
}

export async function sendWhatsapp(week_start: string): Promise<JsonObject[]> {
  return invoke("send_whatsapp", { weekStart: week_start });
}

export async function getRemoteRegistrations(
  week_start?: string,
  status?: string,
): Promise<JsonObject[]> {
  return invoke("get_remote_registrations", { weekStart: week_start, status });
}

export async function createRegSession(payload: JsonObject): Promise<JsonObject> {
  return invoke("create_reg_session", { s: payload });
}

export async function getRegForm(token: string): Promise<JsonObject> {
  return invoke("get_reg_form", { token });
}

export async function submitRegistration(payload: JsonObject): Promise<JsonObject> {
  return invoke("submit_registration", { sub: payload });
}

export async function updateRemoteRegistration(
  reg_id: number,
  payload: JsonObject,
): Promise<JsonObject> {
  return invoke("update_remote_registration", { regId: reg_id, payload });
}

export async function deleteRemoteRegistration(reg_id: number): Promise<JsonObject> {
  return invoke("delete_remote_registration", { regId: reg_id });
}

export async function getSheetConfig(): Promise<{ sheet_url: string }> {
  return invoke("get_sheet_config");
}

export async function saveSheetConfig(sheet_url: string): Promise<JsonObject> {
  return invoke("save_sheet_config", { cfg: { sheet_url } });
}

export async function sheetPoll(): Promise<JsonObject> {
  return invoke("sheet_poll");
}

export async function uiKvGet(key: string): Promise<string | null> {
  return invoke("ui_kv_get", { key });
}

export async function uiKvSet(key: string, value: string): Promise<JsonObject> {
  return invoke("ui_kv_set", { key, value });
}

export type GlobalRulesPayload = {
  rest_between_shifts: number;
  rest_between_outer: number;
  /** Hours (server persists as minutes in SQLite). */
  max_workday: number;
  early_time: string;
  late_time: string;
  max_late_days: number;
  max_early_days: number;
  max_days_extreme: number;
};

export async function getGlobalRules(): Promise<JsonObject> {
  return invoke("get_global_rules");
}

export async function setGlobalRules(payload: GlobalRulesPayload): Promise<JsonObject> {
  return invoke("set_global_rules", { payload });
}
