import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import type { JsonObject } from "../../../shared/api";
import { shiftTypePillColors } from "../../../shared/shiftTypeColors";
import { windowDayTimeline } from "../../../shared/manningHours";
import { formatLocalHmFromMs } from "./matrixHoverSnap";
import { normalizeShiftRow, presetSyllabusRolesSorted } from "./scheduleShiftModel";

export function shiftsListKey(weekStr: string) {
  return ["shifts", weekStr] as const;
}

export function scheduleEventsListKey(weekStr: string) {
  return ["schedule_events", weekStr] as const;
}

/** Never await in sync `onMutate` paths tied to same-tick UI updates. */
export function voidCancelListQuery(qc: QueryClient, key: readonly unknown[]) {
  void qc.cancelQueries({ queryKey: key });
}

export function snapshotList<T>(qc: QueryClient, key: readonly unknown[]): T | undefined {
  return qc.getQueryData<T>(key);
}

export function restoreList<T>(qc: QueryClient, key: readonly unknown[], previous: T | undefined) {
  qc.setQueryData(key, previous);
}

export function invalidateViolationsDeferred(qc: QueryClient) {
  queueMicrotask(() => {
    void qc.invalidateQueries({ queryKey: ["violations"] });
  });
}

/** Matrix shift create/reassign/delete success: full week `get_shifts` refetch + violations refresh. */
export function afterMatrixShiftMutationSuccess(qc: QueryClient, weekStr: string): void {
  void qc.invalidateQueries({ queryKey: shiftsListKey(weekStr) });
  invalidateViolationsDeferred(qc);
}

export function nextNegativeTempId(ref: MutableRefObject<number>): number {
  return --ref.current;
}

/** Matches server `ORDER BY se.shift_date, se.start_time, se.id`. */
export function sortScheduleEventsList(rows: JsonObject[]): JsonObject[] {
  return [...rows].sort((a, b) => {
    const ds = String(a.shift_date ?? "").localeCompare(String(b.shift_date ?? ""));
    if (ds !== 0) return ds;
    const ts = String(a.start_time ?? "").localeCompare(String(b.start_time ?? ""));
    if (ts !== 0) return ts;
    return Number(a.id) - Number(b.id);
  });
}

/** Matches server `ORDER BY s.shift_date, s.start_time`. */
export function sortShiftsList(rows: JsonObject[]): JsonObject[] {
  return [...rows].sort((a, b) => {
    const ds = String(a.shift_date ?? "").localeCompare(String(b.shift_date ?? ""));
    if (ds !== 0) return ds;
    return String(a.start_time ?? "").localeCompare(String(b.start_time ?? ""));
  });
}

export function rollbackScheduleEventCreate(
  qc: QueryClient,
  weekStr: string,
  context: { previous?: JsonObject[]; tempId?: number } | undefined,
) {
  const key = scheduleEventsListKey(weekStr);
  const tempId = context?.tempId;
  if (context?.previous !== undefined) {
    qc.setQueryData(key, context.previous);
  } else if (tempId != null) {
    qc.setQueryData<JsonObject[]>(key, (old) =>
      (old ?? []).filter((r) => Number(r.id) !== tempId),
    );
  }
}

export type ScheduleEventCreatePayload = JsonObject & {
  shift_date: string;
  employee_id: number;
  start_time: string;
  end_time: string;
  name: string;
  event_kind: string;
};

export function scheduleEventCreateOnMutate(args: {
  qc: QueryClient;
  weekStr: string;
  payload: ScheduleEventCreatePayload;
  tempIdRef: MutableRefObject<number>;
  matrixEmployees: JsonObject[];
  employees: JsonObject[];
  clearCreateUi: () => void;
}): { previous: JsonObject[] | undefined; tempId: number } {
  const {
    qc,
    weekStr,
    payload,
    tempIdRef,
    matrixEmployees,
    employees,
    clearCreateUi,
  } = args;
  const key = scheduleEventsListKey(weekStr);
  voidCancelListQuery(qc, key);
  const previous = snapshotList<JsonObject[]>(qc, key);
  const tempId = nextNegativeTempId(tempIdRef);
  const eid = Number(payload.employee_id);
  const emp =
    matrixEmployees.find((x) => Number(x.id) === eid) ??
    employees.find((x) => Number(x.id) === eid);
  const emp_name = emp ? String(emp.name ?? "") : "";
  const row: JsonObject = {
    id: tempId,
    shift_date: String(payload.shift_date),
    employee_id: eid,
    start_time: String(payload.start_time),
    end_time: String(payload.end_time),
    name: String(payload.name),
    notes: String(payload.notes ?? ""),
    event_kind: String(payload.event_kind),
    emp_name,
  };
  qc.setQueryData<JsonObject[]>(key, (old) => sortScheduleEventsList([...(old ?? []), row]));
  clearCreateUi();
  return { previous, tempId };
}

export function scheduleEventCreateOnSuccess(args: {
  qc: QueryClient;
  weekStr: string;
  data: JsonObject;
  tempId: number | undefined | null;
}) {
  const { qc, weekStr, data, tempId } = args;
  const key = scheduleEventsListKey(weekStr);
  const newId = Number(data.id);
  if (!Number.isFinite(newId) || tempId == null) return;
  qc.setQueryData<JsonObject[]>(key, (old) =>
    old?.map((r) => (Number(r.id) === tempId ? { ...r, id: newId } : r)) ?? old,
  );
}

export function scheduleEventUpdateOnMutate(args: {
  qc: QueryClient;
  weekStr: string;
  payload: JsonObject;
}): { previous: JsonObject[] | undefined } {
  const { qc, weekStr, payload } = args;
  const key = scheduleEventsListKey(weekStr);
  voidCancelListQuery(qc, key);
  const previous = snapshotList<JsonObject[]>(qc, key);
  const id = Number(payload.event_id);
  const start_time = String(payload.start_time);
  const end_time = String(payload.end_time);
  qc.setQueryData<JsonObject[]>(key, (old) => {
    if (!old) return old ?? [];
    return old.map((row) =>
      Number(row.id) === id ? { ...row, start_time, end_time } : row,
    );
  });
  return { previous };
}

export function scheduleEventDeleteOnMutate(args: {
  qc: QueryClient;
  weekStr: string;
  eventId: number;
}): { previous: JsonObject[] | undefined } {
  const { qc, weekStr, eventId } = args;
  const key = scheduleEventsListKey(weekStr);
  voidCancelListQuery(qc, key);
  const previous = snapshotList<JsonObject[]>(qc, key);
  qc.setQueryData<JsonObject[]>(key, (old) =>
    (old ?? []).filter((r) => Number(r.id) !== eventId),
  );
  return { previous };
}

export function shiftDeleteOnMutate(args: {
  qc: QueryClient;
  weekStr: string;
  shiftId: number;
}): { previous: JsonObject[] | undefined } {
  const { qc, weekStr, shiftId } = args;
  const key = shiftsListKey(weekStr);
  voidCancelListQuery(qc, key);
  const previous = snapshotList<JsonObject[]>(qc, key);
  qc.setQueryData<JsonObject[]>(key, (old) =>
    (old ?? []).filter((r) => Number(r.id) !== shiftId),
  );
  return { previous };
}

export function shiftReassignOnMutate(args: {
  qc: QueryClient;
  weekStr: string;
  shiftId: number;
  employeeId: number;
}): { previous: JsonObject[] | undefined } {
  const { qc, weekStr, shiftId, employeeId } = args;
  const key = shiftsListKey(weekStr);
  voidCancelListQuery(qc, key);
  const previous = snapshotList<JsonObject[]>(qc, key);
  qc.setQueryData<JsonObject[]>(key, (old) =>
    (old ?? []).map((row) =>
      Number(row.id) === shiftId ? { ...row, employee_id: employeeId } : row,
    ),
  );
  return { previous };
}

export type CreateShiftMutationVars = {
  shift_window_id: number;
  employee_id: number;
  syllabus_num: number;
  syllabus_role_id?: number;
  /** Best-effort row shape for immediate pill paint; week list refetches after success. */
  optimisticRow?: JsonObject | null;
};

export function shiftCreateOnMutate(args: {
  qc: QueryClient;
  weekStr: string;
  optimisticRow: JsonObject | null | undefined;
  tempIdRef: MutableRefObject<number>;
}): { previous: JsonObject[] | undefined; tempId: number | undefined } {
  const { qc, weekStr, optimisticRow, tempIdRef } = args;
  const key = shiftsListKey(weekStr);
  voidCancelListQuery(qc, key);
  const previous = snapshotList<JsonObject[]>(qc, key);
  if (!optimisticRow) {
    return { previous, tempId: undefined };
  }
  const tempId = nextNegativeTempId(tempIdRef);
  const row = normalizeShiftRow({ ...optimisticRow, id: tempId });
  qc.setQueryData<JsonObject[]>(key, (old) => sortShiftsList([...(old ?? []), row]));
  return { previous, tempId };
}

/**
 * When no existing `dayShifts` row matches the slot, build a minimal row so optimistic
 * cache updates still drive the window-row manned tint and employee pill on the same frame.
 */
export function buildSyntheticOptimisticShiftRowForCreate(args: {
  dateStr: string;
  shift_window_id: number;
  employee_id: number;
  syllabus_num: number;
  syllabus_role_id?: number;
  highlightStartMs: number;
  highlightEndMs: number;
  shiftWindow: JsonObject | undefined;
  durationByPreset: Map<number, number>;
  presets: JsonObject[];
  empName: string;
}): JsonObject | null {
  const ty = args.shiftWindow;
  if (!ty) return null;
  const { base } = shiftTypePillColors(String(ty.color ?? "#7BA3B5"));
  const { segments } = windowDayTimeline(args.dateStr, ty, args.durationByPreset, base);
  const seg = segments.find((s) => s.syllabusNum === args.syllabus_num);
  if (!seg) return null;

  const preset = args.presets.find((p) => Number(p.id) === seg.presetId);
  const durationMinutes = args.durationByPreset.get(seg.presetId) ?? 60;
  const prepM = Number(preset?.prep_minutes ?? preset?.prepMinutes ?? 0) || 0;
  const restM = Number(preset?.rest_minutes ?? preset?.restMinutes ?? 0) || 0;

  const roles = presetSyllabusRolesSorted(preset);
  let syllabusRoleId: number | undefined = args.syllabus_role_id;
  if (syllabusRoleId == null && roles.length === 1) {
    syllabusRoleId = Number(roles[0].id);
  }
  const roleRow =
    syllabusRoleId != null && Number.isFinite(syllabusRoleId)
      ? roles.find((r) => Number(r.id) === syllabusRoleId)
      : undefined;
  const syllabus_role_name = roleRow ? String(roleRow.name ?? "").trim() : "";

  const start_time = formatLocalHmFromMs(args.highlightStartMs);
  const end_time = formatLocalHmFromMs(args.highlightEndMs);

  const row: JsonObject = {
    shift_date: args.dateStr,
    shift_window_id: args.shift_window_id,
    employee_id: args.employee_id,
    syllabus_num: args.syllabus_num,
    syllabus_preset_id: seg.presetId,
    start_time,
    end_time,
    type_name: String(ty.name ?? ""),
    type_color: String(ty.color ?? "#7BA3B5"),
    duration_minutes: durationMinutes,
    prep_minutes: prepM,
    rest_minutes: restM,
    emp_name: args.empName,
    up_to_date: true,
  };
  if (syllabusRoleId != null && Number.isFinite(syllabusRoleId)) {
    row.syllabus_role_id = syllabusRoleId;
  }
  if (syllabus_role_name) row.syllabus_role_name = syllabus_role_name;
  if (roleRow) {
    row.syllabus_role_sort_order = Number(roleRow.sort_order ?? roleRow.sortOrder ?? 0);
  }
  return row;
}

/**
 * Template for optimistic shift: same window/syllabus/(role) on `dateStr`, any employee.
 * Returns null if none (first fill of slot).
 */
export function buildOptimisticShiftRowTemplate(
  dayShifts: JsonObject[],
  dateStr: string,
  vars: {
    shift_window_id: number;
    employee_id: number;
    syllabus_num: number;
    syllabus_role_id?: number;
  },
): JsonObject | null {
  const wid = vars.shift_window_id;
  const sn = vars.syllabus_num;
  const srid = vars.syllabus_role_id;
  const template = dayShifts.find((s) => {
    if (String(s.shift_date) !== dateStr) return false;
    if (Number(s.shift_window_id ?? s.shiftWindowId) !== wid) return false;
    if (Number(s.syllabus_num ?? s.syllabusNum) !== sn) return false;
    if (srid != null) {
      return Number(s.syllabus_role_id ?? s.syllabusRoleId) === srid;
    }
    return true;
  });
  if (!template) return null;
  return {
    ...template,
    employee_id: vars.employee_id,
    shift_date: dateStr,
    up_to_date: true,
  };
}
