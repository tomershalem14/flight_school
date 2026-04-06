import type { JsonObject } from "./api";
import { coverageIsoToHm, formatTimeForInput } from "./timeFormat";

const MINUTES_PER_DAY = 24 * 60;

export function timeToMin(t: string): number {
  const parts = String(t).trim().split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/** Wall-clock HH:mm from minutes since midnight (0..1440 wrapped), matches backend `minutes_to_hhmm`. */
export function minutesToHhmm(totalMinutes: number): string {
  const m = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Add minutes to an HH:mm[:ss] wall time (modulo one day on the clock). */
export function hmAddMinutes(hm: string, deltaMinutes: number): string {
  return minutesToHhmm(timeToMin(hm) + deltaMinutes);
}

export type PrepRestHmPair = { startHm: string; endHm: string };

/** Resolved prep/rest window ends for matrix bands (API fields + fallback from preset minutes). */
export function shiftPrepRestHmPairs(shift: JsonObject): {
  prep: PrepRestHmPair | null;
  rest: PrepRestHmPair | null;
} {
  const psRaw = shift.prep_start ?? shift.prepStart;
  const reRaw = shift.rest_end ?? shift.restEnd;
  if (psRaw == null || reRaw == null) return { prep: null, rest: null };
  const prepStart = String(psRaw).trim();
  const restEnd = String(reRaw).trim();
  if (!prepStart || prepStart === "—" || !restEnd || restEnd === "—") {
    return { prep: null, rest: null };
  }

  const prepM = Math.max(0, Number(shift.prep_minutes ?? shift.prepMinutes ?? 0));
  const restM = Math.max(0, Number(shift.rest_minutes ?? shift.restMinutes ?? 0));

  const peRaw = shift.prep_end ?? shift.prepEnd;
  const prepEnd =
    peRaw != null && String(peRaw).trim() !== "" && String(peRaw).trim() !== "—"
      ? String(peRaw).trim()
      : hmAddMinutes(prepStart, prepM);

  const rsRaw = shift.rest_start ?? shift.restStart;
  const restStart =
    rsRaw != null && String(rsRaw).trim() !== "" && String(rsRaw).trim() !== "—"
      ? String(rsRaw).trim()
      : hmAddMinutes(restEnd, -restM);

  const prep: PrepRestHmPair | null =
    prepM <= 0 || timeToMin(prepStart) === timeToMin(prepEnd)
      ? null
      : { startHm: prepStart, endHm: prepEnd };

  const rest: PrepRestHmPair | null =
    restM <= 0 || timeToMin(restStart) === timeToMin(restEnd)
      ? null
      : { startHm: restStart, endHm: restEnd };

  return { prep, rest };
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

/** Wall-clock interval for a shift on `dateStr` (handles end before start as next day). */
export function shiftWallIntervalMs(
  dateStr: string,
  startHm: string,
  endHm: string,
): { startMs: number; endMs: number } {
  const d0 = dayBounds(dateStr).start.getTime();
  const sm = timeToMin(startHm);
  const em = timeToMin(endHm);
  const startMs = d0 + sm * 60_000;
  let endMs = d0 + em * 60_000;
  if (em <= sm) {
    endMs += 24 * 3600_000;
  }
  return { startMs, endMs };
}

/** Half-open wall intervals [a0,a1) and [b0,b1) overlap with positive duration. */
export function wallIntervalsOverlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): boolean {
  return a1 > a0 && b1 > b0 && Math.max(a0, b0) < Math.min(a1, b1);
}

export function clipIntervalToFrame(
  startMs: number,
  endMs: number,
  frameStart: number,
  frameEnd: number,
): [number, number] | null {
  const s = Math.max(startMs, frameStart);
  const e = Math.min(endMs, frameEnd);
  if (e <= s) return null;
  return [s, e];
}

export function effectiveMatrixFrame(
  dateStr: string,
  hours: string[],
  frame: { frameStartMs: number; frameEndMs: number } | null,
): { frameStartMs: number; frameEndMs: number } | null {
  if (frame) return frame;
  if (hours.length === 0) return null;
  const d0 = dayBounds(dateStr).start.getTime();
  const sm = timeToMin(hours[0]!);
  const em = timeToMin(hours[hours.length - 1]!) + 60;
  return { frameStartMs: d0 + sm * 60_000, frameEndMs: d0 + em * 60_000 };
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

export function parseSlotPresetIdsFromWindow(w: JsonObject): number[] {
  const raw = w.syllabus_slot_preset_ids ?? w.syllabusSlotPresetIds;
  const s = typeof raw === "string" ? raw : JSON.stringify(raw ?? []);
  try {
    const v = JSON.parse(s) as unknown;
    if (!Array.isArray(v)) return [];
    return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

export function presetDurationById(presets: JsonObject[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of presets) {
    m.set(Number(p.id), Number(p.duration_minutes ?? 60));
  }
  return m;
}

/** Fields from `syllabus_presets` needed for matrix start/end bunch + prep/rest sums. */
export type MatrixStartPresetMeta = {
  maxInRow: number;
  jointPrep: boolean;
  prepMinutes: number;
  /** When true, {@link matrixEndRestMinutesSum} charges `restMinutes` only once per preset id in the ending bunch. */
  jointRest: boolean;
  restMinutes: number;
};

function readMatrixStartPresetMeta(p: JsonObject): MatrixStartPresetMeta {
  const maxInRow = Math.max(1, Number(p.max_in_row ?? p.maxInRow ?? 1));
  const jointPrep = Number(p.joint_prep ?? p.jointPrep ?? 0) !== 0;
  const prepMinutes = Math.max(0, Number(p.prep_minutes ?? p.prepMinutes ?? 0));
  const jointRest = Number(p.joint_rest ?? p.jointRest ?? 0) !== 0;
  const restMinutes = Math.max(0, Number(p.rest_minutes ?? p.restMinutes ?? 0));
  return { maxInRow, jointPrep, prepMinutes, jointRest, restMinutes };
}

/**
 * Build preset id → meta for matrix bunch helpers and prep/rest sums.
 * Call once per day/matrix when iterating many windows.
 */
export function matrixStartPresetMetaMap(presets: JsonObject[]): Map<number, MatrixStartPresetMeta> {
  const m = new Map<number, MatrixStartPresetMeta>();
  for (const p of presets) {
    const id = Number(p.id);
    if (Number.isFinite(id)) m.set(id, readMatrixStartPresetMeta(p));
  }
  return m;
}

function defaultMetaForMissingPreset(): MatrixStartPresetMeta {
  return {
    maxInRow: 1,
    jointPrep: false,
    prepMinutes: 0,
    jointRest: false,
    restMinutes: 0,
  };
}

const DEFAULT_MAX_IN_ROW = 1;

/**
 * Prefix of `slotPresetIds` (window slot list from the start) that forms the “starting bunch”:
 * walk syllabi in order with `startingBunch` initially 1; after each prefix, let M = min(max_in_row)
 * among presets in that prefix (tracked incrementally as each slot is appended). If `startingBunch > M`,
 * decrement `startingBunch` by 1 and **stop** (break). Otherwise stop when M === `startingBunch`, or when
 * the list ends without that equality (full prefix built so far).
 */
export function matrixStartingBunchPresetIds(
  slotPresetIds: number[],
  presetMeta: Map<number, MatrixStartPresetMeta>,
): number[] {
  const iterated: number[] = [];
  let startingBunch = 1;
  /** Running min(max_in_row) over the prefix; updated in O(1) per slot (no full prefix rescan). */
  let prefixMinMaxInRow: number | null = null;
  for (let i = 0; i < slotPresetIds.length; i++) {
    const pid = slotPresetIds[i]!;
    const row = presetMeta.get(pid)?.maxInRow ?? DEFAULT_MAX_IN_ROW;
    prefixMinMaxInRow =
      prefixMinMaxInRow === null ? row : Math.min(prefixMinMaxInRow, row);
    const m = prefixMinMaxInRow;
    iterated.push(pid);
    if (startingBunch > m) {
      startingBunch -= 1;
      break;
    }
    if (m === startingBunch) {
      break;
    }
    startingBunch += 1;
  }
  return iterated;
}

/**
 * Sum prep minutes for slots in the starting bunch: each non–joint_prep slot adds its prep;
 * for joint_prep, add prep only for the first occurrence of that preset id in the bunch.
 */
export function matrixStartPrepMinutesSum(
  startingBunchPresetIds: number[],
  presetMeta: Map<number, MatrixStartPresetMeta>,
): number {
  let sum = 0;
  const jointPrepCharged = new Set<number>();
  for (const pid of startingBunchPresetIds) {
    const meta = presetMeta.get(pid) ?? defaultMetaForMissingPreset();
    if (meta.jointPrep) {
      if (!jointPrepCharged.has(pid)) {
        sum += meta.prepMinutes;
        jointPrepCharged.add(pid);
      }
    } else {
      sum += meta.prepMinutes;
    }
  }
  return sum;
}

/**
 * Suffix of `slotPresetIds` that mirrors {@link matrixStartingBunchPresetIds} on the reversed list
 * (same `max_in_row` / bunch rules, walking from the last slot backward).
 */
export function matrixEndingBunchPresetIds(
  slotPresetIds: number[],
  presetMeta: Map<number, MatrixStartPresetMeta>,
): number[] {
  if (slotPresetIds.length === 0) return [];
  const rev = [...slotPresetIds].reverse();
  const bunchRev = matrixStartingBunchPresetIds(rev, presetMeta);
  return bunchRev.reverse();
}

/**
 * Sum rest minutes for slots in the ending bunch: each non–joint_rest slot adds its rest;
 * for joint_rest, add rest only for the first occurrence of that preset id in the bunch.
 */
export function matrixEndRestMinutesSum(
  endingBunchPresetIds: number[],
  presetMeta: Map<number, MatrixStartPresetMeta>,
): number {
  let sum = 0;
  const jointRestCharged = new Set<number>();
  for (const pid of endingBunchPresetIds) {
    const meta = presetMeta.get(pid) ?? defaultMetaForMissingPreset();
    if (meta.jointRest) {
      if (!jointRestCharged.has(pid)) {
        sum += meta.restMinutes;
        jointRestCharged.add(pid);
      }
    } else {
      sum += meta.restMinutes;
    }
  }
  return sum;
}

/** Wall time on `dateStr` matching coverage_start clock (time-of-day from ISO). */
export function anchorCoverageOnDate(dateStr: string, coverageStartIso: string): Date {
  const hm = formatTimeForInput(coverageIsoToHm(coverageStartIso)) || "00:00";
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const [hh, mm] = hm.split(":").map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/**
 * Segment wall time on the coverage timeline (same day as anchor, or next calendar day if before anchor).
 */
export function segmentInstantOnDay(
  dateStr: string,
  coverageStartHm: string,
  segmentHm: string,
): number {
  const ach = formatTimeForInput(coverageStartHm) || "00:00";
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const [ah, am] = ach.split(":").map((x) => parseInt(x, 10));
  const anchor = new Date(y, m - 1, d, ah, am, 0, 0).getTime();
  const sh = formatTimeForInput(segmentHm) || "00:00";
  const [th, tm] = sh.split(":").map((x) => parseInt(x, 10));
  let seg = new Date(y, m - 1, d, th, tm, 0, 0).getTime();
  if (seg < anchor) seg += 24 * 3600_000;
  return seg;
}

/** `endHm` 00:00 with `isEndNextDay` means midnight at start of next calendar day (schedule convention). */
export function coverageEndInstantOnDay(
  dateStr: string,
  endHm: string,
  isEndNextDayMidnight: boolean,
): number {
  const sh = formatTimeForInput(endHm) || "00:00";
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const [h, mi] = sh.split(":").map((x) => parseInt(x, 10));
  if (h === 0 && mi === 0 && isEndNextDayMidnight) {
    return new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();
  }
  return new Date(y, m - 1, d, h, mi, 0, 0).getTime();
}

/** Hour labels where a materialized slot intersects the calendar-day coverage window. */
export function hourSlotsForWindowMaterializedOnDay(
  dateStr: string,
  ty: JsonObject,
  durationByPresetId: Map<number, number>,
): string[] {
  const { start, end } = coverageOf(ty);
  const w = intersectCoverageOnDay(dateStr, start, end);
  if (!w) return [];
  const slotIds = parseSlotPresetIdsFromWindow(ty);
  if (slotIds.length === 0) {
    return hourSlotsForTypeOnDay(ty, dateStr);
  }
  const anchorMs = anchorCoverageOnDate(dateStr, start).getTime();
  const wStart = w.start.getTime();
  const wEnd = w.end.getTime();
  const set = new Set<string>();
  let t = anchorMs;
  for (const pid of slotIds) {
    const dur = durationByPresetId.get(pid) ?? 60;
    const slotStart = t;
    const slotEnd = t + dur * 60_000;
    const is = Math.max(slotStart, wStart);
    const ie = Math.min(slotEnd, wEnd);
    if (ie > is) {
      for (const h of hourSlotsInWindow(new Date(is), new Date(ie))) {
        set.add(h);
      }
    }
    t = slotEnd;
  }
  const list = [...set];
  list.sort((a, b) => timeToMin(a) - timeToMin(b));
  return list;
}

/** Union of materialized slot hours for all windows; falls back to coverage-only union when empty. */
export function unionHourSlotsForDayMaterialized(
  dateStr: string,
  windows: JsonObject[],
  presets: JsonObject[],
): string[] {
  const durs = presetDurationById(presets);
  const set = new Set<string>();
  for (const w of windows) {
    for (const h of hourSlotsForWindowMaterializedOnDay(dateStr, w, durs)) {
      set.add(h);
    }
  }
  if (set.size === 0 && windows.length > 0) {
    return unionHourSlotsForDay(dateStr, windows);
  }
  const list = [...set];
  list.sort((a, b) => timeToMin(a) - timeToMin(b));
  return list;
}

/** Ceil to hour boundary measured from `dayStartMs` (e.g. 22:15 → start of 23:00 that day). */
function ceilMsToHourFromDayStart(absoluteMs: number, dayStartMs: number): number {
  const span = absoluteMs - dayStartMs;
  if (span <= 0) return dayStartMs;
  const hourMs = 3600_000;
  const hoursCeiled = Math.ceil(span / hourMs);
  return dayStartMs + hoursCeiled * hourMs;
}

/**
 * Matrix time range for the schedule: [frameStartMs, frameEndMs).
 * Start: earliest across windows of `(coverage start on day) − prepLead`, floored to a full hour,
 * then clamped to **not before** 00:00 of `dateStr`.
 * End: for each window, `(coverage end on day) + restTail` where `restTail` is the sum of rest minutes
 * for the ending bunch (see {@link matrixEndingBunchPresetIds} / {@link matrixEndRestMinutesSum});
 * then the **latest** such instant across windows, **ceiled** to the next hour (22:15 → 23:00),
 * then clamped to **at most** 00:00 the following day (exclusive cap).
 */
export function matrixFrameBoundsMs(
  dateStr: string,
  windows: JsonObject[],
  presets: JsonObject[],
): { frameStartMs: number; frameEndMs: number } | null {
  if (windows.length === 0) return null;

  const { start: dayStart, endExcl: dayEndExcl } = dayBounds(dateStr);
  const dayStartMs = dayStart.getTime();
  const dayEndExclMs = dayEndExcl.getTime();

  const meta = matrixStartPresetMetaMap(presets);
  let latestRestAwareEndMs: number | null = null;
  let earliestPrepAwareMs: number | null = null;

  for (const w of windows) {
    const { start, end } = coverageOf(w);
    const inter = intersectCoverageOnDay(dateStr, start, end);
    if (!inter) continue;

    const slots = parseSlotPresetIdsFromWindow(w);
    const startBunch = matrixStartingBunchPresetIds(slots, meta);
    const prepLead = matrixStartPrepMinutesSum(startBunch, meta);
    const t0 = inter.start.getTime() - prepLead * 60_000;
    if (earliestPrepAwareMs === null || t0 < earliestPrepAwareMs) {
      earliestPrepAwareMs = t0;
    }

    const endBunch = matrixEndingBunchPresetIds(slots, meta);
    const restTail = matrixEndRestMinutesSum(endBunch, meta);
    const t1 = inter.end.getTime() + restTail * 60_000;
    if (latestRestAwareEndMs === null || t1 > latestRestAwareEndMs) {
      latestRestAwareEndMs = t1;
    }
  }

  if (latestRestAwareEndMs === null || earliestPrepAwareMs === null) {
    return null;
  }

  const floored = new Date(earliestPrepAwareMs);
  floored.setMinutes(0, 0, 0);
  floored.setMilliseconds(0);
  const frameStartMs = Math.max(floored.getTime(), dayStartMs);

  let frameEndMs = ceilMsToHourFromDayStart(latestRestAwareEndMs, dayStartMs);
  frameEndMs = Math.min(frameEndMs, dayEndExclMs);

  if (frameStartMs >= frameEndMs) {
    return null;
  }

  return { frameStartMs, frameEndMs };
}

/**
 * Hour columns: every hour bucket from matrix frame start through frame end (see {@link matrixFrameBoundsMs}).
 */
export function matrixPrepAwareHourSlotsForDay(
  dateStr: string,
  windows: JsonObject[],
  presets: JsonObject[],
): string[] {
  const bounds = matrixFrameBoundsMs(dateStr, windows, presets);
  if (!bounds) {
    return unionHourSlotsForDayMaterialized(dateStr, windows, presets);
  }
  const list = hourSlotsInWindow(new Date(bounds.frameStartMs), new Date(bounds.frameEndMs));
  list.sort((a, b) => timeToMin(a) - timeToMin(b));
  return list;
}

/** Valid start times for segment row `rowIndex` (row 0 is fixed to coverage start). */
export function validSegmentStartTimes(
  dateStr: string,
  coverageStartHm: string,
  coverageEndHm: string,
  endIsNextDayMidnight: boolean,
  segments: { syllabus_preset_id: number; segment_start_time: string }[],
  rowIndex: number,
  durationByPresetId: Map<number, number>,
): string[] {
  if (rowIndex <= 0) {
    return [formatTimeForInput(coverageStartHm) || "06:00"];
  }
  const prev = segments[rowIndex - 1];
  if (!prev) return [];
  const prevDur = durationByPresetId.get(prev.syllabus_preset_id) ?? 60;
  const covEnd = coverageEndInstantOnDay(dateStr, coverageEndHm, endIsNextDayMidnight);
  const prevMs = segmentInstantOnDay(dateStr, coverageStartHm, prev.segment_start_time);
  const step = prevDur * 60_000;
  const out: string[] = [];
  for (let n = 1; n <= 200; n++) {
    const t = prevMs + n * step;
    if (t >= covEnd) break;
    const d = new Date(t);
    out.push(
      `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    );
  }
  return out;
}

/** Preset id → hex color for timeline pills. */
export function presetColorById(presets: JsonObject[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const p of presets) {
    m.set(Number(p.id), String(p.color ?? "#6366F1"));
  }
  return m;
}

export type WindowDaySegment = {
  syllabusNum: number;
  presetId: number;
  startMs: number;
  endMs: number;
  color: string;
};

/** Clipped materialized slots + optional tail gap before coverage end on this calendar day. */
export function windowDayTimeline(
  dateStr: string,
  ty: JsonObject,
  durationByPresetId: Map<number, number>,
  /** Shift window color (#hex); segment `color` matches this (per-slot preset colors are not used for display). */
  windowColor: string,
): { segments: WindowDaySegment[]; tailGap: { startMs: number; endMs: number } | null } {
  const { start, end } = coverageOf(ty);
  const w = intersectCoverageOnDay(dateStr, start, end);
  if (!w) return { segments: [], tailGap: null };
  const slotIds = parseSlotPresetIdsFromWindow(ty);
  const wStart = w.start.getTime();
  const wEnd = w.end.getTime();
  if (slotIds.length === 0) {
    return wEnd > wStart
      ? { segments: [], tailGap: { startMs: wStart, endMs: wEnd } }
      : { segments: [], tailGap: null };
  }
  const anchorMs = anchorCoverageOnDate(dateStr, start).getTime();
  const segments: WindowDaySegment[] = [];
  let t = anchorMs;
  let lastClipEnd = wStart;
  for (let i = 0; i < slotIds.length; i++) {
    const pid = slotIds[i];
    const dur = durationByPresetId.get(pid) ?? 60;
    const slotStart = t;
    const slotEnd = t + dur * 60_000;
    const is = Math.max(slotStart, wStart);
    const ie = Math.min(slotEnd, wEnd);
    if (ie > is) {
      segments.push({
        syllabusNum: i,
        presetId: pid,
        startMs: is,
        endMs: ie,
        color: windowColor,
      });
      lastClipEnd = Math.max(lastClipEnd, ie);
    }
    t = slotEnd;
  }
  const tailGap =
    lastClipEnd < wEnd ? { startMs: lastClipEnd, endMs: wEnd } : null;
  return { segments, tailGap };
}

/** Hour labels (HH:00) whose bucket start lies inside [startMs, endMs). */
export function hourLabelsTouchingRange(startMs: number, endMs: number): string[] {
  if (endMs <= startMs) return [];
  return hourSlotsInWindow(new Date(startMs), new Date(endMs));
}

/** 0-based slot index for the materialized slot covering this hour on `dateStr`, or null. */
export function syllabusNumForHourInWindow(
  dateStr: string,
  ty: JsonObject,
  hourLabel: string,
  durationByPresetId: Map<number, number>,
): number | null {
  const { start, end } = coverageOf(ty);
  const w = intersectCoverageOnDay(dateStr, start, end);
  if (!w) return null;
  const slotIds = parseSlotPresetIdsFromWindow(ty);
  if (slotIds.length === 0) return null;
  const anchorMs = anchorCoverageOnDate(dateStr, start).getTime();
  const wStart = w.start.getTime();
  const wEnd = w.end.getTime();
  const hMin = timeToMin(hourLabel);
  const { start: d0 } = dayBounds(dateStr);
  const probe = d0.getTime() + hMin * 60_000;
  let t = anchorMs;
  for (let i = 0; i < slotIds.length; i++) {
    const pid = slotIds[i];
    const dur = durationByPresetId.get(pid) ?? 60;
    const slotStart = t;
    const slotEnd = t + dur * 60_000;
    const is = Math.max(slotStart, wStart);
    const ie = Math.min(slotEnd, wEnd);
    if (ie > is && probe >= is && probe < ie) {
      return i;
    }
    t = slotEnd;
  }
  return null;
}
