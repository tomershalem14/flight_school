import { dayBounds, timeToMin } from "../../../shared/manningHours";
import type { MatrixFrameBounds } from "./matrixHoverSnap";
import {
  clampMsToMatrixFrame,
  matrixRangePersistTimes,
} from "./matrixHoverSnap";

const MIN_EVENT_MS = 15 * 60 * 1000;

/** Same-calendar-day wall interval in epoch ms (events do not cross midnight). */
export function scheduleEventWallIntervalMsSameDay(
  dateStr: string,
  startHm: string,
  endHm: string,
): { startMs: number; endMs: number } {
  const d0 = dayBounds(dateStr).start.getTime();
  const sm = timeToMin(startHm);
  const em = timeToMin(endHm);
  return { startMs: d0 + sm * 60_000, endMs: d0 + em * 60_000 };
}

/**
 * Apply one resize step from a matrix-snapped pointer instant; clamp 15 min minimum
 * and matrix frame; return layout ms + persisted `HH:mm` (day-edge rules).
 */
export function clampScheduleEventResizeToPersist(
  dateStr: string,
  frame: MatrixFrameBounds,
  edge: "start" | "end",
  snappedMs: number,
  startHm: string,
  endHm: string,
): { loMs: number; hiMs: number; persistStartHm: string; persistEndHm: string } {
  const { startMs: curStart, endMs: curEnd } = scheduleEventWallIntervalMsSameDay(
    dateStr,
    startHm,
    endHm,
  );
  const snappedClamped = clampMsToMatrixFrame(
    snappedMs,
    frame.frameStartMs,
    frame.frameEndMs,
  );
  const hiWall = Math.max(frame.frameStartMs, frame.frameEndMs - 1);

  let newStart = curStart;
  let newEnd = curEnd;

  if (edge === "start") {
    newStart = snappedClamped;
    const maxStart = curEnd - MIN_EVENT_MS;
    if (newStart > maxStart) newStart = maxStart;
    const dayStart = dayBounds(dateStr).start.getTime();
    if (newStart < dayStart) newStart = dayStart;
  } else {
    newEnd = snappedClamped;
    const minEnd = curStart + MIN_EVENT_MS;
    if (newEnd < minEnd) newEnd = minEnd;
    if (newEnd > hiWall) {
      if (minEnd <= hiWall) newEnd = hiWall;
      else newEnd = curEnd;
    }
  }

  const lo = Math.min(newStart, newEnd);
  const hi = Math.max(newStart, newEnd);
  const persist = matrixRangePersistTimes(dateStr, lo, hi, frame);
  return {
    loMs: lo,
    hiMs: hi,
    persistStartHm: persist.persistStartHm,
    persistEndHm: persist.persistEndHm,
  };
}
