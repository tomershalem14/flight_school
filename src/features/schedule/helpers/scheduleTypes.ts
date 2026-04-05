export type WindowSegmentDraft = {
  syllabus_preset_id: number;
  segment_start_time: string;
};

export type TypePickerState = {
  top: number;
  left: number;
  employeeId: number;
  employeeName: string;
  hour: string;
  start: string;
  end: string;
};

export type MatrixTypeSlotDragData = {
  kind: "typeSlot";
  shiftWindowId: number;
  syllabusNum: number;
  coveredHours: string[];
  displayHour: string;
  color: string;
  /** Clipped wall interval for column highlights (matches pill span, not full hours). */
  highlightStartMs: number;
  highlightEndMs: number;
};

export type MatrixEmployeeShiftDragData = {
  kind: "empShift";
  shiftId: number;
  shiftWindowId: number;
  syllabusNum: number;
  employeeId: number;
  color: string;
  /** Clipped wall interval for the unified hour-strip band (same as pill span). */
  highlightStartMs: number;
  highlightEndMs: number;
};

export type ActiveDragHighlightMs = { startMs: number; endMs: number };
