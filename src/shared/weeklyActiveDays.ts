import type { JsonObject } from "./api";

export const DEFAULT_DAYS_IN_SCHOOL = 4;
export const DEFAULT_ACTIVE_DAYS_MASK = 31;

/** א..ש = Sunday (0) .. Saturday (6) offsets from `weeklyWeekStart`. */
export const HEBREW_DAY_SEGMENTS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"] as const;

/** Days from `weekStartYmd` (Sunday) to `ymd`; integer 0..6 inside the same week, else null. Local calendar dates. */
export function dayOffsetInWeek(weekStartYmd: string, ymd: string): number | null {
  const pa = weekStartYmd.split("-").map(Number);
  const pb = ymd.split("-").map(Number);
  if (pa.length !== 3 || pb.length !== 3) return null;
  const [ya, ma, da] = pa;
  const [yb, mb, db] = pb;
  if (![ya, ma, da, yb, mb, db].every((n) => Number.isFinite(n))) return null;
  const a = new Date(ya, ma - 1, da).getTime();
  const b = new Date(yb, mb - 1, db).getTime();
  const diff = Math.round((b - a) / 86_400_000);
  if (diff < 0 || diff > 6) return null;
  return diff;
}

export function isDayActive(mask: number, d: number): boolean {
  if (d < 0 || d > 6) return false;
  return ((mask >> d) & 1) === 1;
}

export function activeDayIndices(mask: number): number[] {
  const out: number[] = [];
  for (let d = 0; d <= 6; d += 1) {
    if (isDayActive(mask, d)) out.push(d);
  }
  return out;
}

/** Toggle bit `d`; returns unchanged `mask` if that would clear the last active day. */
export function toggleDay(mask: number, d: number): number {
  if (d < 0 || d > 6) return mask;
  const next = mask ^ (1 << d);
  if (next === 0) return mask;
  return next;
}

export function clampActiveDaysMask(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_ACTIVE_DAYS_MASK;
  return Math.max(1, Math.min(127, Math.round(n)));
}

/**
 * Per employee: count distinct `avail_date` in the week where that calendar day
 * is an active weekday in `mask` (relative to `weekStartYmd`).
 */
export function countAvailabilityOnActiveDays(
  rows: JsonObject[],
  mask: number,
  weekStartYmd: string,
): Map<number, number> {
  const perEmp = new Map<number, Set<string>>();
  for (const r of rows) {
    const eid = Number(r.employee_id ?? 0);
    const ymd = String(r.avail_date ?? "").trim();
    if (!eid || !ymd) continue;
    const off = dayOffsetInWeek(weekStartYmd, ymd);
    if (off == null || !isDayActive(mask, off)) continue;
    if (!perEmp.has(eid)) perEmp.set(eid, new Set());
    perEmp.get(eid)!.add(ymd);
  }
  const counts = new Map<number, number>();
  for (const [eid, set] of perEmp) counts.set(eid, set.size);
  return counts;
}
