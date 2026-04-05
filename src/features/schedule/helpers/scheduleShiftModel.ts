import type { JsonObject } from "../../../shared/api";
import { DEFAULT_SHIFT_TYPE_PASTEL_HEX } from "../../../shared/pastelPalette";
import {
  coverageIsoFromDayAndHm,
  coverageIsoToHm,
  formatTimeForInput,
} from "../../../shared/timeFormat";
import type { WindowSegmentDraft } from "./scheduleTypes";

export function normalizeShiftRow(s: JsonObject): JsonObject {
  return {
    ...s,
    shift_date: s.shift_date ?? s.shiftDate,
    employee_id: "employee_id" in s ? s.employee_id : s.employeeId,
    start_time: s.start_time ?? s.startTime,
    end_time: s.end_time ?? s.endTime,
    type_name: s.type_name ?? s.typeName,
    type_color: s.type_color ?? s.typeColor,
    shift_window_id: s.shift_window_id ?? s.shiftWindowId,
    syllabus_preset_id: s.syllabus_preset_id ?? s.syllabusPresetId,
    up_to_date: s.up_to_date ?? s.upToDate,
    syllabus_num: s.syllabus_num ?? s.syllabusNum,
  };
}

export function shiftIsUpToDate(s: JsonObject): boolean {
  const v = s.up_to_date ?? s.upToDate;
  if (v === false || v === 0 || v === "0") return false;
  return true;
}

export function typeId(ty: JsonObject): number {
  return Number(ty.id);
}

export function buildShiftWindowPayload(d: JsonObject, dateStr: string): JsonObject {
  const startHm = String(d.coverage_start_time ?? "06:00");
  const endHm = String(d.coverage_end_time ?? "21:00");
  const segments = (d.segments as WindowSegmentDraft[]) ?? [];
  return {
    name: String(d.name ?? "").trim(),
    color: String(d.color ?? DEFAULT_SHIFT_TYPE_PASTEL_HEX),
    notes: d.notes ? String(d.notes).trim() || null : null,
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
