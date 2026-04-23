import type { JsonObject } from "../../../shared/api";
import {
  shiftWallIntervalMs,
  wallIntervalsOverlap,
  clipIntervalToFrame,
} from "../../../shared/manningHours";
import { shiftIsUpToDate } from "./scheduleShiftModel";
import type { ActiveDragHighlightMs } from "./scheduleTypes";

/** True if `employeeId` has an assigned shift whose wall interval overlaps `[intervalStartMs, intervalEndMs)`. */
export function employeeHasShiftIntersectingInterval(
  dateStr: string,
  dayShifts: JsonObject[],
  employeeId: number,
  intervalStartMs: number,
  intervalEndMs: number,
  excludeShiftId?: number,
  opts?: { ignoreStaleShifts?: boolean },
): boolean {
  for (const s of dayShifts) {
    if (excludeShiftId != null && Number(s.id) === excludeShiftId) continue;
    if (opts?.ignoreStaleShifts && !shiftIsUpToDate(s)) continue;
    const se = s.employee_id;
    if (se === null || se === undefined || se === "") continue;
    if (Number(se) !== employeeId) continue;
    const iv = shiftWallIntervalMs(dateStr, String(s.start_time), String(s.end_time));
    if (wallIntervalsOverlap(iv.startMs, iv.endMs, intervalStartMs, intervalEndMs)) {
      return true;
    }
  }
  return false;
}

/** True if `employeeId` has an observation whose linked shift wall interval overlaps the interval. */
export function employeeHasObservationIntersectingInterval(
  dateStr: string,
  dayObservations: JsonObject[],
  shiftById: ReadonlyMap<number, JsonObject>,
  employeeId: number,
  intervalStartMs: number,
  intervalEndMs: number,
  excludeObservationId?: number,
): boolean {
  for (const ob of dayObservations) {
    if (excludeObservationId != null && Number(ob.id) === excludeObservationId) continue;
    const oe = ob.employee_id ?? ob.employeeId;
    if (oe === null || oe === undefined || oe === "") continue;
    if (Number(oe) !== employeeId) continue;
    const sid = Number(ob.shift_id ?? ob.shiftId);
    const s = shiftById.get(sid);
    if (!s) continue;
    const iv = shiftWallIntervalMs(dateStr, String(s.start_time), String(s.end_time));
    if (wallIntervalsOverlap(iv.startMs, iv.endMs, intervalStartMs, intervalEndMs)) {
      return true;
    }
  }
  return false;
}

/** Shifts and/or observations on the same wall-clock band (matrix DnD conflict). */
export function employeeHasShiftOrObservationIntersectingInterval(
  dateStr: string,
  dayShifts: JsonObject[],
  dayObservations: JsonObject[],
  employeeId: number,
  intervalStartMs: number,
  intervalEndMs: number,
  opts?: {
    excludeShiftId?: number;
    excludeObservationId?: number;
    ignoreStaleShifts?: boolean;
  },
): boolean {
  if (
    employeeHasShiftIntersectingInterval(
      dateStr,
      dayShifts,
      employeeId,
      intervalStartMs,
      intervalEndMs,
      opts?.excludeShiftId,
      opts?.ignoreStaleShifts ? { ignoreStaleShifts: true } : undefined,
    )
  ) {
    return true;
  }
  const shiftById = new Map<number, JsonObject>(dayShifts.map((s) => [Number(s.id), s]));
  return employeeHasObservationIntersectingInterval(
    dateStr,
    dayObservations,
    shiftById,
    employeeId,
    intervalStartMs,
    intervalEndMs,
    opts?.excludeObservationId,
  );
}

export function matrixDragBandPercents(
  range: ActiveDragHighlightMs,
  frame: { frameStartMs: number; frameEndMs: number },
): { startPct: number; widthPct: number } | null {
  const clipped = clipIntervalToFrame(
    range.startMs,
    range.endMs,
    frame.frameStartMs,
    frame.frameEndMs,
  );
  if (!clipped) return null;
  const [s, e] = clipped;
  const rangeMs = frame.frameEndMs - frame.frameStartMs;
  if (rangeMs <= 0) return null;
  return {
    startPct: ((s - frame.frameStartMs) / rangeMs) * 100,
    widthPct: ((e - s) / rangeMs) * 100,
  };
}

/** Compact rect for console diagnostics (dnd-kit / getBoundingClientRect shapes). */
export function summarizeMatrixDndRectForLog(
  r: { top: number; left: number; width: number; height: number } | null | undefined,
) {
  if (r == null) return null;
  return {
    top: Math.round(r.top),
    left: Math.round(r.left),
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
}
