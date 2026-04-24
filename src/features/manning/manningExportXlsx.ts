import {
  buildManningDayExportAoa,
  MANNING_SHEET_COL_COUNT,
  MANNING_SYLLABUS_SHEET_COL_0,
  type ManningDayExportInput,
  type ManningWindowBlockMeta,
} from "./buildManningDayExportAoa";
import { excelRgb, tintWindowColor } from "./manningExportColors";

export type { ManningDayExportInput } from "./buildManningDayExportAoa";

/** Excel sheet name max length. */
const SHEET_NAME_MAX = 31;

const DEFAULT_WCH = 12;

const BLACK = { rgb: "FF000000" };
const thinB = () => ({ style: "thin" as const, color: BLACK });
const thickB = () => ({ style: "thick" as const, color: BLACK });

type XLSXMod = typeof import("xlsx-js-style");
type CellObj = import("xlsx-js-style").CellObject;

const LAST_SHEET_COL = MANNING_SHEET_COL_COUNT - 1;

/** SheetJS: sets `sheetView rightToLeft` when writing XLSX. */
function applyWorkbookRtl(wb: { Workbook?: { Views?: Array<{ RTL?: boolean }> } }) {
  if (!wb.Workbook) wb.Workbook = {};
  if (!wb.Workbook.Views || wb.Workbook.Views.length === 0) {
    wb.Workbook.Views = [{}];
  }
  wb.Workbook.Views[0] = { ...wb.Workbook.Views[0], RTL: true };
}

function ensureCell(ws: import("xlsx-js-style").WorkSheet, addr: string): CellObj {
  let cell = ws[addr] as CellObj | undefined;
  if (!cell) {
    cell = { t: "s", v: "" };
    ws[addr] = cell;
  }
  if (cell.t === undefined || cell.t === "z") {
    if (cell.v !== undefined && typeof cell.v === "number") cell.t = "n";
    else cell.t = "s";
  }
  if (cell.t === "s" && cell.v === undefined) cell.v = "";
  return cell;
}

function solidFill(rgb: string) {
  return {
    patternType: "solid" as const,
    fgColor: { rgb },
  };
}

function centerAlign() {
  return { horizontal: "center" as const, vertical: "center" as const };
}

function cellStyleMut(ws: import("xlsx-js-style").WorkSheet, addr: string) {
  const cell = ensureCell(ws, addr);
  if (!cell.s) cell.s = {};
  return cell.s as Record<string, unknown>;
}

/** Restore Excel default look: no custom `s` on the cell. */
function clearCellStyle(ws: import("xlsx-js-style").WorkSheet, addr: string) {
  const cell = ws[addr] as CellObj | undefined;
  if (cell && cell.s != null) {
    delete cell.s;
  }
}

/** Table row 1 (מסגרת): sheet cols ≥1 only (column A has no borders). */
function bordersSheetRow1(c: number) {
  const t = c - 1;
  return {
    top: thickB(),
    bottom: thickB(),
    left: t === 0 ? thickB() : thinB(),
    right: c === LAST_SHEET_COL ? thickB() : t <= 1 ? thickB() : thinB(),
  };
}

/** Table row 2: gutter col B; groups from col C. */
function bordersSheetRow2(c: number) {
  const t = c - 1;
  const thickL = t === 0 || t === 1 || t === 4 || t === 13;
  const thickR = t === 0 || t === 3 || t === 12 || t === 17;
  return {
    top: thickB(),
    bottom: thickB(),
    left: thickL ? thickB() : thinB(),
    right: thickR ? thickB() : thinB(),
  };
}

/** Table row 3: col B gutter; groups from C. */
function bordersSheetRow3(c: number) {
  if (c === 1) {
    return {
      top: thickB(),
      bottom: thickB(),
      left: thickB(),
      right: thickB(),
    };
  }
  return {
    top: thickB(),
    bottom: thickB(),
    left: c === 2 ? thickB() : c === 5 || c === 14 ? thickB() : thinB(),
    right: c === LAST_SHEET_COL ? thickB() : c === 4 || c === 13 ? thickB() : thinB(),
  };
}

/**
 * Data rows: same group outlines as row 2–3 — thick perimeter around each (data rows, cols 2–4),
 * (data rows, 5–13), (data rows, 14–18); thin inside groups and between data rows.
 * Row 3 already uses a thick bottom; data row tops stay thin to avoid a double line under row 3.
 */
function bordersDataRowGrouped(c: number, r: number, lastDataRow: number) {
  const top = thinB();
  const bottom = r === lastDataRow ? thickB() : thinB();
  const groupLeft = c === 2 || c === 5 || c === 14;
  const groupRight = c === 4 || c === 13 || c === LAST_SHEET_COL;
  return {
    top,
    bottom,
    left: groupLeft ? thickB() : thinB(),
    right: groupRight ? thickB() : thinB(),
  };
}

function bordersGutterCol1Interior(r: number, blockStart: number, blockEnd: number) {
  const top = r === blockStart + 1 ? thickB() : thinB();
  const bottom = r === blockEnd ? thickB() : thinB();
  return {
    top,
    bottom,
    left: thickB(),
    right: thickB(),
  };
}

/** Sunday=א … Saturday=ש (JavaScript getDay: 0=Sun … 6=Sat). */
const HEBREW_WEEKDAY_LETTER = ["א", "ב", "ג", "ד", "ה", "ו", "ש"] as const;

function hebrewWeekdayLetterFromYmd(dateStr: string): string {
  const parts = dateStr.split("-").map((x) => Number(x));
  const y = parts[0]!;
  const mo = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
  const idx = dt.getDay();
  return HEBREW_WEEKDAY_LETTER[idx] ?? "א";
}

function manningSheetName(dateStr: string): string {
  const base = `יום ${hebrewWeekdayLetterFromYmd(dateStr)}`;
  return base.length <= SHEET_NAME_MAX ? base : base.slice(0, SHEET_NAME_MAX);
}

function applyWindowBlockStyles(ws: import("xlsx-js-style").WorkSheet, XLSX: XLSXMod, b: ManningWindowBlockMeta) {
  const { startRow: S, endRow: E, windowHex } = b;
  const tint = excelRgb(tintWindowColor(windowHex));
  const base = excelRgb(windowHex);
  const white = excelRgb("FFFFFF");
  for (let r = S - 1; r <= E; r++) {
    const rel = r - S;
    for (let c = 0; c < MANNING_SHEET_COL_COUNT; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (rel === -1 || c === 0) {
        clearCellStyle(ws, addr);
        continue;
      }

      ensureCell(ws, addr);
      const s = cellStyleMut(ws, addr);
      s.alignment = centerAlign();

      if (rel === 0) {
        s.font = { bold: true };
        if (c <= 2) s.fill = solidFill(tint);
        else s.fill = solidFill(base);
        s.border = bordersSheetRow1(c);
        continue;
      }

      if (rel === 1) {
        s.font = { bold: true };
        if (c === 1) s.fill = solidFill(base);
        else s.fill = solidFill(tint);
        s.border = bordersSheetRow2(c);
        continue;
      }

      if (rel === 2) {
        s.font = { bold: true };
        s.fill = solidFill(tint);
        s.border = bordersSheetRow3(c);
        continue;
      }

      s.font = { bold: false };
      if (c === 1) {
        s.fill = solidFill(base);
        s.border = bordersGutterCol1Interior(r, S, E);
      } else {
        s.fill = solidFill(white);
        s.border = bordersDataRowGrouped(c, r, E);
      }
    }
  }
}

function applyEmptyDayRowStyle(ws: import("xlsx-js-style").WorkSheet, XLSX: XLSXMod, windowHex: string) {
  const tint = excelRgb(tintWindowColor(windowHex));
  for (let c = 0; c < MANNING_SHEET_COL_COUNT; c++) {
    clearCellStyle(ws, XLSX.utils.encode_cell({ r: 0, c }));
  }
  for (let c = 0; c < MANNING_SHEET_COL_COUNT; c++) {
    const addr = XLSX.utils.encode_cell({ r: 1, c });
    if (c === 0) {
      clearCellStyle(ws, addr);
      continue;
    }
    const s = cellStyleMut(ws, addr);
    s.font = { bold: true };
    s.fill = solidFill(tint);
    s.alignment = centerAlign();
    s.border = bordersSheetRow1(c);
  }
}

function setManningColWidths(ws: import("xlsx-js-style").WorkSheet) {
  ws["!cols"] = Array.from({ length: MANNING_SHEET_COL_COUNT }, (_, c) => ({
    wch: c === MANNING_SYLLABUS_SHEET_COL_0 ? DEFAULT_WCH * 1.5 : DEFAULT_WCH,
  }));
}

export async function buildManningDayWorkbookBytes(input: ManningDayExportInput): Promise<Uint8Array> {
  const XLSX = (await import("xlsx-js-style")) as XLSXMod;
  const { aoa, merges, blocks } = buildManningDayExportAoa(input);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (merges.length > 0) {
    ws["!merges"] = merges;
  }

  const onlyEmptyMessage =
    blocks.length === 1 && blocks[0]!.segmentCount === 0 && aoa.length === 2;

  if (onlyEmptyMessage) {
    applyEmptyDayRowStyle(ws, XLSX, blocks[0]!.windowHex);
  } else {
    for (const b of blocks) {
      applyWindowBlockStyles(ws, XLSX, b);
    }
  }

  setManningColWidths(ws);

  const wb = XLSX.utils.book_new();
  applyWorkbookRtl(wb);
  XLSX.utils.book_append_sheet(wb, ws, manningSheetName(input.dateStr));
  const raw = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return Uint8Array.from(raw as number[]);
}

/** Minimal empty `.xlsx` (RTL). */
export async function buildEmptyManningWorkbookBytes(): Promise<Uint8Array> {
  const XLSX = (await import("xlsx-js-style")) as XLSXMod;
  const wb = XLSX.utils.book_new();
  applyWorkbookRtl(wb);
  const ws = XLSX.utils.aoa_to_sheet([["", ""]]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const raw = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return Uint8Array.from(raw as number[]);
}
