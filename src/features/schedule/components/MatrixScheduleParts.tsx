import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useRef } from "react";
import type { JsonObject } from "../../../shared/api";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { shiftIsUpToDate } from "../helpers/scheduleShiftModel";
import { useMatrixPillLongPress } from "../helpers/useMatrixPillLongPress";

export function MatrixEmployeeShiftPill({
  typeColor,
  title,
  upToDate,
  onLongPressDelete,
}: {
  typeColor: string;
  title: string;
  upToDate: boolean;
  onLongPressDelete: () => void;
}) {
  const lp = useMatrixPillLongPress({ onLongPressDelete });

  return (
    <span
      data-matrix-pill
      className={`block h-2.5 w-full max-w-full touch-none rounded-pill shadow-sm ring-1 ring-black/10 ${
        upToDate ? "" : "schedule-striped-warn-pill cursor-default"
      }`}
      style={upToDate ? { backgroundColor: typeColor } : undefined}
      title={title}
      aria-label={title}
      onPointerDown={lp.onPointerDown}
      onPointerMove={lp.onPointerMove}
      onPointerUp={lp.onPointerUp}
      onPointerCancel={lp.onPointerCancel}
    />
  );
}

export function MatrixDraggableEmployeeShiftPill({
  shiftId,
  shiftWindowId,
  syllabusNum,
  employeeId,
  typeColor,
  title,
  upToDate,
  highlightStartMs,
  highlightEndMs,
  onLongPressDelete,
}: {
  shiftId: number;
  shiftWindowId: number;
  syllabusNum: number;
  employeeId: number;
  typeColor: string;
  title: string;
  upToDate: boolean;
  highlightStartMs: number;
  highlightEndMs: number;
  onLongPressDelete: () => void;
}) {
  const isDraggingRef = useRef(false);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `emp-shift-${shiftId}`,
    data: {
      kind: "empShift" as const,
      shiftId,
      shiftWindowId,
      syllabusNum,
      employeeId,
      color: typeColor,
      highlightStartMs,
      highlightEndMs,
    },
  });

  const onPointerDownFirst = useCallback(
    (e: ReactPointerEvent<Element>) => {
      listeners?.onPointerDown?.(e);
    },
    [listeners],
  );

  const lp = useMatrixPillLongPress({
    onLongPressDelete,
    onPointerDownFirst,
    shouldAbortScheduledDelete: () => isDraggingRef.current,
  });

  useEffect(() => {
    isDraggingRef.current = isDragging;
    if (isDragging) lp.clearLongPress();
  }, [isDragging, lp.clearLongPress]);

  return (
    <span
      ref={setNodeRef}
      data-matrix-pill
      className={`block h-2.5 w-full max-w-full touch-none rounded-pill shadow-sm ring-1 ring-black/10 ${
        upToDate
          ? "cursor-grab active:cursor-grabbing"
          : "cursor-grab active:cursor-grabbing schedule-striped-warn-pill"
      }`}
      style={{
        ...(upToDate ? { backgroundColor: typeColor } : {}),
        opacity: isDragging ? 0.4 : 1,
      }}
      title={title}
      aria-label={title}
      {...attributes}
      {...(listeners ?? {})}
      onPointerDown={(e) => {
        lp.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        listeners?.onPointerMove?.(e);
        lp.onPointerMove(e);
      }}
      onPointerUp={(e) => {
        listeners?.onPointerUp?.(e);
        lp.onPointerUp();
      }}
      onPointerCancel={(e) => {
        listeners?.onPointerCancel?.(e);
        lp.onPointerCancel();
      }}
    />
  );
}

export function MatrixDraggableTypeSlotPill({
  shiftWindowId,
  syllabusNum,
  coveredHours,
  displayHour,
  fill,
  title,
  highlightStartMs,
  highlightEndMs,
}: {
  shiftWindowId: number;
  syllabusNum: number;
  coveredHours: string[];
  displayHour: string;
  fill: string;
  title: string;
  highlightStartMs: number;
  highlightEndMs: number;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `type-slot-${shiftWindowId}-${syllabusNum}`,
    data: {
      kind: "typeSlot" as const,
      shiftWindowId,
      syllabusNum,
      coveredHours,
      displayHour,
      color: fill,
      highlightStartMs,
      highlightEndMs,
    },
  });
  return (
    <span
      ref={setNodeRef}
      data-matrix-pill
      className="block h-2.5 w-full max-w-full cursor-grab touch-none rounded-pill shadow-sm ring-1 ring-black/10 active:cursor-grabbing"
      style={{
        backgroundColor: fill,
        opacity: isDragging ? 0.4 : 1,
      }}
      title={title}
      aria-label={title}
      {...listeners}
      {...attributes}
    />
  );
}

/** Hour column drop target inside the employee matrix row (div, not td). */
export function MatrixEmployeeHourDropZone({
  employeeId,
  hour,
  hasEmployeeShiftInHour,
  droppableDisabled,
  className,
  onEmptyClick,
}: {
  employeeId: number;
  hour: string;
  hasEmployeeShiftInHour: boolean;
  /** `@dnd-kit` disabled when this cell must not accept the active drag. */
  droppableDisabled: boolean;
  className?: string;
  onEmptyClick: (e: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const { setNodeRef } = useDroppable({
    id: `emp-cell-${employeeId}-${hour}`,
    data: { employeeId, hour },
    disabled: droppableDisabled,
  });
  return (
    <div
      ref={setNodeRef}
      role="presentation"
      className={`min-h-[28px] min-w-0 flex-1 border-s border-line ${className ?? ""}`}
      onClick={(e) => {
        if (hasEmployeeShiftInHour) return;
        onEmptyClick(e);
      }}
    />
  );
}

export function EmployeeMatrixShiftPillChooser({
  shift,
  employeeId,
  clippedStartMs,
  clippedEndMs,
  typeColor,
  pillTitle,
  onLongPressDelete,
}: {
  shift: JsonObject;
  employeeId: number;
  clippedStartMs: number;
  clippedEndMs: number;
  typeColor: string;
  pillTitle: string;
  onLongPressDelete: () => void;
}) {
  const snRaw = shift.syllabus_num ?? shift.syllabusNum;
  const syllabusNum = Number(snRaw);
  const canDragEmp = Number.isFinite(syllabusNum) && !Number.isNaN(syllabusNum);
  const upToDate = shiftIsUpToDate(shift);
  const wid = Number(shift.shift_window_id ?? shift.shiftWindowId);

  const prepStart = String(shift.prep_start ?? shift.prepStart ?? "—");
  const restEnd = String(shift.rest_end ?? shift.restEnd ?? "—");
  const titleWithPrepRest = `${pillTitle}\nprep_start: ${prepStart} · rest_end: ${restEnd}`;

  if (canDragEmp && upToDate) {
    return (
      <MatrixDraggableEmployeeShiftPill
        shiftId={Number(shift.id)}
        shiftWindowId={wid}
        syllabusNum={syllabusNum}
        employeeId={employeeId}
        typeColor={typeColor}
        title={titleWithPrepRest}
        upToDate={upToDate}
        highlightStartMs={clippedStartMs}
        highlightEndMs={clippedEndMs}
        onLongPressDelete={onLongPressDelete}
      />
    );
  }
  return (
    <MatrixEmployeeShiftPill
      typeColor={typeColor}
      title={titleWithPrepRest}
      upToDate={upToDate}
      onLongPressDelete={onLongPressDelete}
    />
  );
}
