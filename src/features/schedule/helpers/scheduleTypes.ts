export type WindowSegmentDraft = {
  syllabus_preset_id: number;
  segment_start_time: string;
};

export type MatrixTypeSlotDragData = {
  kind: "typeSlot";
  shiftWindowId: number;
  syllabusNum: number;
  /** Target `syllabus_roles.id` when the slot preset defines roles; omit for legacy single-slot. */
  syllabusRoleId?: number;
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
  syllabusRoleId?: number;
  employeeId: number;
  color: string;
  /** Clipped wall interval for the unified hour-strip band (same as pill span). */
  highlightStartMs: number;
  highlightEndMs: number;
};

/** Draggable tinted pill in the window row when a slot is manned but not yet observed. */
export type MatrixObservationSlotDragData = {
  kind: "obsSlot";
  shiftId: number;
  shiftWindowId: number;
  syllabusNum: number;
  syllabusRoleId?: number;
  coveredHours: string[];
  displayHour: string;
  color: string;
  highlightStartMs: number;
  highlightEndMs: number;
};

export type MatrixObservationRowDragData = {
  kind: "obsRow";
  observationId: number;
  shiftId: number;
  employeeId: number;
  color: string;
  highlightStartMs: number;
  highlightEndMs: number;
};

export type ActiveDragHighlightMs = { startMs: number; endMs: number };
