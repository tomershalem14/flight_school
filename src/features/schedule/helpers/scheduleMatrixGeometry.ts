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
