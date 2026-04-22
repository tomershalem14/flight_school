import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import type { JsonObject } from "../../../shared/api";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  clipIntervalToFrame,
  shiftPrepRestHmPairs,
  shiftWallIntervalMs,
} from "../../../shared/manningHours";
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
  syllabusRoleId,
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
  syllabusRoleId?: number;
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
      syllabusRoleId,
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
  syllabusRoleId,
  coveredHours,
  displayHour,
  fill,
  title,
  highlightStartMs,
  highlightEndMs,
}: {
  shiftWindowId: number;
  syllabusNum: number;
  syllabusRoleId?: number;
  coveredHours: string[];
  displayHour: string;
  fill: string;
  title: string;
  highlightStartMs: number;
  highlightEndMs: number;
}) {
  const dragId =
    syllabusRoleId != null
      ? `type-slot-${shiftWindowId}-${syllabusNum}-${syllabusRoleId}`
      : `type-slot-${shiftWindowId}-${syllabusNum}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: {
      kind: "typeSlot" as const,
      shiftWindowId,
      syllabusNum,
      syllabusRoleId,
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
  onEmptyClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const { setNodeRef } = useDroppable({
    id: `emp-cell-${employeeId}-${hour}`,
    data: { employeeId, hour },
    disabled: droppableDisabled,
  });
  const handleEmptyClick =
    onEmptyClick && !hasEmployeeShiftInHour
      ? (e: ReactMouseEvent<HTMLDivElement>) => onEmptyClick(e)
      : undefined;
  return (
    <div
      ref={setNodeRef}
      role="presentation"
      className={`min-h-[28px] h-full min-w-0 flex-1 self-stretch border-s border-line ${className ?? ""}`}
      onClick={handleEmptyClick}
    />
  );
}

/** Gray prep/rest timeline bands under the colored shift pill (employee matrix row). */
export function MatrixEmployeePrepRestBands({
  dateStr,
  shift,
  frameStartMs,
  frameEndMs,
  matrixRangeMs,
  zIndexBase,
  pillInsetClassName,
}: {
  dateStr: string;
  shift: JsonObject;
  frameStartMs: number;
  frameEndMs: number;
  matrixRangeMs: number;
  zIndexBase: number;
  pillInsetClassName: string;
}) {
  if (matrixRangeMs <= 0) return null;

  const sid = String(shift.id ?? "");
  const { prep, rest } = shiftPrepRestHmPairs(shift);

  const bands: Array<{
    key: string;
    startHm: string;
    endHm: string;
    title: string;
  }> = [];
  if (prep) {
    bands.push({
      key: "prep",
      startHm: prep.startHm,
      endHm: prep.endHm,
      title: `הכנה: ${prep.startHm}–${prep.endHm}`,
    });
  }
  if (rest) {
    bands.push({
      key: "rest",
      startHm: rest.startHm,
      endHm: rest.endHm,
      title: `מנוחה: ${rest.startHm}–${rest.endHm}`,
    });
  }

  if (bands.length === 0) return null;

  return (
    <>
      {bands.map(({ key, startHm, endHm, title }) => {
        const iv = shiftWallIntervalMs(dateStr, startHm, endHm);
        const clipped = clipIntervalToFrame(
          iv.startMs,
          iv.endMs,
          frameStartMs,
          frameEndMs,
        );
        if (!clipped) return null;
        const [s, e] = clipped;
        const leftPct = ((s - frameStartMs) / matrixRangeMs) * 100;
        const widthPct = ((e - s) / matrixRangeMs) * 100;
        if (widthPct <= 0) return null;
        return (
          <div
            key={`${sid}-${key}`}
            className="pointer-events-none absolute top-1/2 box-border -translate-y-1/2 py-0.5"
            style={{
              insetInlineStart: `${leftPct}%`,
              width: `${widthPct}%`,
              zIndex: zIndexBase,
            }}
            title={title}
            aria-hidden={true}
          >
            <div
              className={`box-border h-full min-h-0 w-full min-w-0 ${pillInsetClassName}`}
            >
              <span className="block h-2 w-full max-w-full rounded-pill bg-ink/25 shadow-sm ring-1 ring-black/10" />
            </div>
          </div>
        );
      })}
    </>
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
  const sridRaw = shift.syllabus_role_id ?? shift.syllabusRoleId;
  const syllabusRoleId =
    sridRaw !== undefined && sridRaw !== null && sridRaw !== ""
      ? Number(sridRaw)
      : undefined;

  const prepStart = String(shift.prep_start ?? shift.prepStart ?? "—");
  const restEnd = String(shift.rest_end ?? shift.restEnd ?? "—");
  const titleWithPrepRest = `${pillTitle}\nprep_start: ${prepStart} · rest_end: ${restEnd}`;

  if (canDragEmp && upToDate) {
    return (
      <MatrixDraggableEmployeeShiftPill
        shiftId={Number(shift.id)}
        shiftWindowId={wid}
        syllabusNum={syllabusNum}
        syllabusRoleId={
          syllabusRoleId !== undefined && !Number.isNaN(syllabusRoleId)
            ? syllabusRoleId
            : undefined
        }
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

export type ScheduleMatrixEventKind = "constraint" | "event" | "operational";

const EVENT_KIND_SURFACE: Record<
  ScheduleMatrixEventKind,
  string
> = {
  constraint: "bg-red-500/40 ring-1 ring-red-600/35",
  operational: "bg-emerald-300/45 ring-1 ring-emerald-700/25",
  event: "bg-sky-300 ring-1 ring-sky-600/30",
};

/** Solid fills for popup dots (same hues as matrix bars; matches `RoleColorDot` in management). */
const EVENT_KIND_DOT_HEX: Record<ScheduleMatrixEventKind, string> = {
  constraint: "#ef4444",
  event: "#7dd3fc",
  operational: "#6ee7b7",
};

function EventKindDot({ kind }: { kind: ScheduleMatrixEventKind }) {
  const c = EVENT_KIND_DOT_HEX[kind] ?? EVENT_KIND_DOT_HEX.event;
  return (
    <span
      className="size-2.5 shrink-0 rounded-full border border-line shadow-sm ring-1 ring-black/10"
      style={{ backgroundColor: c }}
      aria-hidden
    />
  );
}

export function MatrixScheduleEventBar({
  name,
  eventKind,
  leftPct,
  widthPct,
  zIndex,
  pillInsetClassName,
  showStartContinuation = false,
  showEndContinuation = false,
  onResizeEdgePointerDown,
  onLongPressDelete,
}: {
  name: string;
  eventKind: ScheduleMatrixEventKind;
  leftPct: number;
  widthPct: number;
  zIndex: number;
  pillInsetClassName: string;
  /** `start_time` is calendar `00:00` (continuation before visible window). */
  showStartContinuation?: boolean;
  /** `end_time` is calendar `23:59` (continuation after visible window). */
  showEndContinuation?: boolean;
  /** Drag inline-start / inline-end to resize start or end time (matrix quarter snap in parent). */
  onResizeEdgePointerDown?: (
    edge: "start" | "end",
    e: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  onLongPressDelete: () => void;
}) {
  const lp = useMatrixPillLongPress({ onLongPressDelete });
  const surface = EVENT_KIND_SURFACE[eventKind] ?? EVENT_KIND_SURFACE.event;
  return (
    <div
      data-matrix-schedule-event
      className={`pointer-events-auto absolute inset-y-0 box-border ${pillInsetClassName}`}
      style={{
        insetInlineStart: `${leftPct}%`,
        width: `${widthPct}%`,
        zIndex,
      }}
      title={name}
    >
      <div
        className={`relative flex h-full w-full min-h-0 items-stretch overflow-hidden rounded-sm ${surface}`}
      >
        {onResizeEdgePointerDown ? (
          <div
            role="separator"
            aria-label="הזזת תחילת האירוע"
            className="absolute inset-y-0 start-0 z-[5] w-1.5 shrink-0 cursor-col-resize touch-none"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onResizeEdgePointerDown("start", e);
            }}
          />
        ) : null}
        <span
          className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden px-1"
          title={name}
          aria-label={name}
          onPointerDown={lp.onPointerDown}
          onPointerMove={lp.onPointerMove}
          onPointerUp={lp.onPointerUp}
          onPointerCancel={lp.onPointerCancel}
        >
          {showStartContinuation ? (
            <span
              className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-0.5 font-heading text-[8px] font-semibold leading-none text-ink/80"
              aria-hidden
            >
              ▶
            </span>
          ) : null}
          {showEndContinuation ? (
            <span
              className="pointer-events-none absolute inset-y-0 end-0 flex items-center pe-0.5 font-heading text-[8px] font-semibold leading-none text-ink/80"
              aria-hidden
            >
              ◀
            </span>
          ) : null}
          <span className="min-w-0 max-w-full truncate text-center font-heading text-[9px] font-medium leading-tight text-ink">
            {name}
          </span>
        </span>
        {onResizeEdgePointerDown ? (
          <div
            role="separator"
            aria-label="הזזת סיום האירוע"
            className="absolute inset-y-0 end-0 z-[5] w-1.5 shrink-0 cursor-col-resize touch-none"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onResizeEdgePointerDown("end", e);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

export function MatrixEventCreatePopup({
  rootRef,
  top,
  left,
  timeLabel,
  name,
  onNameChange,
  onPickKind,
  isSubmitting,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  top: number;
  left: number;
  timeLabel: string;
  name: string;
  onNameChange: (v: string) => void;
  onPickKind: (k: ScheduleMatrixEventKind) => void;
  isSubmitting: boolean;
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const nameOk = name.trim().length > 0;
  const rowBtn =
    "flex w-full flex-row items-center justify-start gap-2 rounded border border-line bg-background/90 px-2 py-1.5 text-xs font-heading font-medium text-ink hover:bg-background disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div
      ref={rootRef}
      className="fixed z-[120] w-[min(200px,calc(100vw-16px))] rounded-md border border-line bg-surface p-2 shadow-lg"
      style={{ top, left }}
      dir="rtl"
    >
      <div className="mb-2 border-b border-line pb-1.5 text-right font-heading text-xs tabular-nums text-muted">
        {timeLabel}
      </div>
      <label className="mb-2 block">
        <span className="sr-only">שם</span>
        <input
          ref={nameInputRef}
          type="text"
          maxLength={18}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="שם"
          title="מקסימום 18 תווים לשם האירוע (רווחים נספרים כתו)"
          className="box-border !h-6 !max-h-6 !min-h-0 w-full appearance-none rounded border border-line bg-background !px-2 !py-0 text-right font-heading !text-xs !leading-6 text-ink outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
        />
      </label>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled={!nameOk || isSubmitting}
          className={rowBtn}
          onClick={() => onPickKind("constraint")}
        >
          <EventKindDot kind="constraint" />
          <span className="min-w-0 truncate">אילוץ</span>
        </button>
        <button
          type="button"
          disabled={!nameOk || isSubmitting}
          className={rowBtn}
          onClick={() => onPickKind("event")}
        >
          <EventKindDot kind="event" />
          <span className="min-w-0 truncate">אירוע</span>
        </button>
        <button
          type="button"
          disabled={!nameOk || isSubmitting}
          className={rowBtn}
          onClick={() => onPickKind("operational")}
        >
          <EventKindDot kind="operational" />
          <span className="min-w-0 truncate">משמרת</span>
        </button>
      </div>
    </div>
  );
}
