import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppStore, weekStartString } from "../../app/store";
import type { JsonObject } from "../../shared/api";
import * as api from "../../shared/api";
import { formatYmd } from "../../shared/dates";
import {
  clipIntervalToFrame,
  coverageOf,
  effectiveMatrixFrame,
  hourLabelsTouchingRange,
  intersectCoverageOnDay,
  matrixFrameBoundsMs,
  matrixPrepAwareHourSlotsForDay,
  presetDurationById,
  shiftCoversHour,
  shiftWallIntervalMs,
  syllabusNumForHourInWindow,
  timeToMin,
  typesCoveringHourSlot,
  wallIntervalsOverlap,
  windowDayTimeline,
} from "../../shared/manningHours";
import { shiftTypePillColors } from "../../shared/shiftTypeColors";
import { hourSlotEndHm } from "../../shared/timeFormat";
import {
  MATRIX_DRAG_HIGHLIGHT_IDLE,
  MATRIX_DRAG_HIGHLIGHT_OVER,
  MATRIX_PILL_INSET_X,
  PANEL_W,
} from "./helpers/scheduleConstants";
import { matrixPillDragSize } from "./helpers/matrixPillDragSize";
import {
  employeeHasShiftIntersectingInterval,
  matrixDragBandPercents,
} from "./helpers/scheduleMatrixGeometry";
import { resolveMatrixDragEnd } from "./helpers/resolveMatrixDragEnd";
import {
  newShiftTypeDraft,
  normalizeShiftRow,
  shiftIsUpToDate,
  shiftTypeDraftFromWindow,
  typeId,
} from "./helpers/scheduleShiftModel";
import type {
  ActiveDragHighlightMs,
  MatrixEmployeeShiftDragData,
  MatrixTypeSlotDragData,
  TypePickerState,
} from "./helpers/scheduleTypes";
import {
  EmployeeMatrixShiftPillChooser,
  MatrixDraggableTypeSlotPill,
  MatrixEmployeeHourDropZone,
  MatrixEmployeePrepRestBands,
} from "./components/MatrixScheduleParts";
import { RemoteRegInline } from "./components/RemoteRegInline";
import {
  DeleteShiftTypeConfirmDialog,
  ShiftTypeEditorModal,
} from "./components/ShiftTypeModals";
import { TypePickerPanel } from "./components/TypePickerPanel";

export function ScheduleView() {
  // --- Server state (React Query) ---
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
  const matrixRangeMs = useMemo(() => {
    const f = scheduleMatrixFrame;
    if (!f || f.frameEndMs <= f.frameStartMs) return 0;
    return f.frameEndMs - f.frameStartMs;
  }, [scheduleMatrixFrame]);

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

  // --- Local UI state ---
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

  // --- Refs ---
  /** Last `onDragOver` droppable id (for drag-end diagnostics). Highlight uses imperative DOM updates to avoid full-matrix re-renders. */
  const matrixDragOverIdRef = useRef<string | null>(null);
  const matrixDragHighlightFillRef = useRef<HTMLDivElement | null>(null);
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

  // --- Matrix drag: derived overlap sets ---
  /** Shift–interval overlap does not depend on which hour column is hovered; cache per employee for the active drag. */
  const matrixTypeSlotOverlapEmps = useMemo(() => {
    if (matrixDragKind !== "typeSlot" || !activeDragHighlightMs) return null;
    const out = new Set<number>();
    for (const emp of employees) {
      const eid = Number(emp.id);
      if (
        employeeHasShiftIntersectingInterval(
          dateStr,
          dayShifts,
          eid,
          activeDragHighlightMs.startMs,
          activeDragHighlightMs.endMs,
          undefined,
          { ignoreStaleShifts: true },
        )
      )
        out.add(eid);
    }
    return out;
  }, [matrixDragKind, activeDragHighlightMs, dateStr, dayShifts, employees]);

  const matrixEmpShiftOverlapEmps = useMemo(() => {
    if (matrixDragKind !== "empShift" || !activeDragHighlightMs) return null;
    const ex = matrixEmpDragShiftId ?? undefined;
    const out = new Set<number>();
    for (const emp of employees) {
      const eid = Number(emp.id);
      if (
        employeeHasShiftIntersectingInterval(
          dateStr,
          dayShifts,
          eid,
          activeDragHighlightMs.startMs,
          activeDragHighlightMs.endMs,
          ex,
        )
      )
        out.add(eid);
    }
    return out;
  }, [
    matrixDragKind,
    activeDragHighlightMs,
    dateStr,
    dayShifts,
    employees,
    matrixEmpDragShiftId,
  ]);

  // --- Matrix drag: unified highlight band layout ---
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

  /** `onDragOver` can run before the highlight layer mounts; sync fill once layout exists. */
  useLayoutEffect(() => {
    if (!matrixUnifiedBand || !activeDragHighlightMs) return;
    const fill = matrixDragHighlightFillRef.current;
    const id = matrixDragOverIdRef.current;
    if (!fill) return;
    fill.style.backgroundColor =
      id != null ? MATRIX_DRAG_HIGHLIGHT_OVER : MATRIX_DRAG_HIGHLIGHT_IDLE;
  }, [matrixUnifiedBand, activeDragHighlightMs]);

  // --- DnD sensors & matrix drag cleanup ---
  const clearMatrixDragOverlay = useCallback(() => {
    setActiveDragHighlightMs(null);
    setMatrixUnifiedBand(null);
    matrixDragOverIdRef.current = null;
    const fill = matrixDragHighlightFillRef.current;
    if (fill) fill.style.backgroundColor = MATRIX_DRAG_HIGHLIGHT_IDLE;
    setDragOverlayColor(null);
    setDragOverlaySize(null);
    setMatrixDragKind(null);
    setMatrixTypeSlotCoveredHours(null);
    setMatrixEmpDragShiftId(null);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // --- Type picker (empty cell) ---
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

  // --- Mutations ---
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
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(msg);
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
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(msg);
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

  // --- Shift type modal open helpers ---
  function openEditShiftTypeModal(ty: JsonObject) {
    createShiftWindowMut.reset();
    updateShiftWindowMut.reset();
    setShiftTypeTimeError(null);
    setSwatchMenuOpen(false);
    setShiftTypeDraft(shiftTypeDraftFromWindow(ty, presets));
  }

  useEffect(() => {
    if (!shiftTypeDraft) setSwatchMenuOpen(false);
  }, [shiftTypeDraft]);

  // --- Global escape: close modals / picker (swatch submenu first) ---
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
    setShiftTypeDraft(newShiftTypeDraft(presets));
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

  // --- Matrix DnD handlers ---
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
      clearMatrixDragOverlay();
      suppressCellClickUntil.current = Date.now() + 400;

      const resolution = resolveMatrixDragEnd({
        active,
        over,
        dateStr,
        dayShifts,
      });
      if (resolution.kind === "noop") return;
      if (resolution.kind === "reassign") {
        reassignMut.mutate({
          shift_id: resolution.shift_id,
          employee_id: resolution.employee_id,
        });
        return;
      }
      createMut.mutate({
        shift_window_id: resolution.shift_window_id,
        employee_id: resolution.employee_id,
        syllabus_num: resolution.syllabus_num,
      });
    },
    [clearMatrixDragOverlay, createMut, dateStr, dayShifts, reassignMut],
  );

  // --- Render ---
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
          collisionDetection={pointerWithin}
          onDragStart={(e: DragStartEvent) => {
            matrixDragOverIdRef.current = null;
            const fill = matrixDragHighlightFillRef.current;
            if (fill) fill.style.backgroundColor = MATRIX_DRAG_HIGHLIGHT_IDLE;
            handleMatrixDragStart(e);
          }}
          onDragOver={(e: DragOverEvent) => {
            const id = e.over?.id != null ? String(e.over.id) : null;
            if (matrixDragOverIdRef.current === id) return;
            matrixDragOverIdRef.current = id;
            const fill = matrixDragHighlightFillRef.current;
            if (fill) {
              fill.style.backgroundColor =
                id != null ? MATRIX_DRAG_HIGHLIGHT_OVER : MATRIX_DRAG_HIGHLIGHT_IDLE;
            }
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
                                (matrixTypeSlotOverlapEmps?.has(eid) ?? false);
                            } else {
                              droppableDisabled =
                                matrixEmpShiftOverlapEmps?.has(eid) ?? false;
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
                        {scheduleMatrixFrame && matrixRangeMs > 0 ? (
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
                                  scheduleMatrixFrame.frameStartMs,
                                  scheduleMatrixFrame.frameEndMs,
                                );
                                if (!clipped) return null;
                                const [s, e] = clipped;
                                const leftPct =
                                  ((s - scheduleMatrixFrame.frameStartMs) / matrixRangeMs) * 100;
                                const widthPct = ((e - s) / matrixRangeMs) * 100;
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
                                  <Fragment key={`${eid}-pill-${shift.id}`}>
                                    <MatrixEmployeePrepRestBands
                                      dateStr={dateStr}
                                      shift={shift}
                                      frameStartMs={
                                        scheduleMatrixFrame.frameStartMs
                                      }
                                      frameEndMs={
                                        scheduleMatrixFrame.frameEndMs
                                      }
                                      matrixRangeMs={matrixRangeMs}
                                      zIndexBase={3 + idx}
                                      pillInsetClassName={MATRIX_PILL_INSET_X}
                                    />
                                    <div
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
                                        <EmployeeMatrixShiftPillChooser
                                          shift={shift}
                                          employeeId={eid}
                                          clippedStartMs={s}
                                          clippedEndMs={e}
                                          typeColor={typeColor}
                                          pillTitle={pillTitle}
                                          onLongPressDelete={() => {
                                            suppressCellClickUntil.current =
                                              Date.now() + 400;
                                            deleteMut.mutate(Number(shift.id));
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </Fragment>
                                );
                              })}
                          </div>
                        ) : null}
                      </div>
                    </td>
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
                            if (!shiftIsUpToDate(s)) return false;
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
                            scheduleMatrixFrame &&
                            scheduleMatrixFrame.frameEndMs > scheduleMatrixFrame.frameStartMs
                              ? clipIntervalToFrame(
                                  seg.startMs,
                                  seg.endMs,
                                  scheduleMatrixFrame.frameStartMs,
                                  scheduleMatrixFrame.frameEndMs,
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
                    ref={matrixDragHighlightFillRef}
                    className="h-full w-full rounded-none"
                    style={{ backgroundColor: MATRIX_DRAG_HIGHLIGHT_IDLE }}
                  />
                </div>
              </div>
            ) : null}
            </div>
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

      {typePicker ? (
        <TypePickerPanel
          picker={typePicker}
          onClose={() => setTypePicker(null)}
          typesAvailableForPicker={typesAvailableForPicker}
          totalTypesCount={types.length}
          createIsPending={createMut.isPending}
          onPickShiftType={(t) => {
            const sn = syllabusNumForHourInWindow(
              dateStr,
              t,
              typePicker.hour,
              durationByPreset,
            );
            if (sn == null) return;
            createMut.mutate({
              shift_window_id: typeId(t),
              employee_id: typePicker.employeeId,
              syllabus_num: sn,
            });
          }}
        />
      ) : null}

      <RemoteRegInline weekStr={weekStr} />

      {shiftTypeDraft ? (
        <ShiftTypeEditorModal
          shiftTypeDraft={shiftTypeDraft}
          setShiftTypeDraft={setShiftTypeDraft}
          presets={presets}
          dateStr={dateStr}
          shiftTypeModalBodyRef={shiftTypeModalBodyRef}
          swatchMenuOpen={swatchMenuOpen}
          setSwatchMenuOpen={setSwatchMenuOpen}
          shiftTypeTimeError={shiftTypeTimeError}
          setShiftTypeTimeError={setShiftTypeTimeError}
          createShiftWindowMut={createShiftWindowMut}
          updateShiftWindowMut={updateShiftWindowMut}
          onClose={() => setShiftTypeDraft(null)}
          onRequestDelete={(id, name) => setDeleteTypeConfirm({ id, name })}
        />
      ) : null}

      <DeleteShiftTypeConfirmDialog
        confirm={deleteTypeConfirm}
        onClose={() => setDeleteTypeConfirm(null)}
        deleteShiftWindowMut={deleteShiftWindowMut}
      />
    </div>
  );
}
