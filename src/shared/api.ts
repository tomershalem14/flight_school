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

export async function getShiftTypes(): Promise<JsonObject[]> {
  return invoke("get_shift_types");
}

export async function createShiftType(payload: JsonObject): Promise<JsonObject> {
  return invoke("create_shift_type", { payload });
}

export async function getShifts(week_start: string): Promise<JsonObject[]> {
  return invoke("get_shifts", { weekStart: week_start });
}

export async function createShift(payload: JsonObject): Promise<JsonObject> {
  return invoke("create_shift", { payload });
}

export async function updateShift(
  shift_id: number,
  payload: JsonObject,
): Promise<JsonObject> {
  return invoke("update_shift", { shiftId: shift_id, payload });
}

export async function deleteShift(shift_id: number): Promise<JsonObject> {
  return invoke("delete_shift", { shiftId: shift_id });
}

export async function getDayViolations(date: string): Promise<JsonObject[]> {
  return invoke("get_day_violations", { date });
}

export async function getConstraints(employee_id?: number): Promise<JsonObject[]> {
  if (employee_id !== undefined) {
    return invoke("get_constraints", { employeeId: employee_id });
  }
  return invoke("get_constraints", {});
}

export async function createConstraint(payload: JsonObject): Promise<JsonObject> {
  return invoke("create_constraint", { payload });
}

export async function updateConstraint(
  con_id: number,
  payload: JsonObject,
): Promise<JsonObject> {
  return invoke("update_constraint", { conId: con_id, payload });
}

export async function deleteConstraint(con_id: number): Promise<JsonObject> {
  return invoke("delete_constraint", { conId: con_id });
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
