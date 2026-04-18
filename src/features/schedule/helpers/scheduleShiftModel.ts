import type { JsonObject } from "../../../shared/api";
import { DEFAULT_SHIFT_TYPE_PASTEL_HEX } from "../../../shared/pastelPalette";
import {
  parseSlotPresetIdsFromWindow,
  presetDurationById,
  shiftCoversHour,
  syllabusNumForHourInWindow,
  validSegmentStartTimes,
  windowDayTimeline,
} from "../../../shared/manningHours";
import {
  coverageIsoFromDayAndHm,
  coverageIsoToHm,
  formatTimeForInput,
} from "../../../shared/timeFormat";
import type { WindowSegmentDraft } from "./scheduleTypes";

/** Prefer snake_case when that key exists on `s` (including explicit `null` from the server). */
function pickSnakeOrCamel(s: JsonObject, snake: string, camel: string): unknown {
  if (Object.prototype.hasOwnProperty.call(s, snake)) return s[snake];
  if (Object.prototype.hasOwnProperty.call(s, camel)) return s[camel];
  return s[snake] ?? s[camel];
}

export function normalizeShiftRow(s: JsonObject): JsonObject {
  return {
    ...s,
    shift_date: s.shift_date ?? s.shiftDate,
    employee_id: "employee_id" in s ? s.employee_id : s.employeeId,
    start_time: pickSnakeOrCamel(s, "start_time", "startTime"),
    end_time: pickSnakeOrCamel(s, "end_time", "endTime"),
    type_name: s.type_name ?? s.typeName,
    type_color: s.type_color ?? s.typeColor,
    shift_window_id: s.shift_window_id ?? s.shiftWindowId,
    syllabus_preset_id: pickSnakeOrCamel(s, "syllabus_preset_id", "syllabusPresetId"),
    up_to_date: s.up_to_date ?? s.upToDate,
    syllabus_num: s.syllabus_num ?? s.syllabusNum,
    syllabus_role_id: s.syllabus_role_id ?? s.syllabusRoleId,
    syllabus_role_name: s.syllabus_role_name ?? s.syllabusRoleName,
    syllabus_role_sort_order:
      s.syllabus_role_sort_order ?? s.syllabusRoleSortOrder,
    prep_start: pickSnakeOrCamel(s, "prep_start", "prepStart"),
    prep_end: pickSnakeOrCamel(s, "prep_end", "prepEnd"),
    rest_start: pickSnakeOrCamel(s, "rest_start", "restStart"),
    rest_end: pickSnakeOrCamel(s, "rest_end", "restEnd"),
    prep_minutes: pickSnakeOrCamel(s, "prep_minutes", "prepMinutes"),
    rest_minutes: pickSnakeOrCamel(s, "rest_minutes", "restMinutes"),
    duration_minutes: pickSnakeOrCamel(s, "duration_minutes", "durationMinutes"),
  };
}

/** `syllabus_roles` for a preset, ordered for matrix stacking. */
export function presetSyllabusRolesSorted(
  preset: JsonObject | undefined,
): JsonObject[] {
  if (!preset) return [];
  const raw = preset.syllabus_roles as JsonObject[] | undefined;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return [...raw].sort(
    (a, b) =>
      Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
      Number(a.id ?? 0) - Number(b.id ?? 0),
  );
}

/** Max stacked role pills needed in any segment of this window row on `dateStr`. */
export function maxSyllabusRolesInWindowDay(
  dateStr: string,
  ty: JsonObject,
  durationByPreset: Map<number, number>,
  presets: JsonObject[],
): number {
  const { segments } = windowDayTimeline(dateStr, ty, durationByPreset, "#000");
  const presetById = new Map(presets.map((p) => [Number(p.id), p]));
  let max = 1;
  for (const seg of segments) {
    const roles = presetSyllabusRolesSorted(presetById.get(seg.presetId));
    max = Math.max(max, Math.max(1, roles.length));
  }
  return max;
}

/** True if this hour still has a free syllabus-role slot for `ty`. */
export function slotHasUnmannedRole(
  dateStr: string,
  ty: JsonObject,
  hour: string,
  durationByPreset: Map<number, number>,
  presets: JsonObject[],
  dayShifts: JsonObject[],
): boolean {
  const sn = syllabusNumForHourInWindow(dateStr, ty, hour, durationByPreset);
  if (sn == null) return false;
  const slotIds = parseSlotPresetIdsFromWindow(ty);
  const pid = slotIds[sn];
  const preset = presets.find((p) => Number(p.id) === pid);
  const roles = presetSyllabusRolesSorted(preset);
  const tid = typeId(ty);
  if (roles.length <= 1) {
    const hasAssigned = dayShifts.some((s) => {
      const sid = Number(s.shift_window_id ?? s.shiftWindowId);
      if (sid !== tid) return false;
      if (!shiftCoversHour(String(s.start_time), String(s.end_time), hour))
        return false;
      const eid = s.employee_id;
      return eid !== null && eid !== undefined && eid !== "";
    });
    return !hasAssigned;
  }
  const manned = new Set<number>();
  for (const s of dayShifts) {
    if (Number(s.shift_window_id ?? s.shiftWindowId) !== tid) continue;
    if (Number(s.syllabus_num ?? s.syllabusNum) !== sn) continue;
    const eid = s.employee_id;
    if (eid === null || eid === undefined || eid === "") continue;
    manned.add(Number(s.syllabus_role_id));
  }
  return roles.some((r) => !manned.has(Number(r.id)));
}

/** Matrix-style: any syllabus role in this materialized slot (`syllabus_num`) still unmanned. */
export function slotHasUnmannedRoleForSyllabusNum(
  ty: JsonObject,
  sn: number,
  presets: JsonObject[],
  dayShifts: JsonObject[],
): boolean {
  const slotIds = parseSlotPresetIdsFromWindow(ty);
  if (sn < 0 || sn >= slotIds.length) return false;
  const pid = slotIds[sn]!;
  const preset = presets.find((p) => Number(p.id) === pid);
  const roles = presetSyllabusRolesSorted(preset);
  const tid = typeId(ty);
  if (roles.length === 0) return false;
  if (roles.length <= 1) {
    const hasAssigned = dayShifts.some((s) => {
      const sid = Number(s.shift_window_id ?? s.shiftWindowId);
      if (sid !== tid) return false;
      if (Number(s.syllabus_num ?? s.syllabusNum) !== sn) return false;
      const eid = s.employee_id;
      return eid !== null && eid !== undefined && eid !== "";
    });
    return !hasAssigned;
  }
  const manned = new Set<number>();
  for (const s of dayShifts) {
    if (Number(s.shift_window_id ?? s.shiftWindowId) !== tid) continue;
    if (Number(s.syllabus_num ?? s.syllabusNum) !== sn) continue;
    const eid = s.employee_id;
    if (eid === null || eid === undefined || eid === "") continue;
    manned.add(Number(s.syllabus_role_id));
  }
  return roles.some((r) => !manned.has(Number(r.id)));
}

/** True if this role column is empty and can open create for `(window, sn, roleId)`. */
export function syllabusRoleCellCanAssign(
  ty: JsonObject,
  sn: number,
  roleId: number,
  presets: JsonObject[],
  dayShifts: JsonObject[],
): boolean {
  const slotIds = parseSlotPresetIdsFromWindow(ty);
  if (sn < 0 || sn >= slotIds.length) return false;
  const pid = slotIds[sn]!;
  const preset = presets.find((p) => Number(p.id) === pid);
  const roles = presetSyllabusRolesSorted(preset);
  const tid = typeId(ty);
  if (!roles.some((r) => Number(r.id) === roleId)) return false;
  if (roles.length <= 1) {
    return !dayShifts.some((s) => {
      const sid = Number(s.shift_window_id ?? s.shiftWindowId);
      if (sid !== tid) return false;
      if (Number(s.syllabus_num ?? s.syllabusNum) !== sn) return false;
      const eid = s.employee_id;
      return eid !== null && eid !== undefined && eid !== "";
    });
  }
  return !dayShifts.some((s) => {
    const sid = Number(s.shift_window_id ?? s.shiftWindowId);
    if (sid !== tid) return false;
    if (Number(s.syllabus_num ?? s.syllabusNum) !== sn) return false;
    if (Number(s.syllabus_role_id) !== roleId) return false;
    const eid = s.employee_id;
    return eid !== null && eid !== undefined && eid !== "";
  });
}

/** First free role id for the slot, or the first role when all are taken (caller should block). */
export function pickDefaultSyllabusRoleIdForSlot(
  ty: JsonObject,
  sn: number,
  presets: JsonObject[],
  dayShifts: JsonObject[],
): number | undefined {
  const slotIds = parseSlotPresetIdsFromWindow(ty);
  const pid = slotIds[sn];
  const preset = presets.find((p) => Number(p.id) === pid);
  const roles = presetSyllabusRolesSorted(preset);
  if (roles.length === 0) return undefined;
  const tid = typeId(ty);
  if (roles.length === 1) {
    return Number(roles[0].id);
  }
  const manned = new Set<number>();
  for (const s of dayShifts) {
    if (Number(s.shift_window_id ?? s.shiftWindowId) !== tid) continue;
    if (Number(s.syllabus_num ?? s.syllabusNum) !== sn) continue;
    const eid = s.employee_id;
    if (eid === null || eid === undefined || eid === "") continue;
    manned.add(Number(s.syllabus_role_id));
  }
  const free = roles.find((r) => !manned.has(Number(r.id)));
  return Number((free ?? roles[0]).id);
}

export function shiftIsUpToDate(s: JsonObject): boolean {
  const v = s.up_to_date ?? s.upToDate;
  if (v === false || v === 0 || v === "0") return false;
  return true;
}

export function typeId(ty: JsonObject): number {
  return Number(ty.id);
}

/**
 * Keeps `draft.segments[1..]` on the slot grid after coverage or preset-duration inputs change.
 * Matches the `<select>` coercion in `ShiftWindowDraftFormFields`: keep current time if valid, else first option.
 */
export function resyncWindowSegmentStartTimes(
  draft: JsonObject,
  dateStr: string,
  durationByPresetId: Map<number, number>,
): JsonObject {
  const segments = (draft.segments as WindowSegmentDraft[]) ?? [];
  if (segments.length === 0) return draft;

  const covStart =
    formatTimeForInput(String(draft.coverage_start_time ?? "").trim()) || "06:00";
  const covEnd =
    formatTimeForInput(String(draft.coverage_end_time ?? "").trim()) || "21:00";
  const endNext = coverageEndIsNextDayMidnight(covEnd);

  const segs: WindowSegmentDraft[] = segments.map((s) => ({ ...s }));
  if (segs.length > 0) {
    segs[0] = { ...segs[0], segment_start_time: covStart };
  }

  for (let i = 1; i < segs.length; i++) {
    const opts = validSegmentStartTimes(
      dateStr,
      covStart,
      covEnd,
      endNext,
      segs.slice(0, i),
      i,
      durationByPresetId,
    );
    const cur = formatTimeForInput(String(segs[i].segment_start_time ?? "").trim()) || "";
    const pick = opts.includes(cur) ? cur : (opts[0] ?? cur);
    segs[i] = {
      ...segs[i],
      segment_start_time: pick || segs[i].segment_start_time,
    };
  }

  return {
    ...draft,
    coverage_start_time: covStart,
    coverage_end_time: covEnd,
    segments: segs,
  };
}

export function buildShiftWindowPayload(
  d: JsonObject,
  dateStr: string,
  presets?: JsonObject[],
): JsonObject {
  let working = d;
  if (presets && presets.length > 0) {
    working = resyncWindowSegmentStartTimes(d, dateStr, presetDurationById(presets));
  }
  const startHm =
    formatTimeForInput(String(working.coverage_start_time ?? "").trim()) || "06:00";
  const endHm =
    formatTimeForInput(String(working.coverage_end_time ?? "").trim()) || "21:00";
  const segments = (working.segments as WindowSegmentDraft[]) ?? [];
  return {
    name: String(working.name ?? "").trim(),
    color: String(working.color ?? DEFAULT_SHIFT_TYPE_PASTEL_HEX),
    notes: working.notes ? String(working.notes).trim() || null : null,
    coverage_start: coverageIsoFromDayAndHm(dateStr, startHm),
    coverage_end: coverageIsoFromDayAndHm(dateStr, endHm, true),
    segments: segments.map((s) => ({
      syllabus_preset_id: Number(s.syllabus_preset_id),
      segment_start_time: formatTimeForInput(String(s.segment_start_time)) || startHm,
    })),
  };
}

export function defaultSyllabusPresetId(presets: JsonObject[]): number {
  const locked = presets.find((p) => Number(p.system_locked ?? p.systemLocked) === 1);
  if (locked) return Number(locked.id);
  const first = presets[0];
  return first ? Number(first.id) : 1;
}

export function coverageEndIsNextDayMidnight(endHm: string): boolean {
  return (formatTimeForInput(endHm) || "") === "00:00";
}

export function shiftTypeDraftFromWindow(ty: JsonObject, presets: JsonObject[]): JsonObject {
  const covStart = String(ty.coverage_start ?? "");
  const covEnd = String(ty.coverage_end ?? "");
  const covStartHm = covStart
    ? formatTimeForInput(coverageIsoToHm(covStart))
    : "06:00";
  const covEndHm = covEnd ? formatTimeForInput(coverageIsoToHm(covEnd)) : "21:00";
  const rawSegs = ty.segments as WindowSegmentDraft[] | undefined;
  const defPid = defaultSyllabusPresetId(presets);
  const segments: WindowSegmentDraft[] =
    rawSegs && rawSegs.length > 0
      ? rawSegs.map((s) => ({
          syllabus_preset_id: Number(s.syllabus_preset_id),
          segment_start_time:
            formatTimeForInput(String(s.segment_start_time)) || covStartHm || "06:00",
        }))
      : [{ syllabus_preset_id: defPid, segment_start_time: covStartHm || "06:00" }];
  return {
    id: typeId(ty),
    name: String(ty.name ?? ""),
    coverage_start_time: covStartHm || "06:00",
    coverage_end_time: covEndHm || "21:00",
    color: String(ty.color ?? DEFAULT_SHIFT_TYPE_PASTEL_HEX),
    notes: ty.notes != null ? String(ty.notes) : "",
    segments,
  };
}

export function newShiftTypeDraft(presets: JsonObject[]): JsonObject {
  const covStart = "06:00";
  const pid = defaultSyllabusPresetId(presets);
  return {
    name: "",
    coverage_start_time: covStart,
    coverage_end_time: "21:00",
    color: DEFAULT_SHIFT_TYPE_PASTEL_HEX,
    notes: "",
    segments: [{ syllabus_preset_id: pid, segment_start_time: covStart }],
  };
}
