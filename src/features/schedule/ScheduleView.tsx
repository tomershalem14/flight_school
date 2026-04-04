import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useAppStore, weekStartString } from "../../app/store";
import * as api from "../../shared/api";
import { addDays, formatYmd } from "../../shared/dates";
import {
  coverageOf,
  dayBounds,
  hourLabelsTouchingRange,
  intersectCoverageOnDay,
  matrixFrameBoundsMs,
  matrixPrepAwareHourSlotsForDay,
  presetDurationById,
  shiftCoversHour,
  syllabusNumForHourInWindow,
  timeToMin,
  typesCoveringHourSlot,
  validSegmentStartTimes,
  windowDayTimeline,
} from "../../shared/manningHours";
import { DEFAULT_SHIFT_TYPE_PASTEL_HEX } from "../../shared/pastelPalette";
import { PastelSwatchGridDropdown } from "../../shared/PastelSwatchGridDropdown";
import { shiftTypePillColors } from "../../shared/shiftTypeColors";
import {
  coverageIsoToHm,
  formatTimeForInput,
  hourSlotEndHm,
} from "../../shared/timeFormat";
import type { JsonObject } from "../../shared/api";

function normalizeShiftRow(s: JsonObject): JsonObject {
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

function shiftIsUpToDate(s: JsonObject): boolean {
  const v = s.up_to_date ?? s.upToDate;
  if (v === false || v === 0 || v === "0") return false;
  return true;
}

function typeId(ty: JsonObject): number {
  return Number(ty.id);
}

/** Wall-clock interval for a shift on `dateStr` (handles end before start as next day). */
function shiftWallIntervalMs(
  dateStr: string,
  startHm: string,
  endHm: string,
): { startMs: number; endMs: number } {
  const d0 = dayBounds(dateStr).start.getTime();
  const sm = timeToMin(startHm);
  const em = timeToMin(endHm);
  const startMs = d0 + sm * 60_000;
  let endMs = d0 + em * 60_000;
  if (em <= sm) {
    endMs += 24 * 3600_000;
  }
  return { startMs, endMs };
}

/** Half-open wall intervals [a0,a1) and [b0,b1) overlap with positive duration. */
function wallIntervalsOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a1 > a0 && b1 > b0 && Math.max(a0, b0) < Math.min(a1, b1);
}

/** True if `employeeId` has an assigned shift whose wall interval overlaps `[intervalStartMs, intervalEndMs)`. */
function employeeHasShiftIntersectingInterval(
  dateStr: string,
  dayShifts: JsonObject[],
  employeeId: number,
  intervalStartMs: number,
  intervalEndMs: number,
  excludeShiftId?: number,
): boolean {
  for (const s of dayShifts) {
    if (excludeShiftId != null && Number(s.id) === excludeShiftId) continue;
    const se = s.employee_id;
    if (se === null || se === undefined || se === "") continue;
    if (Number(se) !== employeeId) continue;
    const iv = shiftWallIntervalMs(dateStr, String(s.start_time), String(s.end_time));
    if (wallIntervalsOverlap(iv.startMs, iv.endMs, intervalStartMs, intervalEndMs)) {
      return true;
    }
  }
  return false;
}

function clipIntervalToFrame(
  startMs: number,
  endMs: number,
  frameStart: number,
  frameEnd: number,
): [number, number] | null {
  const s = Math.max(startMs, frameStart);
  const e = Math.min(endMs, frameEnd);
  if (e <= s) return null;
  return [s, e];
}

function effectiveMatrixFrame(
  dateStr: string,
  hours: string[],
  frame: { frameStartMs: number; frameEndMs: number } | null,
): { frameStartMs: number; frameEndMs: number } | null {
  if (frame) return frame;
  if (hours.length === 0) return null;
  const d0 = dayBounds(dateStr).start.getTime();
  const sm = timeToMin(hours[0]!);
  const em = timeToMin(hours[hours.length - 1]!) + 60;
  return { frameStartMs: d0 + sm * 60_000, frameEndMs: d0 + em * 60_000 };
}

/** When `isEnd`, 00:00 means midnight at the start of the next calendar day. */
function coverageIsoFromDayAndHm(
  dateStr: string,
  hm: string,
  isEnd = false,
): string {
  const t = String(hm).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const hh = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    let dayStr = dateStr;
    if (isEnd && h === 0 && min === 0) {
      const ymdParts = dateStr.split("-").map(Number);
      const base = new Date(ymdParts[0], ymdParts[1] - 1, ymdParts[2]);
      dayStr = formatYmd(addDays(base, 1));
    }
    return `${dayStr}T${hh}:${mm}:00`;
  }
  return `${dateStr}T${t}`;
}

type WindowSegmentDraft = {
  syllabus_preset_id: number;
  segment_start_time: string;
};

function buildShiftWindowPayload(d: JsonObject, dateStr: string): JsonObject {
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

function defaultSyllabusPresetId(presets: JsonObject[]): number {
  const locked = presets.find((p) => Number(p.system_locked ?? p.systemLocked) === 1);
  if (locked) return Number(locked.id);
  const first = presets[0];
  return first ? Number(first.id) : 1;
}

function coverageEndIsNextDayMidnight(endHm: string): boolean {
  return (formatTimeForInput(endHm) || "") === "00:00";
}

type TypePickerState = {
  top: number;
  left: number;
  employeeId: number;
  employeeName: string;
  hour: string;
  start: string;
  end: string;
};

const PANEL_W = 280;

const LONG_PRESS_MS = 600;
const LONG_PRESS_MOVE_PX = 8;

/** Horizontal inset inside matrix pills; keep on inner wrapper so % / flex positioning stays exact. */
const MATRIX_PILL_INSET_X = "px-1";

/** Matrix drag band fill (`#7BA3B5` primary). */
const MATRIX_DRAG_HIGHLIGHT_OVER = "rgba(123, 163, 181, 0.28)";
const MATRIX_DRAG_HIGHLIGHT_IDLE = "rgba(123, 163, 181, 0.18)";

type MatrixTypeSlotDragData = {
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

type MatrixEmployeeShiftDragData = {
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

type ActiveDragHighlightMs = { startMs: number; endMs: number };

function matrixDragBandPercents(
  range: ActiveDragHighlightMs,
  frame: { frameStartMs: number; frameEndMs: number },
): { startPct: number; widthPct: number } | null {
  const clipped = clipIntervalToFrame(
    range.startMs,
    range.endMs,
    frame.frameStartMs,
    frame.frameEndMs,
  );
  if (!clipped) return null;
  const [s, e] = clipped;
  const rangeMs = frame.frameEndMs - frame.frameStartMs;
  if (rangeMs <= 0) return null;
  return {
    startPct: ((s - frame.frameStartMs) / rangeMs) * 100,
    widthPct: ((e - s) / rangeMs) * 100,
  };
}

function matrixPillDragSize(event: DragStartEvent): { width: number; height: number } | null {
  const initial = event.active.rect.current?.initial;
  if (initial && initial.width > 0 && initial.height > 0) {
    return { width: initial.width, height: initial.height };
  }
  const target = event.activatorEvent.target;
  if (target instanceof Element) {
    const pill = target.closest("[data-matrix-pill]");
    if (pill instanceof HTMLElement) {
      const r = pill.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { width: r.width, height: r.height };
    }
  }
  return null;
}

function MatrixEmployeeShiftPill({
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
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    startPos.current = null;
  }, []);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

  const moveThresholdSq = LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX;

  return (
    <span
      data-matrix-pill
      className={`block h-2.5 w-full max-w-full touch-none rounded-pill shadow-sm ring-1 ring-black/10 ${
        upToDate ? "" : "schedule-striped-warn-pill cursor-default"
      }`}
      style={upToDate ? { backgroundColor: typeColor } : undefined}
      title={title}
      aria-label={title}
      onPointerDown={(e) => {
        startPos.current = { x: e.clientX, y: e.clientY };
        longPressTimer.current = window.setTimeout(() => {
          longPressTimer.current = null;
          startPos.current = null;
          onLongPressDelete();
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        const s = startPos.current;
        if (s) {
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (dx * dx + dy * dy > moveThresholdSq) clearLongPress();
        }
      }}
      onPointerUp={() => {
        clearLongPress();
      }}
      onPointerCancel={() => {
        clearLongPress();
      }}
    />
  );
}

function MatrixDraggableEmployeeShiftPill({
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
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    startPos.current = null;
  }, []);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

  const moveThresholdSq = LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX;

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

  useEffect(() => {
    isDraggingRef.current = isDragging;
    if (isDragging) clearLongPress();
  }, [isDragging, clearLongPress]);

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
        listeners?.onPointerDown?.(e);
        startPos.current = { x: e.clientX, y: e.clientY };
        longPressTimer.current = window.setTimeout(() => {
          longPressTimer.current = null;
          startPos.current = null;
          if (isDraggingRef.current) return;
          onLongPressDelete();
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        listeners?.onPointerMove?.(e);
        const s = startPos.current;
        if (s) {
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (dx * dx + dy * dy > moveThresholdSq) clearLongPress();
        }
      }}
      onPointerUp={(e) => {
        listeners?.onPointerUp?.(e);
        clearLongPress();
      }}
      onPointerCancel={(e) => {
        listeners?.onPointerCancel?.(e);
        clearLongPress();
      }}
    />
  );
}

function MatrixDraggableTypeSlotPill({
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
function MatrixEmployeeHourDropZone({
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

type SyllabusPresetListPos = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

function SyllabusPresetCombo({
  presets,
  valueId,
  onPick,
  disabled,
  scrollContainerRef,
}: {
  presets: JsonObject[];
  valueId: number;
  onPick: (id: number) => void;
  disabled?: boolean;
  /** When set (e.g. modal body with overflow), keep the portaled list aligned on scroll. */
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [listPos, setListPos] = useState<SyllabusPresetListPos | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const selected = presets.find((p) => Number(p.id) === valueId);
  const label = selected ? String(selected.name ?? "") : "";
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return presets;
    return presets.filter((p) => String(p.name ?? "").toLowerCase().includes(qq));
  }, [presets, q]);

  const updateListPos = useCallback(() => {
    const root = anchorRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const spaceBelow = window.innerHeight - r.bottom - gap - margin;
    const maxHeight = Math.min(160, Math.max(80, spaceBelow));
    setListPos({
      top: r.bottom + gap,
      left: r.left,
      width: r.width,
      maxHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open || disabled) {
      setListPos(null);
      return;
    }
    updateListPos();
  }, [open, disabled, updateListPos, filtered.length]);

  useEffect(() => {
    if (!open || disabled) return;
    updateListPos();
    window.addEventListener("resize", updateListPos);
    const scrollEl = scrollContainerRef?.current;
    if (scrollEl) {
      scrollEl.addEventListener("scroll", updateListPos, { passive: true });
    }
    return () => {
      window.removeEventListener("resize", updateListPos);
      if (scrollEl) {
        scrollEl.removeEventListener("scroll", updateListPos);
      }
    };
  }, [open, disabled, updateListPos, scrollContainerRef]);

  const listEl =
    open && !disabled && listPos ? (
      <ul
        className="fixed z-[200] overflow-auto rounded-card border border-line bg-surface py-1 text-start shadow-airy"
        style={{
          top: listPos.top,
          left: listPos.left,
          width: listPos.width,
          maxHeight: listPos.maxHeight,
        }}
        role="listbox"
      >
        {filtered.map((p) => {
          const pid = Number(p.id);
          const roleHint = p.min_role_name != null ? String(p.min_role_name) : "";
          return (
            <li key={pid}>
              <button
                type="button"
                className="w-full px-2 py-1.5 text-start text-sm hover:bg-background"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(pid);
                  setOpen(false);
                  setQ("");
                }}
              >
                <span className="font-medium text-ink">{String(p.name ?? "")}</span>
                {roleHint ? (
                  <span className="block text-[10px] text-muted">{roleHint}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    ) : null;

  return (
    <div ref={anchorRef} className="relative min-w-0">
      <input
        className="w-full min-w-0"
        disabled={disabled}
        value={open ? q : label}
        placeholder="בחר סילבוס…"
        onFocus={() => {
          setOpen(true);
          // Clear query so the list shows every preset; seeding `q` with the label
          // would filter to names containing that substring (often only the default).
          setQ("");
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
        }}
      />
      {listEl ? createPortal(listEl, document.body) : null}
    </div>
  );
}

function ShiftWindowDraftFormFields({
  draft,
  setDraft,
  presets,
  dateStr,
  shiftTypeTimeError,
  setShiftTypeTimeError,
  saveErrorMessage,
  scrollContainerRef,
}: {
  draft: JsonObject;
  setDraft: (next: JsonObject) => void;
  presets: JsonObject[];
  dateStr: string;
  shiftTypeTimeError: string | null;
  setShiftTypeTimeError: (v: string | null) => void;
  saveErrorMessage: string | null;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}) {
  const segments = (draft.segments as WindowSegmentDraft[]) ?? [];
  const durs = useMemo(() => presetDurationById(presets), [presets]);
  const covStart = formatTimeForInput(String(draft.coverage_start_time ?? "06:00")) || "06:00";
  const covEnd = formatTimeForInput(String(draft.coverage_end_time ?? "21:00")) || "21:00";
  const endNext = coverageEndIsNextDayMidnight(covEnd);

  return (
    <>
      {saveErrorMessage && (
        <p className="rounded-card border border-peach-3/50 bg-peach-1/40 px-3 py-2 text-sm text-ink">
          {saveErrorMessage}
        </p>
      )}
      {shiftTypeTimeError && (
        <p className="rounded-card border border-peach-3/50 bg-peach-1/40 px-3 py-2 text-sm text-ink">
          {shiftTypeTimeError}
        </p>
      )}
      <div className="form-row">
        <label className="text-sm font-semibold text-ink">שם תצוגה</label>
        <input
          value={String(draft.name ?? "")}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </div>
      <div className="form-row">
        <label className="text-sm font-semibold text-ink">התחלת חלון</label>
        <input
          type="time"
          dir="ltr"
          value={covStart}
          onChange={(e) => {
            setShiftTypeTimeError(null);
            const v = e.target.value;
            const nextSegs = segments.length
              ? segments.map((s, i) =>
                  i === 0
                    ? { ...s, segment_start_time: formatTimeForInput(v) || v }
                    : s,
                )
              : [];
            setDraft({
              ...draft,
              coverage_start_time: v,
              segments: nextSegs,
            });
          }}
        />
      </div>
      <div className="form-row">
        <label className="text-sm font-semibold text-ink">סיום חלון</label>
        <input
          type="time"
          dir="ltr"
          value={covEnd}
          onChange={(e) => {
            setShiftTypeTimeError(null);
            setDraft({ ...draft, coverage_end_time: e.target.value });
          }}
        />
      </div>
      <div className="form-row">
        <label className="text-sm font-semibold text-ink">הערות</label>
        <input
          value={String(draft.notes ?? "")}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </div>

      <div className="rounded-card border border-line bg-background/50 px-3 py-2">
        <div className="mb-2 text-sm font-semibold text-ink">סילבוסים בחלון</div>
        <div className="grid grid-cols-[3fr_1fr] gap-2 border-b border-line pb-2 text-xs font-bold uppercase tracking-wide text-muted">
          <span className="min-w-0">סילבוס</span>
          <span dir="ltr" className="min-w-0 text-end">
            שעת התחלה
          </span>
        </div>
        <div className="mt-2 space-y-2">
          {segments.map((seg, idx) => {
            const timeOpts =
              idx === 0
                ? [formatTimeForInput(covStart) || covStart]
                : validSegmentStartTimes(
                    dateStr,
                    covStart,
                    covEnd,
                    endNext,
                    segments.slice(0, idx),
                    idx,
                    durs,
                  );
            return (
              <div
                key={`seg-${idx}-${seg.segment_start_time}`}
                className="grid grid-cols-[3fr_1fr] items-end gap-2"
              >
                <div className="min-w-0">
                  <SyllabusPresetCombo
                    presets={presets}
                    valueId={Number(seg.syllabus_preset_id)}
                    scrollContainerRef={scrollContainerRef}
                    onPick={(id) => {
                      const next = segments.map((s, j) =>
                        j === idx ? { ...s, syllabus_preset_id: id } : s,
                      );
                      setDraft({ ...draft, segments: next });
                    }}
                  />
                </div>
                <div className="min-w-0">
                  <select
                    dir="ltr"
                    className="w-full min-w-0 text-center text-sm"
                    disabled={idx === 0}
                    value={(() => {
                      const cur =
                        idx === 0
                          ? formatTimeForInput(covStart) || covStart
                          : formatTimeForInput(seg.segment_start_time) || timeOpts[0] || "";
                      return timeOpts.includes(cur) ? cur : (timeOpts[0] ?? cur);
                    })()}
                    onChange={(e) => {
                      if (idx === 0) return;
                      const next = segments.map((s, j) =>
                        j === idx ? { ...s, segment_start_time: e.target.value } : s,
                      );
                      setDraft({ ...draft, segments: next });
                    }}
                  >
                    {timeOpts.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-pill border border-line bg-background px-3 py-1.5 text-sm font-semibold text-ink hover:border-primary/40"
            onClick={() => {
              if (segments.length === 0) return;
              const last = segments[segments.length - 1];
              const opts = validSegmentStartTimes(
                dateStr,
                covStart,
                covEnd,
                endNext,
                segments,
                segments.length,
                durs,
              );
              const nextTime = opts[0];
              if (!nextTime) {
                window.alert("אין זמן התחלה חוקי נוסף לפני סיום החלון.");
                return;
              }
              setDraft({
                ...draft,
                segments: [
                  ...segments,
                  {
                    syllabus_preset_id: last.syllabus_preset_id,
                    segment_start_time: nextTime,
                  },
                ],
              });
            }}
          >
            + הוסף סילבוס
          </button>
          {segments.length > 1 ? (
            <button
              type="button"
              className="rounded-pill border border-line px-3 py-1.5 text-sm text-muted hover:bg-peach-1/30"
              onClick={() =>
                setDraft({
                  ...draft,
                  segments: segments.slice(0, -1),
                })
              }
            >
              הסר שורה אחרונה
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function ScheduleView() {
  const currentDay = useAppStore((s) => s.currentDay);
  const qc = useQueryClient();
  const dateStr = formatYmd(currentDay);
  const weekStr = weekStartString(currentDay);
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => api.getEmployees(true),
  });
  const { data: presetsRaw = [] } = useQuery({
    queryKey: ["syllabus_presets"],
    queryFn: () => api.getSyllabusPresets(),
  });
  const presets = useMemo(() => presetsRaw as JsonObject[], [presetsRaw]);
  const durationByPreset = useMemo(() => presetDurationById(presets), [presets]);

  const { data: typesRaw = [] } = useQuery({
    queryKey: ["shift_windows", dateStr],
    queryFn: () => api.getShiftWindows(dateStr),
  });
  const types = useMemo(() => typesRaw as JsonObject[], [typesRaw]);
  const typesOrdered = useMemo(
    () => [...types].sort((a, b) => typeId(a) - typeId(b)),
    [types],
  );
  const hours = useMemo(
    () => matrixPrepAwareHourSlotsForDay(dateStr, types, presets),
    [dateStr, types, presets],
  );
  const matrixFrame = useMemo(
    () => matrixFrameBoundsMs(dateStr, types, presets),
    [dateStr, types, presets],
  );
  const scheduleMatrixFrame = useMemo(
    () => effectiveMatrixFrame(dateStr, hours, matrixFrame),
    [dateStr, hours, matrixFrame],
  );

  const { data: shiftsRaw = [] } = useQuery({
    queryKey: ["shifts", weekStr],
    queryFn: () => api.getShifts(weekStr),
  });
  const shifts = useMemo(
    () => shiftsRaw.map((s) => normalizeShiftRow(s as JsonObject)),
    [shiftsRaw],
  );

  const dayShifts = useMemo(
    () => shifts.filter((s) => String(s.shift_date) === dateStr),
    [shifts, dateStr],
  );

  const [typePicker, setTypePicker] = useState<TypePickerState | null>(null);
  const [deleteTypeConfirm, setDeleteTypeConfirm] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [shiftTypeDraft, setShiftTypeDraft] = useState<JsonObject | null>(null);
  const [swatchMenuOpen, setSwatchMenuOpen] = useState(false);
  const [shiftTypeTimeError, setShiftTypeTimeError] = useState<string | null>(null);
  const [activeDragHighlightMs, setActiveDragHighlightMs] =
    useState<ActiveDragHighlightMs | null>(null);
  const [matrixDragOverId, setMatrixDragOverId] = useState<string | null>(null);
  const [dragOverlayColor, setDragOverlayColor] = useState<string | null>(null);
  const [dragOverlaySize, setDragOverlaySize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [matrixDragKind, setMatrixDragKind] = useState<
    "typeSlot" | "empShift" | null
  >(null);
  const [matrixTypeSlotCoveredHours, setMatrixTypeSlotCoveredHours] = useState<
    string[] | null
  >(null);
  const [matrixEmpDragShiftId, setMatrixEmpDragShiftId] = useState<number | null>(
    null,
  );
  const suppressCellClickUntil = useRef(0);
  const shiftTypeModalBodyRef = useRef<HTMLDivElement>(null);
  const matrixScrollRef = useRef<HTMLDivElement>(null);
  /** Scrolls with table; band is `absolute` relative to this — not the overflow viewport. */
  const matrixTableWrapRef = useRef<HTMLDivElement>(null);
  const matrixTableRef = useRef<HTMLTableElement>(null);
  const matrixHourStripThRef = useRef<HTMLTableCellElement>(null);
  const [matrixUnifiedBand, setMatrixUnifiedBand] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    startPct: number;
    widthPct: number;
  } | null>(null);

  const updateMatrixUnifiedBand = useCallback(() => {
    const wrap = matrixTableWrapRef.current;
    const th = matrixHourStripThRef.current;
    const table = matrixTableRef.current;
    if (!activeDragHighlightMs || !wrap || !th || !table) {
      setMatrixUnifiedBand(null);
      return;
    }
    const frame = scheduleMatrixFrame;
    if (!frame || frame.frameEndMs <= frame.frameStartMs) {
      setMatrixUnifiedBand(null);
      return;
    }
    const p = matrixDragBandPercents(activeDragHighlightMs, frame);
    if (!p) {
      setMatrixUnifiedBand(null);
      return;
    }
    const wr = wrap.getBoundingClientRect();
    const hr = th.getBoundingClientRect();
    const tr = table.getBoundingClientRect();
    // Offsets vs scroll *content* (wrap moves with the table); do not add scrollTop/scrollLeft.
    const top = hr.top - wr.top;
    const left = hr.left - wr.left;
    const width = hr.width;
    const height = Math.max(0, tr.bottom - hr.top);
    setMatrixUnifiedBand({
      top,
      left,
      width,
      height,
      startPct: p.startPct,
      widthPct: p.widthPct,
    });
  }, [activeDragHighlightMs, scheduleMatrixFrame]);

  useLayoutEffect(() => {
    if (!activeDragHighlightMs) {
      setMatrixUnifiedBand(null);
      return;
    }
    const wrap = matrixTableWrapRef.current;
    const scroll = matrixScrollRef.current;
    if (!wrap) return;
    updateMatrixUnifiedBand();
    const ro = new ResizeObserver(() => {
      updateMatrixUnifiedBand();
    });
    ro.observe(wrap);
    const tbl = matrixTableRef.current;
    if (tbl) ro.observe(tbl);
    window.addEventListener("resize", updateMatrixUnifiedBand);
    if (scroll) {
      scroll.addEventListener("scroll", updateMatrixUnifiedBand, { passive: true });
    }
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateMatrixUnifiedBand);
      if (scroll) scroll.removeEventListener("scroll", updateMatrixUnifiedBand);
    };
  }, [activeDragHighlightMs, updateMatrixUnifiedBand]);

  const clearMatrixDragOverlay = useCallback(() => {
    setActiveDragHighlightMs(null);
    setMatrixUnifiedBand(null);
    setMatrixDragOverId(null);
    setDragOverlayColor(null);
    setDragOverlaySize(null);
    setMatrixDragKind(null);
    setMatrixTypeSlotCoveredHours(null);
    setMatrixEmpDragShiftId(null);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  /** Types that cover this hour and have no assigned shift of that type covering this hour on this day. */
  const typesAvailableForPicker = useMemo(() => {
    if (!typePicker) return [];
    const hour = typePicker.hour;
    const covering = typesCoveringHourSlot(types, dateStr, hour);
    return covering.filter((ty) => {
      if (syllabusNumForHourInWindow(dateStr, ty, hour, durationByPreset) == null)
        return false;
      const tid = typeId(ty);
      const hasAssigned = dayShifts.some((s) => {
        const sid = Number(s.shift_window_id ?? s.shiftWindowId);
        if (sid !== tid) return false;
        if (!shiftCoversHour(String(s.start_time), String(s.end_time), hour)) return false;
        const eid = s.employee_id;
        return eid !== null && eid !== undefined && eid !== "";
      });
      return !hasAssigned;
    });
  }, [typePicker, types, dateStr, dayShifts, durationByPreset]);

  const reassignMut = useMutation({
    mutationFn: (args: { shift_id: number; employee_id: number }) =>
      api.reassignShiftEmployee({
        shift_id: args.shift_id,
        employee_id: args.employee_id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
    },
    onError: (err) => {
      window.alert(err instanceof Error ? err.message : String(err));
    },
  });

  const createMut = useMutation({
    mutationFn: (args: {
      shift_window_id: number;
      employee_id: number;
      syllabus_num: number;
    }) =>
      api.createShift({
        shift_date: dateStr,
        shift_window_id: args.shift_window_id,
        syllabus_num: args.syllabus_num,
        employee_id: args.employee_id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
      setTypePicker(null);
    },
    onError: (err) => {
      window.alert(err instanceof Error ? err.message : String(err));
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteShift(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
    },
    onError: (err) => {
      window.alert(err instanceof Error ? err.message : String(err));
    },
  });

  const deleteShiftWindowMut = useMutation({
    mutationFn: (id: number) => api.deleteShiftWindow(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift_windows"] });
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
      setDeleteTypeConfirm(null);
      setTypePicker(null);
    },
  });

  const createShiftWindowMut = useMutation({
    mutationFn: (payload: JsonObject) => api.createShiftWindow(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift_windows"] });
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
      setShiftTypeDraft(null);
    },
    onError: (err) => {
      window.alert(err instanceof Error ? err.message : String(err));
    },
  });

  const updateShiftWindowMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: JsonObject }) =>
      api.updateShiftWindow(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift_windows"] });
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
      setShiftTypeDraft(null);
    },
    onError: (err) => {
      window.alert(err instanceof Error ? err.message : String(err));
    },
  });

  function openEditShiftTypeModal(ty: JsonObject) {
    createShiftWindowMut.reset();
    updateShiftWindowMut.reset();
    setShiftTypeTimeError(null);
    setSwatchMenuOpen(false);
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
    setShiftTypeDraft({
      id: typeId(ty),
      name: String(ty.name ?? ""),
      coverage_start_time: covStartHm || "06:00",
      coverage_end_time: covEndHm || "21:00",
      color: String(ty.color ?? DEFAULT_SHIFT_TYPE_PASTEL_HEX),
      notes: ty.notes != null ? String(ty.notes) : "",
      segments,
    });
  }

  useEffect(() => {
    if (!shiftTypeDraft) setSwatchMenuOpen(false);
  }, [shiftTypeDraft]);

  useEffect(() => {
    if (!typePicker && !deleteTypeConfirm && !shiftTypeDraft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (shiftTypeDraft && swatchMenuOpen) {
        setSwatchMenuOpen(false);
        return;
      }
      setTypePicker(null);
      setDeleteTypeConfirm(null);
      setShiftTypeDraft(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [typePicker, deleteTypeConfirm, shiftTypeDraft, swatchMenuOpen]);

  function openAddShiftTypeModal() {
    createShiftWindowMut.reset();
    updateShiftWindowMut.reset();
    setShiftTypeTimeError(null);
    setSwatchMenuOpen(false);
    const covStart = "06:00";
    const pid = defaultSyllabusPresetId(presets);
    setShiftTypeDraft({
      name: "",
      coverage_start_time: covStart,
      coverage_end_time: "21:00",
      color: DEFAULT_SHIFT_TYPE_PASTEL_HEX,
      notes: "",
      segments: [{ syllabus_preset_id: pid, segment_start_time: covStart }],
    });
  }

  function openTypePicker(
    rect: DOMRect,
    employeeId: number,
    employeeName: string,
    hour: string,
  ) {
    const start = hour;
    const end = hourSlotEndHm(hour);
    let left = rect.left;
    if (left + PANEL_W > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - PANEL_W - 8);
    }
    let top = rect.bottom + 6;
    const maxTop = window.innerHeight - 280;
    if (top > maxTop) top = Math.max(8, rect.top - 260);
    setTypePicker({
      top,
      left,
      employeeId,
      employeeName,
      hour,
      start,
      end,
    });
  }

  const handleMatrixDragStart = useCallback((event: DragStartEvent) => {
    const d = event.active.data.current as
      | MatrixTypeSlotDragData
      | MatrixEmployeeShiftDragData
      | undefined;
    if (!d) return;
    if (d.kind === "typeSlot") {
      setMatrixDragKind("typeSlot");
      setMatrixTypeSlotCoveredHours(d.coveredHours);
      setMatrixEmpDragShiftId(null);
      setActiveDragHighlightMs({
        startMs: d.highlightStartMs,
        endMs: d.highlightEndMs,
      });
      setDragOverlayColor(d.color);
      setDragOverlaySize(matrixPillDragSize(event));
      return;
    }
    if (d.kind === "empShift") {
      setMatrixDragKind("empShift");
      setMatrixTypeSlotCoveredHours(null);
      setMatrixEmpDragShiftId(d.shiftId);
      setActiveDragHighlightMs({
        startMs: d.highlightStartMs,
        endMs: d.highlightEndMs,
      });
      setDragOverlayColor(d.color);
      setDragOverlaySize(matrixPillDragSize(event));
    }
  }, []);

  const handleMatrixDragCancel = useCallback(() => {
    clearMatrixDragOverlay();
  }, [clearMatrixDragOverlay]);

  const handleMatrixDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const dragData = active.data.current as
        | MatrixTypeSlotDragData
        | MatrixEmployeeShiftDragData
        | undefined;

      clearMatrixDragOverlay();
      suppressCellClickUntil.current = Date.now() + 400;

      if (!over || !dragData) return;

      const o = over.data.current as { employeeId?: number; hour?: string } | undefined;
      if (!o || o.employeeId === undefined || o.hour === undefined) return;

      if (dragData.kind === "empShift") {
        if (o.employeeId === dragData.employeeId) return;
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
          return;
        }
        reassignMut.mutate({
          shift_id: dragData.shiftId,
          employee_id: o.employeeId,
        });
        return;
      }

      if (dragData.kind !== "typeSlot") return;

      const dropEmpId = o.employeeId;
      const dropHour = o.hour;
      if (!dragData.coveredHours.includes(dropHour)) return;

      if (
        employeeHasShiftIntersectingInterval(
          dateStr,
          dayShifts,
          dropEmpId,
          dragData.highlightStartMs,
          dragData.highlightEndMs,
        )
      ) {
        return;
      }

      createMut.mutate({
        shift_window_id: dragData.shiftWindowId,
        employee_id: dropEmpId,
        syllabus_num: dragData.syllabusNum,
      });
    },
    [clearMatrixDragOverlay, createMut, dateStr, dayShifts, reassignMut],
  );

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      {hours.length === 0 ? (
        <button
          type="button"
          className="flex min-h-[min(calc(50vh/3),94px)] w-full items-center justify-center rounded-card border-2 border-dashed border-line bg-surface py-3 text-base font-heading font-semibold text-primary shadow-airy hover:border-primary/40 hover:bg-background"
          onClick={openAddShiftTypeModal}
        >
          + הוסף חלון
        </button>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={(e: DragStartEvent) => {
            setMatrixDragOverId(null);
            handleMatrixDragStart(e);
          }}
          onDragOver={(e: DragOverEvent) => {
            setMatrixDragOverId(e.over?.id != null ? String(e.over.id) : null);
          }}
          onDragEnd={handleMatrixDragEnd}
          onDragCancel={handleMatrixDragCancel}
        >
          <div
            ref={matrixScrollRef}
            className="w-full overflow-auto rounded-card border border-line bg-surface shadow-airy"
          >
            <div ref={matrixTableWrapRef} className="relative w-full min-w-full">
            <table
              ref={matrixTableRef}
              className="w-full min-w-full table-fixed border-collapse"
            >
            <colgroup>
              <col className="w-[6.6rem]" />
              {hours.map((h) => (
                <col key={h} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky right-0 z-20 w-[6.6rem] min-w-0 border-b border-line border-s border-line bg-surface px-2 py-1 text-start font-heading text-[10px] font-bold uppercase tracking-wide text-muted">
                  <span className="block truncate">מפעיל</span>
                </th>
                <th
                  ref={matrixHourStripThRef}
                  colSpan={hours.length}
                  className="border-b border-line bg-background/80 px-0 py-1 align-middle"
                >
                  <div className="flex min-h-[1.75rem] w-full items-center">
                    {hours.map((h) => (
                      <div
                        key={h}
                        className="min-w-0 flex-1 text-center font-heading text-[10px] font-bold text-muted"
                      >
                        {h.slice(0, 2)}
                      </div>
                    ))}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => {
                const eid = Number(emp.id);
                const name = String(emp.name ?? "");
                const rowShifts = dayShifts.filter((s) => {
                  const se = s.employee_id;
                  if (se === null || se === undefined || se === "") return false;
                  return Number(se) === eid;
                });
                return (
                  <tr key={eid} className="border-b border-line hover:bg-peach-1/30">
                    <td className="sticky right-0 z-10 w-[6.6rem] max-w-[6.6rem] min-w-0 border-s border-line bg-surface px-2 py-0.5 align-middle">
                      <span
                        className="block truncate font-heading text-sm font-bold text-ink"
                        title={name}
                      >
                        {name}
                      </span>
                    </td>
                    {(() => {
                      const empFrame = effectiveMatrixFrame(dateStr, hours, matrixFrame);
                      const rangeMs =
                        empFrame && empFrame.frameEndMs > empFrame.frameStartMs
                          ? empFrame.frameEndMs - empFrame.frameStartMs
                          : 0;
                      return (
                        <td
                          colSpan={hours.length}
                          className="relative border-s border-line px-0 py-0.5 align-middle"
                        >
                          <div className="relative min-h-[28px] w-full">
                            <div className="absolute inset-0 z-0 flex">
                              {hours.map((hour) => {
                                const hasShift = rowShifts.some((s) =>
                                  shiftCoversHour(
                                    String(s.start_time),
                                    String(s.end_time),
                                    hour,
                                  ),
                                );
                                const hl = activeDragHighlightMs;
                                let droppableDisabled: boolean;
                                if (matrixDragKind === null || !hl) {
                                  droppableDisabled = hasShift;
                                } else if (matrixDragKind === "typeSlot") {
                                  const ch = matrixTypeSlotCoveredHours ?? [];
                                  droppableDisabled =
                                    !ch.includes(hour) ||
                                    employeeHasShiftIntersectingInterval(
                                      dateStr,
                                      dayShifts,
                                      eid,
                                      hl.startMs,
                                      hl.endMs,
                                    );
                                } else {
                                  droppableDisabled =
                                    employeeHasShiftIntersectingInterval(
                                      dateStr,
                                      dayShifts,
                                      eid,
                                      hl.startMs,
                                      hl.endMs,
                                      matrixEmpDragShiftId ?? undefined,
                                    );
                                }
                                return (
                                  <MatrixEmployeeHourDropZone
                                    key={`${eid}-dz-${hour}`}
                                    employeeId={eid}
                                    hour={hour}
                                    hasEmployeeShiftInHour={hasShift}
                                    droppableDisabled={droppableDisabled}
                                    className={`cursor-pointer ${hasShift ? "" : "bg-background/40"}`}
                                    onEmptyClick={(e) => {
                                      if (Date.now() < suppressCellClickUntil.current) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        return;
                                      }
                                      openTypePicker(
                                        e.currentTarget.getBoundingClientRect(),
                                        eid,
                                        name,
                                        hour,
                                      );
                                    }}
                                  />
                                );
                              })}
                            </div>
                            {empFrame && rangeMs > 0 ? (
                              <div className="pointer-events-none relative z-[2] min-h-[28px] w-full">
                                {[...rowShifts]
                                  .sort(
                                    (a, b) =>
                                      timeToMin(String(a.start_time)) -
                                        timeToMin(String(b.start_time)) ||
                                      Number(a.id) - Number(b.id),
                                  )
                                  .map((shift, idx) => {
                                  const iv = shiftWallIntervalMs(
                                    dateStr,
                                    String(shift.start_time),
                                    String(shift.end_time),
                                  );
                                  const clipped = clipIntervalToFrame(
                                    iv.startMs,
                                    iv.endMs,
                                    empFrame.frameStartMs,
                                    empFrame.frameEndMs,
                                  );
                                  if (!clipped) return null;
                                  const [s, e] = clipped;
                                  const leftPct = ((s - empFrame.frameStartMs) / rangeMs) * 100;
                                  const widthPct = ((e - s) / rangeMs) * 100;
                                  // Match window row / flight board: color comes from shift_windows (API type_color), not syllabus preset (#6366F1 default).
                                  const typeColor = String(
                                    shift.type_color ?? shift.typeColor ?? "#7BA3B5",
                                  );
                                  const overlap = rowShifts.filter((o) => {
                                    if (Number(o.id) === Number(shift.id)) return false;
                                    const oiv = shiftWallIntervalMs(
                                      dateStr,
                                      String(o.start_time),
                                      String(o.end_time),
                                    );
                                    return (
                                      Math.max(iv.startMs, oiv.startMs) <
                                      Math.min(iv.endMs, oiv.endMs)
                                    );
                                  });
                                  const extra = overlap.length;
                                  const pillTitle =
                                    String(shift.type_name ?? "") +
                                    (extra > 0 ? ` (+${extra} משמרות נוספות באותה תא)` : "");
                                  return (
                                    <div
                                      key={`${eid}-pill-${shift.id}`}
                                      className="pointer-events-auto absolute top-1/2 box-border -translate-y-1/2 py-0.5"
                                      style={{
                                        // Physical `left` ignores direction; hour columns follow
                                        // inline-start in RTL, so use inset-inline-start to align pills.
                                        insetInlineStart: `${leftPct}%`,
                                        width: `${widthPct}%`,
                                        zIndex: 10 + idx,
                                      }}
                                    >
                                      <div
                                        className={`box-border h-full min-h-0 w-full min-w-0 ${MATRIX_PILL_INSET_X}`}
                                      >
                                      {(() => {
                                        const snRaw = shift.syllabus_num ?? shift.syllabusNum;
                                        const syllabusNum = Number(snRaw);
                                        const canDragEmp =
                                          Number.isFinite(syllabusNum) &&
                                          !Number.isNaN(syllabusNum);
                                        const wid = Number(
                                          shift.shift_window_id ?? shift.shiftWindowId,
                                        );
                                        const onDel = () => {
                                          suppressCellClickUntil.current = Date.now() + 400;
                                          deleteMut.mutate(Number(shift.id));
                                        };
                                        if (canDragEmp) {
                                          return (
                                            <MatrixDraggableEmployeeShiftPill
                                              shiftId={Number(shift.id)}
                                              shiftWindowId={wid}
                                              syllabusNum={syllabusNum}
                                              employeeId={eid}
                                              typeColor={typeColor}
                                              title={pillTitle}
                                              upToDate={shiftIsUpToDate(shift)}
                                              highlightStartMs={s}
                                              highlightEndMs={e}
                                              onLongPressDelete={onDel}
                                            />
                                          );
                                        }
                                        return (
                                          <MatrixEmployeeShiftPill
                                            typeColor={typeColor}
                                            title={pillTitle}
                                            upToDate={shiftIsUpToDate(shift)}
                                            onLongPressDelete={onDel}
                                          />
                                        );
                                      })()}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      );
                    })()}
                  </tr>
                );
              })}
              {typesOrdered.map((ty, idx) => {
                const tid = typeId(ty);
                const typeName = String(ty.name ?? "");
                const { base, muted } = shiftTypePillColors(String(ty.color ?? "#7BA3B5"));
                const { segments, tailGap } = windowDayTimeline(
                  dateStr,
                  ty,
                  durationByPreset,
                  base,
                );
                const rowFrame = effectiveMatrixFrame(dateStr, hours, matrixFrame);
                const cov = coverageOf(ty);
                const dayInter = intersectCoverageOnDay(dateStr, cov.start, cov.end);
                const leftPadMs =
                  matrixFrame && dayInter
                    ? Math.max(0, dayInter.start.getTime() - matrixFrame.frameStartMs)
                    : 0;
                const rightPadMs =
                  matrixFrame && dayInter
                    ? Math.max(0, matrixFrame.frameEndMs - dayInter.end.getTime())
                    : 0;
                return (
                  <tr
                    key={`shift-type-row-${tid}`}
                    className={`border-b border-line bg-ink/[0.055] ${
                      idx === 0 ? "border-t-2 border-t-line" : ""
                    }`}
                  >
                    <td className="sticky right-0 z-10 w-[6.6rem] max-w-[6.6rem] min-w-0 border-s border-line bg-ink/[0.055] px-2 py-0.5 align-middle">
                      <div className="group flex min-w-0 items-center gap-1">
                        <span
                          className="min-w-0 flex-1 truncate font-heading text-sm font-semibold text-ink"
                          title={typeName}
                        >
                          {typeName}
                        </span>
                        <button
                          type="button"
                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line bg-background text-muted opacity-0 transition-opacity hover:border-primary/40 hover:bg-background hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
                          aria-label={`עריכת חלון ${typeName}`}
                          title="עריכת חלון"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditShiftTypeModal(ty);
                          }}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="h-3 w-3"
                            aria-hidden={true}
                          >
                            <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.64.64l3.155-1.262a2 2 0 001.21-.825L14.5 7.5 12.5 5.5 3.58 14.42a2 2 0 00-.885 1.343zM15.232 5.232l1.536-1.536a1 1 0 000-1.414l-1.172-1.172a1 1 0 00-1.414 0l-1.536 1.536 2.586 2.586z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                    <td
                      colSpan={hours.length}
                      className="min-h-[28px] border-s border-line bg-ink/[0.055] px-0 py-0.5 align-middle"
                    >
                      {/* No flex gap: gaps break ms-proportional alignment with column grid.
                          Per-segment inner padding (MATRIX_PILL_INSET_X) insets pills only; flex ratios unchanged. */}
                      <div className="flex min-h-[28px] w-full items-center">
                        {leftPadMs > 0 ? (
                          <div
                            className="min-w-0 shrink"
                            style={{ flex: `${leftPadMs} 1 0` }}
                            aria-hidden={true}
                          />
                        ) : null}
                        {segments.map((seg) => {
                          const coveredHours = hourLabelsTouchingRange(seg.startMs, seg.endMs);
                          const displayHour =
                            coveredHours[0] ??
                            `${String(new Date(seg.startMs).getHours()).padStart(2, "0")}:00`;
                          const assigned = dayShifts.filter((s) => {
                            const sid = Number(s.shift_window_id ?? s.shiftWindowId);
                            if (sid !== tid) return false;
                            const eid = s.employee_id;
                            if (eid === null || eid === undefined || eid === "") return false;
                            const slotIdx = Number(s.syllabus_num ?? s.syllabusNum);
                            if (Number.isFinite(slotIdx)) {
                              return slotIdx === seg.syllabusNum;
                            }
                            const sIv = shiftWallIntervalMs(
                              dateStr,
                              String(s.start_time),
                              String(s.end_time),
                            );
                            return wallIntervalsOverlap(
                              sIv.startMs,
                              sIv.endMs,
                              seg.startMs,
                              seg.endMs,
                            );
                          });
                          const hasAssigned = assigned.length > 0;
                          const fillOpen = base;
                          const fillManned = muted;
                          const names = [
                            ...new Set(
                              assigned
                                .map((s) => String(s.emp_name ?? s.empName ?? "").trim())
                                .filter(Boolean),
                            ),
                          ];
                          const title =
                            `${typeName} · ${displayHour}` +
                            (hasAssigned
                              ? ` — מאויש: ${names.join(", ")}`
                              : " — זמין לאיוש");
                          const flexGrow = Math.max(1, seg.endMs - seg.startMs);
                          const hl =
                            rowFrame && rowFrame.frameEndMs > rowFrame.frameStartMs
                              ? clipIntervalToFrame(
                                  seg.startMs,
                                  seg.endMs,
                                  rowFrame.frameStartMs,
                                  rowFrame.frameEndMs,
                                )
                              : null;
                          const highlightStartMs = hl ? hl[0] : seg.startMs;
                          const highlightEndMs = hl ? hl[1] : seg.endMs;
                          return (
                            <div
                              key={`seg-${tid}-${seg.syllabusNum}`}
                              className="flex min-w-0 flex-1 items-center justify-center py-0.5"
                              style={{ flex: `${flexGrow} 1 0` }}
                              title={title}
                            >
                              <div
                                className={`flex w-full min-w-0 justify-center ${MATRIX_PILL_INSET_X}`}
                                aria-label={title}
                              >
                                {hasAssigned ? (
                                  <span
                                    className="block h-2.5 w-full max-w-full rounded-pill shadow-sm ring-1 ring-black/10"
                                    style={{ backgroundColor: fillManned }}
                                  />
                                ) : (
                                  <MatrixDraggableTypeSlotPill
                                    shiftWindowId={tid}
                                    syllabusNum={seg.syllabusNum}
                                    coveredHours={coveredHours}
                                    displayHour={displayHour}
                                    fill={fillOpen}
                                    title={title}
                                    highlightStartMs={highlightStartMs}
                                    highlightEndMs={highlightEndMs}
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {tailGap ? (
                          <div
                            className="flex min-w-0 shrink-0 items-center justify-center py-0.5"
                            style={{
                              flex: `${Math.max(1, tailGap.endMs - tailGap.startMs)} 1 0`,
                            }}
                            title={`${typeName} — פער אחרי הסלוטים האחרונים`}
                            aria-hidden={true}
                          >
                            <div className={`box-border w-full min-w-0 ${MATRIX_PILL_INSET_X}`}>
                              <div className="schedule-striped-warn-pill block h-2.5 w-full max-w-full rounded-pill shadow-sm ring-1 ring-black/10" />
                            </div>
                          </div>
                        ) : null}
                        {rightPadMs > 0 ? (
                          <div
                            className="min-w-0 shrink"
                            style={{ flex: `${rightPadMs} 1 0` }}
                            aria-hidden={true}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-line bg-ink/[0.055]">
                <td className="sticky right-0 z-10 w-[6.6rem] max-w-[6.6rem] min-w-0 border-s border-line bg-ink/[0.055] px-2 py-0.5 align-middle">
                  <button
                    type="button"
                    className="block max-w-full truncate text-start font-heading text-sm font-semibold text-primary hover:underline"
                    onClick={openAddShiftTypeModal}
                  >
                    + הוסף חלון
                  </button>
                </td>
                {hours.map((hour) => (
                  <td
                    key={`add-row-${hour}`}
                    className="min-h-[28px] min-w-[40px] border-s border-line bg-ink/[0.055] px-1 py-0.5 align-middle"
                  />
                ))}
              </tr>
            </tbody>
          </table>
            {matrixUnifiedBand && activeDragHighlightMs ? (
              <div
                className="pointer-events-none absolute z-[25]"
                style={{
                  top: matrixUnifiedBand.top,
                  left: matrixUnifiedBand.left,
                  width: matrixUnifiedBand.width,
                  height: matrixUnifiedBand.height,
                }}
              >
                <div
                  className={`absolute inset-y-0 box-border ${MATRIX_PILL_INSET_X}`}
                  style={{
                    insetInlineStart: `${matrixUnifiedBand.startPct}%`,
                    width: `${matrixUnifiedBand.widthPct}%`,
                  }}
                >
                  <div
                    className="h-full w-full rounded-none"
                    style={{
                      backgroundColor:
                        matrixDragOverId != null
                          ? MATRIX_DRAG_HIGHLIGHT_OVER
                          : MATRIX_DRAG_HIGHLIGHT_IDLE,
                    }}
                  />
                </div>
              </div>
            ) : null}
            </div>
        </div>
        <div
          className="w-full rounded-card border border-dashed border-line bg-background/90 p-3 text-xs text-ink"
          dir="ltr"
        >
          <div className="mb-2 font-mono font-semibold text-muted">
            Debug — all shifts for {dateStr} ({dayShifts.length})
          </div>
          {dayShifts.length === 0 ? (
            <p className="font-mono text-muted">(none)</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto font-mono">
              {[...dayShifts]
                .sort(
                  (a, b) =>
                    String(a.start_time).localeCompare(String(b.start_time)) ||
                    Number(a.id) - Number(b.id),
                )
                .map((s) => {
                  const name =
                    String(s.emp_name ?? s.empName ?? "")
                      .trim() || "—";
                  return (
                    <li key={Number(s.id)}>
                      <span className="text-ink">{name}</span>
                      <span className="text-muted">
                        {" "}
                        {String(s.start_time)} → {String(s.end_time)}
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragOverlayColor ? (
            <span
              className="box-border block shrink-0 rounded-pill shadow-sm ring-1 ring-black/10"
              style={{
                backgroundColor: dragOverlayColor,
                width: dragOverlaySize?.width ?? 80,
                height: dragOverlaySize?.height ?? 10,
              }}
            />
          ) : null}
        </DragOverlay>
        </DndContext>
      )}

      {typePicker && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            aria-label="סגור"
            onClick={() => setTypePicker(null)}
          />
          <div
            className="fixed z-50 max-h-[min(320px,70vh)] w-[280px] overflow-y-auto rounded-card border border-line bg-surface p-3 shadow-airy"
            style={{ top: typePicker.top, left: typePicker.left }}
            role="menu"
          >
            <div className="mb-2 border-b border-line pb-2 text-sm font-semibold text-ink">
              {typePicker.employeeName}
              <div className="text-xs font-normal text-muted">
                {typePicker.start} – {typePicker.end}
              </div>
            </div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              סוג משמרת
            </div>
            <ul className="mt-1 space-y-1">
              {typesAvailableForPicker.map((t) => {
                const tid = typeId(t);
                const col = String(t.color ?? "#7BA3B5");
                return (
                  <li key={tid}>
                    <button
                      type="button"
                      disabled={createMut.isPending}
                      className="flex w-full items-center gap-2 rounded-pill px-2 py-2 text-start text-sm hover:bg-background disabled:cursor-not-allowed disabled:opacity-45"
                      onClick={() => {
                        const sn = syllabusNumForHourInWindow(
                          dateStr,
                          t,
                          typePicker.hour,
                          durationByPreset,
                        );
                        if (sn == null) return;
                        createMut.mutate({
                          shift_window_id: tid,
                          employee_id: typePicker.employeeId,
                          syllabus_num: sn,
                        });
                      }}
                    >
                      <span
                        className="size-3 shrink-0 rounded-pill"
                        style={{ backgroundColor: col }}
                      />
                      <span className="font-medium text-ink">{String(t.name)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {types.length === 0 && (
              <p className="text-sm text-muted">אין סוגי משמרת ליום זה.</p>
            )}
            {types.length > 0 && typesAvailableForPicker.length === 0 && (
              <p className="text-sm text-muted">
                הכל מאויש
              </p>
            )}
          </div>
        </>
      )}

      <RemoteRegInline weekStr={weekStr} />

      {shiftTypeDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shift-type-modal-title"
          onClick={() => setShiftTypeDraft(null)}
        >
          <div
            className="flex max-h-[min(90vh,640px)] w-full max-w-lg flex-col rounded-card border border-line bg-surface shadow-airy"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <PastelSwatchGridDropdown
                  value={String(shiftTypeDraft.color ?? DEFAULT_SHIFT_TYPE_PASTEL_HEX)}
                  onChange={(hex) => setShiftTypeDraft({ ...shiftTypeDraft, color: hex })}
                  open={swatchMenuOpen}
                  onOpenChange={setSwatchMenuOpen}
                  trigger="dot"
                />
                <h3
                  id="shift-type-modal-title"
                  className="min-w-0 font-heading text-lg font-bold text-ink"
                >
                  {Number(shiftTypeDraft.id) > 0 ? "עריכת חלון" : "סוג משמרת חדש"}
                </h3>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-pill px-2 text-muted hover:bg-background hover:text-ink"
                onClick={() => setShiftTypeDraft(null)}
              >
                ✕
              </button>
            </div>
            <div
              ref={shiftTypeModalBodyRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
            >
              <ShiftWindowDraftFormFields
                draft={shiftTypeDraft}
                setDraft={(next) => setShiftTypeDraft(next)}
                presets={presets}
                dateStr={dateStr}
                shiftTypeTimeError={shiftTypeTimeError}
                setShiftTypeTimeError={setShiftTypeTimeError}
                scrollContainerRef={shiftTypeModalBodyRef}
                saveErrorMessage={
                  createShiftWindowMut.isError
                    ? String(
                        (createShiftWindowMut.error as Error)?.message ??
                          createShiftWindowMut.error,
                      )
                    : updateShiftWindowMut.isError
                      ? String(
                          (updateShiftWindowMut.error as Error)?.message ??
                            updateShiftWindowMut.error,
                        )
                      : null
                }
              />
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
              <button
                type="button"
                className="rounded-pill border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-background"
                onClick={() => setShiftTypeDraft(null)}
              >
                ביטול
              </button>
              {Number(shiftTypeDraft.id) > 0 ? (
                <button
                  type="button"
                  className="rounded-pill border border-peach-3/60 bg-peach-1/50 px-4 py-2 text-sm font-semibold text-ink hover:bg-peach-1/70"
                  onClick={() => {
                    const id = Number(shiftTypeDraft.id);
                    const name = String(shiftTypeDraft.name ?? "");
                    setShiftTypeDraft(null);
                    setDeleteTypeConfirm({ id, name });
                  }}
                >
                  מחק
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-pill bg-primary px-4 py-2 text-sm font-heading font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                disabled={
                  createShiftWindowMut.isPending ||
                  updateShiftWindowMut.isPending ||
                  !String(shiftTypeDraft.name ?? "").trim()
                }
                onClick={() => {
                  const d = shiftTypeDraft;
                  const startHm = String(d.coverage_start_time ?? "06:00");
                  const endHm = String(d.coverage_end_time ?? "21:00");
                  const covStart = coverageIsoFromDayAndHm(dateStr, startHm);
                  const covEnd = coverageIsoFromDayAndHm(dateStr, endHm, true);
                  if (new Date(covEnd).getTime() <= new Date(covStart).getTime()) {
                    setShiftTypeTimeError(
                      "שעת הסיום חייבת להיות אחרי שעת ההתחלה (00:00 = חצות ביום המחרת)",
                    );
                    return;
                  }
                  setShiftTypeTimeError(null);
                  const payload = buildShiftWindowPayload(d, dateStr);
                  const editId = Number(d.id);
                  if (editId > 0) {
                    updateShiftWindowMut.mutate({ id: editId, payload });
                  } else {
                    createShiftWindowMut.mutate(payload);
                  }
                }}
              >
                שמור
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTypeConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-shift-type-title"
          onClick={() => setDeleteTypeConfirm(null)}
        >
          <div
            className="w-full max-w-md rounded-card border border-line bg-surface p-0 shadow-airy"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-line px-4 py-3">
              <h3 id="delete-shift-type-title" className="font-heading text-lg font-bold text-ink">
                למחוק סוג משמרת?
              </h3>
            </div>
            <div className="space-y-2 px-4 py-4 text-sm text-ink">
              <p>
                האם למחוק את <span className="font-semibold">{deleteTypeConfirm.name}</span>?
              </p>
              <p className="text-muted">
                פעולה זו תמחק גם את כל המשמרות המשויכות לסוג זה (בכל התאריכים). לא ניתן לבטל.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
              <button
                type="button"
                className="rounded-pill border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-background"
                onClick={() => setDeleteTypeConfirm(null)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="rounded-pill bg-peach-3 px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
                disabled={deleteShiftWindowMut.isPending}
                onClick={() => deleteShiftWindowMut.mutate(deleteTypeConfirm.id)}
              >
                מחק
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RemoteRegInline({ weekStr }: { weekStr: string }) {
  const [url, setUrl] = useState("");
  const qc = useQueryClient();
  const { data: cfg } = useQuery({
    queryKey: ["sheet_config"],
    queryFn: api.getSheetConfig,
  });
  const regs = useQuery({
    queryKey: ["remote_regs", weekStr],
    queryFn: () => api.getRemoteRegistrations(weekStr),
  });

  useEffect(() => {
    if (cfg?.sheet_url) setUrl(cfg.sheet_url);
  }, [cfg?.sheet_url]);

  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-airy">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-heading font-bold text-ink">רישום מרחוק</span>
        <button
          type="button"
          className="rounded-pill border border-line px-3 py-1 text-sm hover:bg-background"
          onClick={() => regs.refetch()}
        >
          רענן
        </button>
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        <input
          dir="ltr"
          className="min-w-[200px] flex-1 text-sm"
          placeholder="Google Sheet URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          className="rounded-pill border border-line px-3 py-2 text-sm"
          onClick={async () => {
            await api.saveSheetConfig(url);
            qc.invalidateQueries({ queryKey: ["sheet_config"] });
          }}
        >
          שמור
        </button>
        <button
          type="button"
          className="rounded-pill border border-line px-3 py-2 text-sm"
          onClick={async () => {
            await api.sheetPoll();
            regs.refetch();
          }}
        >
          משוך
        </button>
      </div>
      <div className="max-h-40 space-y-1 overflow-y-auto text-sm">
        {(regs.data ?? []).map((r) => (
          <div
            key={String(r.id)}
            className="flex flex-wrap gap-2 rounded-pill bg-background px-3 py-1 text-ink"
          >
            <span>{String(r.employee_name)}</span>
            <span className="text-muted">{String(r.shift_date)}</span>
            <span className="text-muted">{String(r.status)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
