import type { JsonObject } from "../../../shared/api";
import { parseEmployeeKind } from "../../../shared/employeeOrderSort";
import {
  clipIntervalToFrame,
  shiftCoversHour,
  shiftWallIntervalMs,
} from "../../../shared/manningHours";

export function isWholeDayAvailabilityRow(r: JsonObject): boolean {
  const st = r.start_time;
  const et = r.end_time;
  const sn = st == null || st === undefined || String(st).trim() === "";
  const en = et == null || et === undefined || String(et).trim() === "";
  return sn && en;
}

function nonRegularKindOrder(kind: string): number {
  if (kind === "admin") return 0;
  if (kind === "extra") return 1;
  if (kind === "reserve") return 2;
  return 99;
}

function availabilityForDay(
  availabilityRows: JsonObject[],
  dateStr: string,
  employeeId: number,
): JsonObject[] {
  return availabilityRows.filter(
    (r) =>
      String(r.avail_date ?? "").trim() === dateStr &&
      Number(r.employee_id ?? 0) === employeeId,
  );
}

function employeeHasAnyAvailabilityForDay(
  availabilityRows: JsonObject[],
  dateStr: string,
  employeeId: number,
): boolean {
  return availabilityForDay(availabilityRows, dateStr, employeeId).length > 0;
}

/**
 * Matrix tbody row order: all regulars (preset order from `sortedEmployees`), then
 * extra/reserve/admin who have at least one availability row that day — admin first,
 * then extra, then reserve; within type, localeCompare on display name.
 */
export function buildMatrixEmployeeRows(
  sortedEmployees: JsonObject[],
  employees: JsonObject[],
  availabilityRows: JsonObject[],
  dateStr: string,
): JsonObject[] {
  const regulars = sortedEmployees.filter(
    (e) => parseEmployeeKind(e.employee_type) === "regular",
  );
  const nonRegularPool = employees.filter((e) => {
    const k = parseEmployeeKind(e.employee_type);
    return k === "extra" || k === "reserve" || k === "admin";
  });
  const withAvail = nonRegularPool.filter((e) =>
    employeeHasAnyAvailabilityForDay(availabilityRows, dateStr, Number(e.id)),
  );
  withAvail.sort((a, b) => {
    const ka = parseEmployeeKind(a.employee_type);
    const kb = parseEmployeeKind(b.employee_type);
    const oa = nonRegularKindOrder(ka);
    const ob = nonRegularKindOrder(kb);
    if (oa !== ob) return oa - ob;
    const na = String(a.name ?? "").trim();
    const nb = String(b.name ?? "").trim();
    return na.localeCompare(nb, undefined, { sensitivity: "base" });
  });
  return [...regulars, ...withAvail];
}

/** Hour labels enabled for matrix interaction that day (union of whole-day + timed rows). */
export function enabledHourSet(hours: string[], dayRows: JsonObject[]): Set<string> {
  const out = new Set<string>();
  if (dayRows.some(isWholeDayAvailabilityRow)) {
    for (const h of hours) out.add(h);
    return out;
  }
  for (const row of dayRows) {
    if (isWholeDayAvailabilityRow(row)) continue;
    const start = String(row.start_time ?? "").trim();
    const end = String(row.end_time ?? "").trim();
    if (!start || !end) continue;
    for (const h of hours) {
      if (shiftCoversHour(start, end, h)) out.add(h);
    }
  }
  return out;
}

function mergeSortedIntervals(segments: Array<[number, number]>): Array<[number, number]> {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  let [cs, ce] = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i]!;
    if (s <= ce) ce = Math.max(ce, e);
    else {
      out.push([cs, ce]);
      cs = s;
      ce = e;
    }
  }
  out.push([cs, ce]);
  return out;
}

/**
 * Union of enabled wall-time intervals for the day, clipped to the matrix frame.
 */
export function enabledWallIntervalsMs(
  dateStr: string,
  dayRows: JsonObject[],
  frameStartMs: number,
  frameEndMs: number,
): Array<[number, number]> {
  if (frameEndMs <= frameStartMs) return [];
  if (dayRows.some(isWholeDayAvailabilityRow)) {
    const c = clipIntervalToFrame(
      frameStartMs,
      frameEndMs,
      frameStartMs,
      frameEndMs,
    );
    return c ? [c] : [];
  }
  const raw: Array<[number, number]> = [];
  for (const row of dayRows) {
    if (isWholeDayAvailabilityRow(row)) continue;
    const start = String(row.start_time ?? "").trim();
    const end = String(row.end_time ?? "").trim();
    if (!start || !end) continue;
    const iv = shiftWallIntervalMs(dateStr, start, end);
    const clipped = clipIntervalToFrame(
      iv.startMs,
      iv.endMs,
      frameStartMs,
      frameEndMs,
    );
    if (clipped) raw.push(clipped);
  }
  return mergeSortedIntervals(raw);
}

export function msWithinEnabledUnion(
  ms: number,
  merged: Array<[number, number]>,
): boolean {
  for (const [s, e] of merged) {
    if (ms >= s && ms < e) return true;
  }
  return false;
}

/**
 * Intersect [loMs, hiMs] with the enabled union; if several disjoint overlaps, return the longest.
 * `mergedEnabled` must be sorted merged half-open intervals. Returns null if empty or invalid.
 */
export function clipRangeToLongestEnabledSubinterval(
  loMs: number,
  hiMs: number,
  mergedEnabled: Array<[number, number]>,
): { loMs: number; hiMs: number } | null {
  const lo = Math.min(loMs, hiMs);
  const hi = Math.max(loMs, hiMs);
  if (!(hi > lo)) return null;
  let bestLo = 0;
  let bestHi = 0;
  let bestDur = 0;
  for (const [s, e] of mergedEnabled) {
    const a = Math.max(lo, s);
    const b = Math.min(hi, e);
    const dur = b - a;
    if (dur > bestDur) {
      bestDur = dur;
      bestLo = a;
      bestHi = b;
    }
  }
  if (bestDur <= 0) return null;
  return { loMs: bestLo, hiMs: bestHi };
}

export function buildEnabledHoursByEmployeeId(
  matrixEmployees: JsonObject[],
  availabilityRows: JsonObject[],
  dateStr: string,
  hours: string[],
): Map<number, Set<string>> {
  const m = new Map<number, Set<string>>();
  for (const emp of matrixEmployees) {
    const eid = Number(emp.id);
    const dayRows = availabilityForDay(availabilityRows, dateStr, eid);
    m.set(eid, enabledHourSet(hours, dayRows));
  }
  return m;
}

export function buildEnabledWallIntervalsByEmployeeId(
  matrixEmployees: JsonObject[],
  availabilityRows: JsonObject[],
  dateStr: string,
  frameStartMs: number,
  frameEndMs: number,
): Map<number, Array<[number, number]>> {
  const m = new Map<number, Array<[number, number]>>();
  for (const emp of matrixEmployees) {
    const eid = Number(emp.id);
    const dayRows = availabilityForDay(availabilityRows, dateStr, eid);
    m.set(
      eid,
      enabledWallIntervalsMs(dateStr, dayRows, frameStartMs, frameEndMs),
    );
  }
  return m;
}
