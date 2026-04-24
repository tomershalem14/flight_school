import type { JsonObject } from "../../shared/api";
import { presetDurationById, windowDayTimeline } from "../../shared/manningHours";
import { formatTimeForInput } from "../../shared/timeFormat";
import {
  normalizeShiftRow,
  presetSyllabusRolesSorted,
  typeId,
} from "../schedule/helpers/scheduleShiftModel";

/** Logical table width (מסגרת … חלק/כבד). */
export const MANNING_TABLE_COL_COUNT = 18;

/** Blank sheet column(s) to the left of the table (table starts at column B). */
export const MANNING_SHEET_LEADING_COLS = 1;

/** Total sheet columns per row: leading gap + table. */
export const MANNING_SHEET_COL_COUNT = MANNING_SHEET_LEADING_COLS + MANNING_TABLE_COL_COUNT;

/** 0-based sheet column index of סילבוס (table col 10 → A gap + 9). */
export const MANNING_SYLLABUS_SHEET_COL_0 = MANNING_SHEET_LEADING_COLS + 9;

/** SheetJS merge (0-based row/col). */
export type ManningExportMerge = { s: { r: number; c: number }; e: { r: number; c: number } };

export type ManningWindowBlockMeta = {
  /** Sheet row index of table row 1 (מסגרת); Excel row = startRow + 1. */
  startRow: number;
  /** Sheet row index of last data row (inclusive). */
  endRow: number;
  /** Shift window color hex (e.g. `#7BA3B5`). */
  windowHex: string;
  /** Number of data rows (segments). */
  segmentCount: number;
};

function formatHmFromMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function prepStartDisplay(shift: JsonObject | undefined): string {
  if (!shift) return "";
  const raw = String(shift.prep_start ?? shift["prepStart"] ?? "").trim();
  if (!raw) return "";
  return formatTimeForInput(raw) || "";
}

function pickShiftStr(shift: JsonObject | undefined, snake: string, camel: string): string {
  if (!shift) return "";
  const v =
    Object.prototype.hasOwnProperty.call(shift, snake) ? shift[snake] : shift[camel];
  if (v == null) return "";
  const t = String(v).trim();
  return t;
}

function representativeShiftForMeta(slotShifts: JsonObject[]): JsonObject | undefined {
  const withEmp = slotShifts.filter((s) => {
    const e = s.employee_id;
    return e !== null && e !== undefined && e !== "";
  });
  if (withEmp.length > 0) return withEmp[0];
  return slotShifts[0];
}

function assignedShiftForRoleCell(
  slotShifts: JsonObject[],
  roleId: number,
  roles: JsonObject[],
): JsonObject | undefined {
  const withEmp = slotShifts.filter((s) => {
    const e = s.employee_id;
    return e !== null && e !== undefined && e !== "";
  });
  if (roles.length <= 1) return withEmp[0];
  return withEmp.find((s) => Number(s.syllabus_role_id) === roleId);
}

function observationForSlot(
  slotShifts: JsonObject[],
  observationByShiftId: Map<number, JsonObject>,
): JsonObject | undefined {
  for (const s of slotShifts) {
    const ob = observationByShiftId.get(Number(s.id));
    if (ob) return ob;
  }
  return undefined;
}

function observerDisplayName(obs: JsonObject, employees: JsonObject[]): string {
  const eid = Number(obs.employee_id ?? obs.employeeId);
  const emp = employees.find((e) => Number(e.id) === eid);
  return emp?.name != null ? String(emp.name) : "";
}

function emptySheetRow(): string[] {
  return Array(MANNING_SHEET_COL_COUNT).fill("") as string[];
}

function emptyTableRowPadded(): string[] {
  const r = emptySheetRow();
  return r;
}

function shiftRowHasEmployee(s: JsonObject | undefined): boolean {
  if (!s) return false;
  const e = s.employee_id;
  return e !== null && e !== undefined && e !== "";
}

function roleEmployeeName(
  slotShifts: JsonObject[],
  role: JsonObject | undefined,
  rowRoles: JsonObject[],
): string {
  if (!role) return "";
  const rid = Number(role.id);
  const cellShift = assignedShiftForRoleCell(slotShifts, rid, rowRoles);
  if (!shiftRowHasEmployee(cellShift)) return "";
  return String(cellShift!.emp_name ?? cellShift!.empName ?? "");
}

/** Row 3 sub-headers: sheet col A blank; col B gutter (merge); C–S = table sub-heads. */
function buildRow3SubHeaders(): string[] {
  const r = emptyTableRowPadded();
  r[1] = "";
  r[2] = "תדריך";
  r[3] = 'קבל"ש';
  r[4] = 'העבר"ש';
  r[5] = "מדריך";
  r[6] = "";
  r[7] = "";
  r[8] = "";
  r[9] = "מגמה";
  r[10] = "סילבוס";
  r[11] = "תצפית";
  r[12] = "הערות";
  r[13] = "מנהלת";
  r[14] = "אזור+גובה";
  r[15] = 'או"ק+מס"ז';
  r[16] = "קרון";
  r[17] = 'מטע"ד';
  r[18] = "חלק/כבד";
  return r;
}

export type ManningDayExportInput = {
  dateStr: string;
  windows: JsonObject[];
  presets: JsonObject[];
  shifts: JsonObject[];
  observations: JsonObject[];
  employees: JsonObject[];
};

export type ManningDayExportAoaResult = {
  aoa: string[][];
  merges: ManningExportMerge[];
  blocks: ManningWindowBlockMeta[];
};

export function buildManningDayExportAoa(input: ManningDayExportInput): ManningDayExportAoaResult {
  const { dateStr, windows: windowsRaw, presets, shifts: shiftsRaw, observations, employees } =
    input;

  const shifts = shiftsRaw.map((s) => normalizeShiftRow(s as JsonObject));
  const dayShifts = shifts.filter((s) => String(s.shift_date) === dateStr);
  const dayShiftIdSet = new Set(dayShifts.map((s) => Number(s.id)));

  const dayObservations = observations.filter((ob) =>
    dayShiftIdSet.has(Number(ob.shift_id ?? ob.shiftId)),
  );
  const observationByShiftId = new Map<number, JsonObject>();
  for (const ob of dayObservations) {
    observationByShiftId.set(Number(ob.shift_id ?? ob.shiftId), ob);
  }

  const presetById = new Map(presets.map((p) => [Number(p.id), p as JsonObject]));
  const durationByPreset = presetDurationById(presets);

  const sortedWindows = [...windowsRaw].sort((a, b) => typeId(a) - typeId(b));

  const aoa: string[][] = [];
  const merges: ManningExportMerge[] = [];
  const blocks: ManningWindowBlockMeta[] = [];

  if (sortedWindows.length === 0) {
    aoa.push(emptySheetRow());
    const row = emptySheetRow();
    row[1] = "אין חלונות משמרת ליום זה.";
    aoa.push(row);
    merges.push({ s: { r: 1, c: 1 }, e: { r: 1, c: MANNING_SHEET_COL_COUNT - 1 } });
    blocks.push({ startRow: 1, endRow: 1, windowHex: "#7BA3B5", segmentCount: 0 });
    return { aoa, merges, blocks };
  }

  for (let wi = 0; wi < sortedWindows.length; wi++) {
    const ty = sortedWindows[wi]!;
    const tid = typeId(ty);
    const typeName = String(ty.name ?? "");
    const colColor = String(ty.color ?? "#7BA3B5");

    if (wi === 0) {
      aoa.push(emptySheetRow());
    }
    const startRow = aoa.length;

    const { segments } = windowDayTimeline(dateStr, ty, durationByPreset, colColor);
    const N = segments.length;

    const row1 = emptyTableRowPadded();
    row1[1] = "מסגרת";
    row1[2] = "פלטפורמה";
    row1[3] = typeName;
    aoa.push(row1);
    merges.push({ s: { r: startRow, c: 3 }, e: { r: startRow, c: 18 } });

    const row2 = emptyTableRowPadded();
    row2[2] = "זמנים";
    row2[5] = "איושים";
    row2[14] = "נתונים";
    aoa.push(row2);
    merges.push({ s: { r: startRow + 1, c: 2 }, e: { r: startRow + 1, c: 4 } });
    merges.push({ s: { r: startRow + 1, c: 5 }, e: { r: startRow + 1, c: 13 } });
    merges.push({ s: { r: startRow + 1, c: 14 }, e: { r: startRow + 1, c: 18 } });

    const mergeEndRow = startRow + 2 + N;
    merges.push({
      s: { r: startRow + 1, c: 1 },
      e: { r: mergeEndRow, c: 1 },
    });

    aoa.push(buildRow3SubHeaders());

    const colShifts = dayShifts.filter((s) => Number(s.shift_window_id) === tid);

    for (const seg of segments) {
      const sn = seg.syllabusNum;
      const slotShifts = colShifts.filter((s) => Number(s.syllabus_num) === sn);
      const preset = presetById.get(seg.presetId);
      const rowRoles = presetSyllabusRolesSorted(preset);
      const metaShift = representativeShiftForMeta(slotShifts);

      const prepCell = prepStartDisplay(metaShift);
      const startEndFromShift =
        metaShift &&
        String(metaShift.start_time ?? "").trim() &&
        String(metaShift.end_time ?? "").trim();
      const startCell = startEndFromShift
        ? formatTimeForInput(String(metaShift!.start_time))
        : formatHmFromMs(seg.startMs);
      const endCell = startEndFromShift
        ? formatTimeForInput(String(metaShift!.end_time))
        : formatHmFromMs(seg.endMs);

      const rolesTake = rowRoles.slice(0, 4);
      const roleNames: string[] = [];
      for (let i = 0; i < 4; i++) {
        roleNames.push(roleEmployeeName(slotShifts, rolesTake[i], rowRoles));
      }

      const syllabusName = String(preset?.name ?? "");
      const slotObs = observationForSlot(slotShifts, observationByShiftId);
      const obsCell = slotObs ? observerDisplayName(slotObs, employees) : "";

      const dataRow = emptyTableRowPadded();
      dataRow[2] = prepCell;
      dataRow[3] = startCell;
      dataRow[4] = endCell;
      dataRow[5] = roleNames[0] ?? "";
      dataRow[6] = roleNames[1] ?? "";
      dataRow[7] = roleNames[2] ?? "";
      dataRow[8] = roleNames[3] ?? "";
      dataRow[9] = "";
      dataRow[10] = syllabusName;
      dataRow[11] = obsCell;
      dataRow[12] = pickShiftStr(metaShift, "slot_notes", "slotNotes");
      dataRow[13] = pickShiftStr(metaShift, "management_notes", "managementNotes");
      dataRow[14] = pickShiftStr(metaShift, "area_height", "areaHeight");
      dataRow[15] = pickShiftStr(metaShift, "oq_msz", "oqMsz");
      dataRow[16] = pickShiftStr(metaShift, "cart", "cart");
      dataRow[17] = pickShiftStr(metaShift, "cargo", "cargo");
      dataRow[18] = pickShiftStr(metaShift, "part_heavy", "partHeavy");
      aoa.push(dataRow);
    }

    blocks.push({
      startRow,
      endRow: startRow + 2 + N,
      windowHex: colColor,
      segmentCount: N,
    });

    if (wi < sortedWindows.length - 1) {
      aoa.push(emptySheetRow());
    }
  }

  return { aoa, merges, blocks };
}
