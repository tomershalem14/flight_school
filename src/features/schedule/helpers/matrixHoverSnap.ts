import { wallMsToHhmm } from "../../../shared/manningHours";

const QUARTER_MS = 15 * 60 * 1000;

export function snapToNearestQuarterHour(ms: number): number {
  return Math.round(ms / QUARTER_MS) * QUARTER_MS;
}

/** Keep snapped instant inside the matrix frame (treats `frameEndMs` as exclusive upper bound). */
export function clampMsToMatrixFrame(
  ms: number,
  frameStartMs: number,
  frameEndMs: number,
): number {
  const hi = Math.max(frameStartMs, frameEndMs - 1);
  return Math.min(Math.max(ms, frameStartMs), hi);
}

export function formatLocalHmFromMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function isPointerOverMatrixTimeGrid(
  clientX: number,
  clientY: number,
  hourStripTh: HTMLElement,
  table: HTMLElement,
): boolean {
  const hr = hourStripTh.getBoundingClientRect();
  const tr = table.getBoundingClientRect();
  if (clientY < hr.top || clientY > tr.bottom) return false;
  return clientX >= hr.left && clientX <= hr.right;
}

/**
 * Position along timeline 0 = frame start (inline-start), 1 = frame end.
 * `clientX` is clamped to the strip rect so drags toward later time in RTL (physical
 * movement toward inline-start / often left) still map when the pointer sits on the
 * sticky name column edge or barely outside the `<th>` box.
 */
export function timelineUFromPointerInHourStrip(
  clientX: number,
  hourStripTh: HTMLElement,
): number {
  const r = hourStripTh.getBoundingClientRect();
  const w = r.width || 1;
  const clampedX = Math.min(r.right, Math.max(r.left, clientX));
  const rtl = getComputedStyle(hourStripTh).direction === "rtl";
  const u = rtl ? (r.right - clampedX) / w : (clampedX - r.left) / w;
  return Math.min(1, Math.max(0, u));
}

export type MatrixFrameBounds = { frameStartMs: number; frameEndMs: number };

/** Snapped-to-quarter + clamped wall time from pointer X on the hour strip; null if outside strip or invalid range. */
export function clientXToSnappedMatrixMs(
  clientX: number,
  hourStripTh: HTMLElement,
  frame: MatrixFrameBounds,
  matrixRangeMs: number,
): number | null {
  if (matrixRangeMs <= 0 || frame.frameEndMs <= frame.frameStartMs) return null;
  const u = timelineUFromPointerInHourStrip(clientX, hourStripTh);
  const rawMs = frame.frameStartMs + u * matrixRangeMs;
  return clampMsToMatrixFrame(
    snapToNearestQuarterHour(rawMs),
    frame.frameStartMs,
    frame.frameEndMs,
  );
}

export function normalizeRangeMs(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

/** First / last quarter-snapped instants inside the matrix frame (same basis as `clientXToSnappedMatrixMs` at u=0 / u=1). */
export function matrixFrameSnappedEdges(frame: MatrixFrameBounds): {
  earliestMs: number;
  latestMs: number;
} {
  const { frameStartMs, frameEndMs } = frame;
  const earliestMs = clampMsToMatrixFrame(
    snapToNearestQuarterHour(frameStartMs),
    frameStartMs,
    frameEndMs,
  );
  const latestMs = clampMsToMatrixFrame(
    snapToNearestQuarterHour(frameEndMs),
    frameStartMs,
    frameEndMs,
  );
  return { earliestMs, latestMs };
}

/**
 * Persisted wall `HH:mm` for schedule_events when dragging a matrix range.
 * Touches matrix inline-start / inline-end → calendar `00:00` / `23:59`.
 * If the end would otherwise be `00:00` (next-day boundary / slot-end label), coerce to `23:59`.
 */
export function matrixRangePersistTimes(
  dateStr: string,
  lo: number,
  hi: number,
  frame: MatrixFrameBounds,
): { persistStartHm: string; persistEndHm: string } {
  const { earliestMs, latestMs } = matrixFrameSnappedEdges(frame);
  let persistStartHm = wallMsToHhmm(dateStr, lo);
  let persistEndHm = wallMsToHhmm(dateStr, hi);
  if (lo === earliestMs) persistStartHm = "00:00";
  if (hi === latestMs) persistEndHm = "23:59";
  if (persistEndHm === "00:00") persistEndHm = "23:59";
  return { persistStartHm, persistEndHm };
}

export function matrixRangeDayEdgeFlags(
  dateStr: string,
  lo: number,
  hi: number,
  frame: MatrixFrameBounds,
): { showStartContinuation: boolean; showEndContinuation: boolean } {
  const { persistStartHm, persistEndHm } = matrixRangePersistTimes(
    dateStr,
    lo,
    hi,
    frame,
  );
  return {
    showStartContinuation: persistStartHm === "00:00",
    showEndContinuation: persistEndHm === "23:59",
  };
}

/** Popup segment labels: day-edge copy vs `HH:mm`. */
export function formatMatrixEventPersistHmForPopup(
  hm: string,
  which: "start" | "end",
): string {
  const t = hm.trim().slice(0, 5);
  if (which === "start" && t === "00:00") return "תחילת היום";
  if (which === "end" && t === "23:59") return "סוף היום";
  return t.length === 5 ? t : hm.trim();
}

/** Tbody row index for an employee row under the pointer, or null if not over an employee data row. */
export function employeeTbodyRowIndexFromPoint(
  clientX: number,
  clientY: number,
  table: HTMLTableElement,
  employeeRowCount: number,
): number | null {
  if (employeeRowCount <= 0) return null;
  const tbody = table.tBodies[0];
  if (!tbody) return null;
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    if (!(node instanceof Element)) continue;
    const row = node.closest("tr");
    if (!row || row.parentElement !== tbody) continue;
    const idx = Array.prototype.indexOf.call(tbody.rows, row);
    if (idx >= 0 && idx < employeeRowCount) return idx;
  }
  return null;
}

/**
 * When true, skip the matrix hover guide entirely (no label, no line): pointer is on a
 * matrix pill (employee shift or type-slot) or on a shift-window (type) tbody row.
 * Assumes tbody row order is employees, then shift-window rows, then the footer add row.
 */
export function shouldSuppressMatrixHoverGuide(
  clientX: number,
  clientY: number,
  table: HTMLTableElement,
  employeeRowCount: number,
): boolean {
  const tbody = table.tBodies[0];
  if (!tbody) return false;
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    if (!(node instanceof Element)) continue;
    if (node.closest("[data-matrix-pill]") != null) return true;
    if (node.closest("[data-matrix-schedule-event]") != null) return true;
    const row = node.closest("tr");
    if (!row || row.parentElement !== tbody) continue;
    const idx = Array.prototype.indexOf.call(tbody.rows, row);
    if (idx >= employeeRowCount && idx < tbody.rows.length - 1) return true;
    if (idx >= 0 && idx < employeeRowCount) return false;
  }
  return false;
}
