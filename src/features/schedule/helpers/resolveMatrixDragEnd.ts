import type { DragEndEvent } from "@dnd-kit/core";
import type { JsonObject } from "../../../shared/api";
import { employeeHasShiftOrObservationIntersectingInterval } from "./scheduleMatrixGeometry";
import type {
  MatrixEmployeeShiftDragData,
  MatrixObservationRowDragData,
  MatrixObservationSlotDragData,
  MatrixTypeSlotDragData,
} from "./scheduleTypes";

/** True if another shift in the same date/window/syllabus_num slot already has an observation. */
function observationExistsOnSiblingShiftInSlot(
  dayShifts: JsonObject[],
  dayObservations: JsonObject[],
  targetShiftId: number,
): boolean {
  const tar = dayShifts.find((s) => Number(s.id) === targetShiftId);
  if (!tar) return false;
  const date = String(tar.shift_date ?? tar.shiftDate);
  const wid = Number(tar.shift_window_id ?? tar.shiftWindowId);
  const sn = Number(tar.syllabus_num ?? tar.syllabusNum);
  for (const ob of dayObservations) {
    const oid = Number(ob.shift_id ?? ob.shiftId);
    if (oid === targetShiftId) continue;
    const s = dayShifts.find((x) => Number(x.id) === oid);
    if (!s) continue;
    if (
      String(s.shift_date ?? s.shiftDate) === date &&
      Number(s.shift_window_id ?? s.shiftWindowId) === wid &&
      Number(s.syllabus_num ?? s.syllabusNum) === sn
    ) {
      return true;
    }
  }
  return false;
}

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
    }
  | { kind: "createObservation"; shift_id: number; employee_id: number }
  | { kind: "reassignObservation"; observation_id: number; employee_id: number };

export function resolveMatrixDragEnd(args: {
  active: DragEndEvent["active"];
  over: DragEndEvent["over"];
  dateStr: string;
  dayShifts: JsonObject[];
  dayObservations: JsonObject[];
}): MatrixDragEndResolution {
  const { active, over, dateStr, dayShifts, dayObservations } = args;
  const dragData = active.data.current as
    | MatrixTypeSlotDragData
    | MatrixEmployeeShiftDragData
    | MatrixObservationSlotDragData
    | MatrixObservationRowDragData
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
      employeeHasShiftOrObservationIntersectingInterval(
        dateStr,
        dayShifts,
        dayObservations,
        o.employeeId,
        dragData.highlightStartMs,
        dragData.highlightEndMs,
        { excludeShiftId: dragData.shiftId },
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

  if (dragData.kind === "obsRow") {
    if (o.employeeId === dragData.employeeId) return { kind: "noop" };
    if (
      employeeHasShiftOrObservationIntersectingInterval(
        dateStr,
        dayShifts,
        dayObservations,
        o.employeeId,
        dragData.highlightStartMs,
        dragData.highlightEndMs,
        { excludeObservationId: dragData.observationId },
      )
    ) {
      return { kind: "noop" };
    }
    return {
      kind: "reassignObservation",
      observation_id: dragData.observationId,
      employee_id: o.employeeId,
    };
  }

  if (dragData.kind === "typeSlot") {
    const dropEmpId = o.employeeId;
    const dropHour = o.hour;
    if (!dragData.coveredHours.includes(dropHour)) return { kind: "noop" };

    if (
      employeeHasShiftOrObservationIntersectingInterval(
        dateStr,
        dayShifts,
        dayObservations,
        dropEmpId,
        dragData.highlightStartMs,
        dragData.highlightEndMs,
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

  if (dragData.kind === "obsSlot") {
    const dropEmpId = o.employeeId;
    const dropHour = o.hour;
    if (!dragData.coveredHours.includes(dropHour)) return { kind: "noop" };

    if (
      dayObservations.some((ob) => Number(ob.shift_id ?? ob.shiftId) === dragData.shiftId)
    ) {
      return { kind: "noop" };
    }
    if (
      observationExistsOnSiblingShiftInSlot(
        dayShifts,
        dayObservations,
        dragData.shiftId,
      )
    ) {
      return { kind: "noop" };
    }

    if (
      employeeHasShiftOrObservationIntersectingInterval(
        dateStr,
        dayShifts,
        dayObservations,
        dropEmpId,
        dragData.highlightStartMs,
        dragData.highlightEndMs,
      )
    ) {
      return { kind: "noop" };
    }

    return {
      kind: "createObservation",
      shift_id: dragData.shiftId,
      employee_id: dropEmpId,
    };
  }

  return { kind: "noop" };
}
