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

/** Position along timeline 0 = frame start (inline-start), 1 = frame end; null if outside horizontal strip. */
export function timelineUFromPointerInHourStrip(
  clientX: number,
  hourStripTh: HTMLElement,
): number | null {
  const r = hourStripTh.getBoundingClientRect();
  const w = r.width || 1;
  if (clientX < r.left || clientX > r.right) return null;
  const rtl = getComputedStyle(hourStripTh).direction === "rtl";
  const u = rtl ? (r.right - clientX) / w : (clientX - r.left) / w;
  return Math.min(1, Math.max(0, u));
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
  const hit = document.elementFromPoint(clientX, clientY);
  if (!(hit instanceof Element)) return false;
  if (hit.closest("[data-matrix-pill]") != null) return true;
  const row = hit.closest("tr");
  const tbody = table.tBodies[0];
  if (!row || !tbody || row.parentElement !== tbody) return false;
  const idx = Array.prototype.indexOf.call(tbody.rows, row);
  return idx >= employeeRowCount && idx < tbody.rows.length - 1;
}
