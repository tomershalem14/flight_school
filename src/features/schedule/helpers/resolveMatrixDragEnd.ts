import type { DragEndEvent } from "@dnd-kit/core";
import type { JsonObject } from "../../../shared/api";
import { employeeHasShiftIntersectingInterval } from "./scheduleMatrixGeometry";
import type {
  MatrixEmployeeShiftDragData,
  MatrixTypeSlotDragData,
} from "./scheduleTypes";

export type MatrixDragEndResolution =
  | { kind: "noop" }
  | { kind: "reassign"; shift_id: number; employee_id: number }
  | {
      kind: "create";
      shift_window_id: number;
      employee_id: number;
      syllabus_num: number;
      syllabus_role_id?: number;
      /** Clipped wall interval from the type-slot pill (same as drag payload). */
      highlightStartMs: number;
      highlightEndMs: number;
    };

export function resolveMatrixDragEnd(args: {
  active: DragEndEvent["active"];
  over: DragEndEvent["over"];
  dateStr: string;
  dayShifts: JsonObject[];
}): MatrixDragEndResolution {
  const { active, over, dateStr, dayShifts } = args;
  const dragData = active.data.current as
    | MatrixTypeSlotDragData
    | MatrixEmployeeShiftDragData
    | undefined;

  if (!dragData) return { kind: "noop" };

  if (!over) return { kind: "noop" };

  const o = over.data.current as { employeeId?: number; hour?: string } | undefined;
  if (!o || o.employeeId === undefined || o.hour === undefined) {
    return { kind: "noop" };
  }

  if (dragData.kind === "empShift") {
    if (o.employeeId === dragData.employeeId) return { kind: "noop" };
    if (
      employeeHasShiftIntersectingInterval(
        dateStr,
        dayShifts,
        o.employeeId,
        dragData.highlightStartMs,
        dragData.highlightEndMs,
        dragData.shiftId,
      )
    ) {
      return { kind: "noop" };
    }
    return {
      kind: "reassign",
      shift_id: dragData.shiftId,
      employee_id: o.employeeId,
    };
  }

  if (dragData.kind !== "typeSlot") return { kind: "noop" };

  const dropEmpId = o.employeeId;
  const dropHour = o.hour;
  if (!dragData.coveredHours.includes(dropHour)) return { kind: "noop" };

  if (
    employeeHasShiftIntersectingInterval(
      dateStr,
      dayShifts,
      dropEmpId,
      dragData.highlightStartMs,
      dragData.highlightEndMs,
      undefined,
      { ignoreStaleShifts: true },
    )
  ) {
    return { kind: "noop" };
  }

  return {
    kind: "create",
    shift_window_id: dragData.shiftWindowId,
    employee_id: dropEmpId,
    syllabus_num: dragData.syllabusNum,
    syllabus_role_id: dragData.syllabusRoleId,
    highlightStartMs: dragData.highlightStartMs,
    highlightEndMs: dragData.highlightEndMs,
  };
}
