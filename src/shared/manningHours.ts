import type { JsonObject } from "./api";

export function timeToMin(t: string): number {
  const parts = String(t).trim().split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/** True if [hourLabel, hourLabel+1h) intersects shift [start, end) (handles midnight-crossing end). */
export function shiftCoversHour(start: string, end: string, hourLabel: string): boolean {
  const hMin = timeToMin(hourLabel);
  const sm = timeToMin(start);
  const em = timeToMin(end);
  if (em <= sm) return hMin >= sm || hMin < em;
  return hMin >= sm && hMin < em;
}

export function coverageOf(st: JsonObject): { start: string; end: string } {
  return {
    start: String(st.coverage_start ?? st.coverageStart ?? ""),
    end: String(st.coverage_end ?? st.coverageEnd ?? ""),
  };
}

/** Parse local wall time from ISO without timezone (YYYY-MM-DDTHH:mm[:ss]). */
export function parseIsoLocal(iso: string): Date {
  const [d, t = "00:00:00"] = iso.trim().split("T");
  const [yy, mm, dd] = d.split("-").map((x) => parseInt(x, 10));
  const tp = t.split(/[:.]/);
  const hh = parseInt(tp[0] ?? "0", 10);
  const mi = parseInt(tp[1] ?? "0", 10);
  const sc = parseInt(tp[2] ?? "0", 10);
  return new Date(yy, mm - 1, dd, hh, mi, sc);
}

export function dayBounds(dateStr: string): { start: Date; endExcl: Date } {
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const endExcl = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { start, endExcl };
}

/** Intersection of coverage window with calendar day [00:00, next 00:00). */
export function intersectCoverageOnDay(
  dateStr: string,
  coverageStartIso: string,
  coverageEndIso: string,
): { start: Date; end: Date } | null {
  const { start: ds, endExcl: de } = dayBounds(dateStr);
  const cs = parseIsoLocal(coverageStartIso).getTime();
  const ce = parseIsoLocal(coverageEndIso).getTime();
  const s = Math.max(cs, ds.getTime());
  const e = Math.min(ce, de.getTime());
  if (e <= s) return null;
  return { start: new Date(s), end: new Date(e) };
}

/** Hour labels `HH:00` whose [hour, hour+1) intersects [start, end). */
export function hourSlotsInWindow(start: Date, end: Date): string[] {
  const out: string[] = [];
  const endMs = end.getTime();
  const t = new Date(start);
  t.setMinutes(0, 0, 0);
  if (t.getTime() + 3600_000 <= start.getTime()) {
    t.setHours(t.getHours() + 1);
  }
  while (t.getTime() < endMs) {
    out.push(`${String(t.getHours()).padStart(2, "0")}:00`);
    t.setHours(t.getHours() + 1);
  }
  return out;
}

export function unionHourSlotsForDay(dateStr: string, types: JsonObject[]): string[] {
  const set = new Set<string>();
  for (const ty of types) {
    const { start, end } = coverageOf(ty);
    const w = intersectCoverageOnDay(dateStr, start, end);
    if (!w) continue;
    for (const h of hourSlotsInWindow(w.start, w.end)) set.add(h);
  }
  const list = [...set];
  list.sort((a, b) => timeToMin(a) - timeToMin(b));
  return list;
}

export function hourSlotsForTypeOnDay(ty: JsonObject, dateStr: string): string[] {
  const { start, end } = coverageOf(ty);
  const w = intersectCoverageOnDay(dateStr, start, end);
  if (!w) return [];
  return hourSlotsInWindow(w.start, w.end);
}

export function typesCoveringHourSlot(
  types: JsonObject[],
  dateStr: string,
  hourLabel: string,
): JsonObject[] {
  const { start: d0 } = dayBounds(dateStr);
  const hm = timeToMin(hourLabel);
  const slotStart = d0.getTime() + hm * 60_000;
  const slotEnd = slotStart + 3600_000;
  return types.filter((ty) => {
    const { start, end } = coverageOf(ty);
    const w = intersectCoverageOnDay(dateStr, start, end);
    if (!w) return false;
    return slotStart < w.end.getTime() && slotEnd > w.start.getTime();
  });
}
