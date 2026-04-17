import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import type { JsonObject } from "../../../shared/api";
import { normalizeShiftRow } from "./scheduleShiftModel";

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
  sortedEmployees: JsonObject[];
  employees: JsonObject[];
  clearCreateUi: () => void;
}): { previous: JsonObject[] | undefined; tempId: number } {
  const {
    qc,
    weekStr,
    payload,
    tempIdRef,
    sortedEmployees,
    employees,
    clearCreateUi,
  } = args;
  const key = scheduleEventsListKey(weekStr);
  voidCancelListQuery(qc, key);
  const previous = snapshotList<JsonObject[]>(qc, key);
  const tempId = nextNegativeTempId(tempIdRef);
  const eid = Number(payload.employee_id);
  const emp =
    sortedEmployees.find((x) => Number(x.id) === eid) ??
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
}): { previous: JsonObject[] | undefined; shiftId: number } {
  const { qc, weekStr, shiftId, employeeId } = args;
  const key = shiftsListKey(weekStr);
  voidCancelListQuery(qc, key);
  const previous = snapshotList<JsonObject[]>(qc, key);
  qc.setQueryData<JsonObject[]>(key, (old) =>
    (old ?? []).map((row) =>
      Number(row.id) === shiftId ? { ...row, employee_id: employeeId } : row,
    ),
  );
  return { previous, shiftId };
}

/**
 * Server may adjust prep/rest after reassign; UI shows old times until optional delayed refetch.
 * Call from `onSuccess` if you want DB-accurate prep/rest without immediate invalidate jitter.
 */
export function scheduleDelayedShiftsRefetch(qc: QueryClient, weekStr: string, ms = 2000) {
  window.setTimeout(() => {
    void qc.invalidateQueries({ queryKey: shiftsListKey(weekStr) });
  }, ms);
}

export function shiftReassignOnSuccess(args: {
  qc: QueryClient;
  weekStr: string;
  oldShiftId: number;
  data: JsonObject;
}) {
  const { qc, weekStr, oldShiftId, data } = args;
  const key = shiftsListKey(weekStr);
  const newId = Number(data.id);
  const row = data.row as JsonObject | undefined;
  if (row && Number.isFinite(newId)) {
    const merged = normalizeShiftRow({ ...row, id: newId });
    qc.setQueryData<JsonObject[]>(key, (old) =>
      sortShiftsList((old ?? []).map((r) => (Number(r.id) === oldShiftId ? merged : r))),
    );
  } else if (Number.isFinite(newId)) {
    qc.setQueryData<JsonObject[]>(key, (old) =>
      sortShiftsList(
        (old ?? []).map((r) => (Number(r.id) === oldShiftId ? { ...r, id: newId } : r)),
      ),
    );
  }
}

export type CreateShiftMutationVars = {
  shift_window_id: number;
  employee_id: number;
  syllabus_num: number;
  syllabus_role_id?: number;
  /** Best-effort row shape for immediate pill paint; merged with server `row` on success. */
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

export function shiftCreateOnSuccess(args: {
  qc: QueryClient;
  weekStr: string;
  data: JsonObject;
  tempId: number | undefined;
}) {
  const { qc, weekStr, data, tempId } = args;
  const key = shiftsListKey(weekStr);
  const newId = Number(data.id);
  const row = data.row as JsonObject | undefined;
  if (!Number.isFinite(newId) || !row) return;
  const merged = normalizeShiftRow({ ...row, id: newId });
  if (tempId != null) {
    qc.setQueryData<JsonObject[]>(key, (old) =>
      sortShiftsList((old ?? []).map((r) => (Number(r.id) === tempId ? merged : r))),
    );
  } else {
    qc.setQueryData<JsonObject[]>(key, (old) =>
      sortShiftsList([...(old ?? []), merged]),
    );
  }
}

/**
 * Template for optimistic shift: same window/syllabus/(role) on `dateStr`, any employee.
 * Returns null if none (first fill of slot); caller may still get `row` from API on success.
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
