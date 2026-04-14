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
  timeToMin,
  wallIntervalsOverlap,
  windowDayTimeline,
} from "../../shared/manningHours";
import { shiftTypePillColors } from "../../shared/shiftTypeColors";
import { errorMessageFromUnknown } from "../../shared/errorMessage";
import {
  MATRIX_DRAG_HIGHLIGHT_IDLE,
  MATRIX_DRAG_HIGHLIGHT_OVER,
  MATRIX_PILL_INSET_X,
} from "./helpers/scheduleConstants";
import { matrixPillDragSize } from "./helpers/matrixPillDragSize";
import {
  employeeHasShiftIntersectingInterval,
  matrixDragBandPercents,
} from "./helpers/scheduleMatrixGeometry";
import { resolveMatrixDragEnd } from "./helpers/resolveMatrixDragEnd";
import {
  maxSyllabusRolesInWindowDay,
  newShiftTypeDraft,
  normalizeShiftRow,
  presetSyllabusRolesSorted,
  shiftIsUpToDate,
  shiftTypeDraftFromWindow,
  typeId,
} from "./helpers/scheduleShiftModel";
import type {
  ActiveDragHighlightMs,
  MatrixEmployeeShiftDragData,
  MatrixTypeSlotDragData,
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
import {
  clampMsToMatrixFrame,
  formatLocalHmFromMs,
  isPointerOverMatrixTimeGrid,
  shouldSuppressMatrixHoverGuide,
  snapToNearestQuarterHour,
  timelineUFromPointerInHourStrip,
} from "./helpers/matrixHoverSnap";

type MatrixHoverGuideUi = {
  snappedMs: number;
  /** 0–100 from frame start (inline-start) to frame end; matches pill `insetInlineStart` basis. */
  timelinePct: number;
  overlayLeft: number;
  overlayWidth: number;
  /** Hour header row (relative to matrix wrap). */
  labelTop: number;
  labelHeight: number;
  lineTop: number;
  lineHeight: number;
};

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
  const presetById = useMemo(
    () => new Map<number, JsonObject>(presets.map((p) => [Number(p.id), p])),
    [presets],
  );

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
  const [deleteTypeConfirm, setDeleteTypeConfirm] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [shiftTypeDraft, setShiftTypeDraft] = useState<JsonObject | null>(null);
  const [swatchMenuOpen, setSwatchMenuOpen] = useState(false);
  const [shiftTypeTimeError, setShiftTypeTimeError] = useState<string | null>(null);
  const [activeDragHighlightMs, setActiveDragHighlightMs] =
    useState<ActiveDragHighlightMs | null>(null);
  const [matrixHoverGuide, setMatrixHoverGuide] = useState<MatrixHoverGuideUi | null>(
    null,
  );

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
  const shiftTypeModalBodyRef = useRef<HTMLDivElement>(null);
  const matrixScrollRef = useRef<HTMLDivElement>(null);
  /** Scrolls with table; band is `absolute` relative to this — not the overflow viewport. */
  const matrixTableWrapRef = useRef<HTMLDivElement>(null);
  const matrixTableRef = useRef<HTMLTableElement>(null);
  const matrixHourStripThRef = useRef<HTMLTableCellElement>(null);
  const matrixHoverRafRef = useRef<number | null>(null);
  const matrixHoverPendingRef = useRef<{ x: number; y: number } | null>(null);
  const blockMatrixHoverGuideRef = useRef(false);
  blockMatrixHoverGuideRef.current = activeDragHighlightMs != null;

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

  const flushMatrixHoverGuide = useCallback(() => {
    matrixHoverRafRef.current = null;
    const p = matrixHoverPendingRef.current;
    if (!p) {
      setMatrixHoverGuide(null);
      return;
    }
    if (blockMatrixHoverGuideRef.current) {
      setMatrixHoverGuide(null);
      return;
    }
    const wrap = matrixTableWrapRef.current;
    const th = matrixHourStripThRef.current;
    const table = matrixTableRef.current;
    const frame = scheduleMatrixFrame;
    if (!wrap || !th || !table || !frame || matrixRangeMs <= 0) {
      setMatrixHoverGuide(null);
      return;
    }
    if (!isPointerOverMatrixTimeGrid(p.x, p.y, th, table)) {
      setMatrixHoverGuide(null);
      return;
    }
    if (shouldSuppressMatrixHoverGuide(p.x, p.y, table, employees.length)) {
      setMatrixHoverGuide(null);
      return;
    }
    const u = timelineUFromPointerInHourStrip(p.x, th);
    if (u == null) {
      setMatrixHoverGuide(null);
      return;
    }
    const rawMs = frame.frameStartMs + u * matrixRangeMs;
    const snapped = clampMsToMatrixFrame(
      snapToNearestQuarterHour(rawMs),
      frame.frameStartMs,
      frame.frameEndMs,
    );
    const timelinePct = ((snapped - frame.frameStartMs) / matrixRangeMs) * 100;
    const wr = wrap.getBoundingClientRect();
    const hr = th.getBoundingClientRect();
    const gridLeft = hr.left - wr.left;
    const gridWidth = hr.width;
    const labelTop = hr.top - wr.top;
    const labelHeight = Math.max(0, hr.bottom - hr.top);
    const headerBottom = hr.bottom - wr.top;
    let lineTop = headerBottom;
    let lineHeight = 0;
    const tbody = table.tBodies[0];
    const empCount = employees.length;
    if (tbody && empCount > 0) {
      const rows = tbody.rows;
      const lastEmpIdx = empCount - 1;
      if (lastEmpIdx < rows.length) {
        const firstEmpRow = rows.item(0)!;
        const lastEmpRow = rows.item(lastEmpIdx)!;
        const empTop = firstEmpRow.getBoundingClientRect().top - wr.top;
        const empBottom = lastEmpRow.getBoundingClientRect().bottom - wr.top;
        lineTop = Math.max(headerBottom, empTop);
        lineHeight = Math.max(0, empBottom - lineTop);
      }
    }
    setMatrixHoverGuide({
      snappedMs: snapped,
      timelinePct,
      overlayLeft: gridLeft,
      overlayWidth: gridWidth,
      labelTop,
      labelHeight,
      lineTop,
      lineHeight,
    });
  }, [scheduleMatrixFrame, matrixRangeMs, employees.length]);

  useEffect(() => {
    if (activeDragHighlightMs) setMatrixHoverGuide(null);
  }, [activeDragHighlightMs]);

  useEffect(() => {
    const scroll = matrixScrollRef.current;
    if (!scroll || hours.length === 0) return;

    const scheduleFlush = () => {
      if (matrixHoverRafRef.current != null) return;
      matrixHoverRafRef.current = requestAnimationFrame(() => {
        flushMatrixHoverGuide();
      });
    };

    const onPointerMove = (e: PointerEvent) => {
      matrixHoverPendingRef.current = { x: e.clientX, y: e.clientY };
      scheduleFlush();
    };

    const onPointerLeave = () => {
      matrixHoverPendingRef.current = null;
      if (matrixHoverRafRef.current != null) {
        cancelAnimationFrame(matrixHoverRafRef.current);
        matrixHoverRafRef.current = null;
      }
      setMatrixHoverGuide(null);
    };

    scroll.addEventListener("pointermove", onPointerMove);
    scroll.addEventListener("pointerleave", onPointerLeave);
    scroll.addEventListener("pointercancel", onPointerLeave);

    const wrap = matrixTableWrapRef.current;
    const ro = new ResizeObserver(() => {
      if (matrixHoverPendingRef.current) scheduleFlush();
    });
    if (wrap) ro.observe(wrap);
    const tbl = matrixTableRef.current;
    if (tbl) ro.observe(tbl);
    const onResize = () => {
      if (matrixHoverPendingRef.current) scheduleFlush();
    };
    window.addEventListener("resize", onResize);

    return () => {
      scroll.removeEventListener("pointermove", onPointerMove);
      scroll.removeEventListener("pointerleave", onPointerLeave);
      scroll.removeEventListener("pointercancel", onPointerLeave);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      if (matrixHoverRafRef.current != null) {
        cancelAnimationFrame(matrixHoverRafRef.current);
        matrixHoverRafRef.current = null;
      }
    };
  }, [hours.length, flushMatrixHoverGuide]);

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
      alert(errorMessageFromUnknown(err));
    },
  });

  const createMut = useMutation({
    mutationFn: (args: {
      shift_window_id: number;
      employee_id: number;
      syllabus_num: number;
      syllabus_role_id?: number;
    }) =>
      api.createShift({
        shift_date: dateStr,
        shift_window_id: args.shift_window_id,
        syllabus_num: args.syllabus_num,
        employee_id: args.employee_id,
        ...(args.syllabus_role_id != null
          ? { syllabus_role_id: args.syllabus_role_id }
          : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
    },
    onError: (err) => {
      alert(errorMessageFromUnknown(err));
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteShift(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
    },
    onError: (err) => {
      alert(errorMessageFromUnknown(err));
    },
  });

  const deleteShiftWindowMut = useMutation({
    mutationFn: (id: number) => api.deleteShiftWindow(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift_windows"] });
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
      setDeleteTypeConfirm(null);
    },
    onError: (err) => {
      alert(errorMessageFromUnknown(err));
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
      alert(errorMessageFromUnknown(err));
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
      alert(errorMessageFromUnknown(err));
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

  // --- Global escape: close modals (swatch submenu first) ---
  useEffect(() => {
    if (!deleteTypeConfirm && !shiftTypeDraft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (shiftTypeDraft && swatchMenuOpen) {
        setSwatchMenuOpen(false);
        return;
      }
      setDeleteTypeConfirm(null);
      setShiftTypeDraft(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteTypeConfirm, shiftTypeDraft, swatchMenuOpen]);

  function openAddShiftTypeModal() {
    createShiftWindowMut.reset();
    updateShiftWindowMut.reset();
    setShiftTypeTimeError(null);
    setSwatchMenuOpen(false);
    setShiftTypeDraft(newShiftTypeDraft(presets));
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
        ...(resolution.syllabus_role_id != null
          ? { syllabus_role_id: resolution.syllabus_role_id }
          : {}),
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
                const clusterMap = new Map<string, JsonObject[]>();
                for (const s of [...rowShifts].sort(
                  (a, b) =>
                    timeToMin(String(a.start_time)) - timeToMin(String(b.start_time)) ||
                    Number(a.shift_window_id ?? a.shiftWindowId) -
                      Number(b.shift_window_id ?? b.shiftWindowId) ||
                    Number(a.syllabus_num ?? a.syllabusNum ?? 0) -
                      Number(b.syllabus_num ?? b.syllabusNum ?? 0) ||
                    Number(a.syllabus_role_sort_order ?? a.syllabusRoleSortOrder ?? 0) -
                      Number(b.syllabus_role_sort_order ?? b.syllabusRoleSortOrder ?? 0) ||
                    Number(a.id) - Number(b.id),
                )) {
                  const k = `${String(s.start_time)}|${String(s.end_time)}|${Number(s.shift_window_id ?? s.shiftWindowId)}|${Number(s.syllabus_num ?? s.syllabusNum ?? 0)}`;
                  if (!clusterMap.has(k)) clusterMap.set(k, []);
                  clusterMap.get(k)!.push(s);
                }
                const shiftClusters = [...clusterMap.values()].sort(
                  (a, b) =>
                    timeToMin(String(a[0].start_time)) - timeToMin(String(b[0].start_time)) ||
                    Number(a[0].id) - Number(b[0].id),
                );
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
                                className={hasShift ? "" : "bg-background/40"}
                              />
                            );
                          })}
                        </div>
                        {scheduleMatrixFrame && matrixRangeMs > 0 ? (
                          <div className="pointer-events-none relative z-[2] min-h-[28px] w-full">
                            {shiftClusters.map((cluster, idx) => {
                              const shift = cluster[0];
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
                              const typeColor = String(
                                shift.type_color ?? shift.typeColor ?? "#7BA3B5",
                              );
                              const clusterIds = new Set(cluster.map((x) => Number(x.id)));
                              const overlap = rowShifts.filter((o) => {
                                if (clusterIds.has(Number(o.id))) return false;
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
                              const roleHint =
                                cluster.length > 1
                                  ? ` · ${cluster.length} תפקידים`
                                  : "";
                              const pillTitle =
                                String(shift.type_name ?? "") +
                                roleHint +
                                (extra > 0 ? ` (+${extra} משמרות נוספות באותה תא)` : "");
                              return (
                                <Fragment key={`${eid}-cl-${cluster.map((c) => c.id).join("-")}`}>
                                  {cluster.map((clShift, subIdx) => (
                                    <MatrixEmployeePrepRestBands
                                      key={`prep-${clShift.id}`}
                                      dateStr={dateStr}
                                      shift={clShift}
                                      frameStartMs={scheduleMatrixFrame.frameStartMs}
                                      frameEndMs={scheduleMatrixFrame.frameEndMs}
                                      matrixRangeMs={matrixRangeMs}
                                      zIndexBase={3 + idx * 5 + subIdx}
                                      pillInsetClassName={MATRIX_PILL_INSET_X}
                                    />
                                  ))}
                                  <div
                                    className="pointer-events-auto absolute top-1/2 box-border -translate-y-1/2 py-0.5"
                                    style={{
                                      insetInlineStart: `${leftPct}%`,
                                      width: `${widthPct}%`,
                                      zIndex: 10 + idx,
                                    }}
                                  >
                                    <div
                                      className={`box-border flex min-h-0 w-full min-w-0 flex-col gap-0.5 ${MATRIX_PILL_INSET_X}`}
                                    >
                                      {cluster.map((clShift) => {
                                        const rname = String(
                                          clShift.syllabus_role_name ??
                                            clShift.syllabusRoleName ??
                                            "",
                                        ).trim();
                                        const titled =
                                          pillTitle + (rname ? `\n${rname}` : "");
                                        return (
                                          <EmployeeMatrixShiftPillChooser
                                            key={String(clShift.id)}
                                            shift={clShift}
                                            employeeId={eid}
                                            clippedStartMs={s}
                                            clippedEndMs={e}
                                            typeColor={typeColor}
                                            pillTitle={titled}
                                            onLongPressDelete={() => {
                                              deleteMut.mutate(Number(clShift.id));
                                            }}
                                          />
                                        );
                                      })}
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
                const maxRoles = maxSyllabusRolesInWindowDay(
                  dateStr,
                  ty,
                  durationByPreset,
                  presets,
                );
                const rowMinH =
                  maxRoles <= 1 ? 28 : Math.max(28, maxRoles * 10 + (maxRoles - 1) * 2 + 8);
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
                      className="border-s border-line bg-ink/[0.055] px-0 py-0.5 align-middle"
                    >
                      {/* No flex gap: gaps break ms-proportional alignment with column grid.
                          Per-segment inner padding (MATRIX_PILL_INSET_X) insets pills only; flex ratios unchanged. */}
                      <div
                        className="flex w-full items-center"
                        style={{ minHeight: rowMinH }}
                      >
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
                          const fillOpen = base;
                          const fillManned = muted;
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
                          const segPreset = presetById.get(seg.presetId);
                          const roles = presetSyllabusRolesSorted(segPreset);
                          const slotTitleBase = `${typeName} · ${displayHour}`;

                          if (roles.length <= 1) {
                            const hasAssigned = assigned.length > 0;
                            const names = [
                              ...new Set(
                                assigned
                                  .map((s) => String(s.emp_name ?? s.empName ?? "").trim())
                                  .filter(Boolean),
                              ),
                            ];
                            const title =
                              slotTitleBase +
                              (hasAssigned
                                ? ` — מאויש: ${names.join(", ")}`
                                : " — זמין לאיוש");
                            const singleRoleId =
                              roles.length === 1 ? Number(roles[0].id) : undefined;
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
                                      syllabusRoleId={
                                        singleRoleId !== undefined &&
                                        !Number.isNaN(singleRoleId)
                                          ? singleRoleId
                                          : undefined
                                      }
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
                          }

                          return (
                            <div
                              key={`seg-${tid}-${seg.syllabusNum}`}
                              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-0.5"
                              style={{ flex: `${flexGrow} 1 0` }}
                            >
                              <div
                                className={`flex w-full min-w-0 flex-col items-stretch justify-center gap-0.5 ${MATRIX_PILL_INSET_X}`}
                              >
                                {roles.map((role) => {
                                  const rid = Number(role.id);
                                  const mannedShift = assigned.find((s) => {
                                    const raw = s.syllabus_role_id ?? s.syllabusRoleId;
                                    if (
                                      raw !== undefined &&
                                      raw !== null &&
                                      raw !== ""
                                    ) {
                                      return Number(raw) === rid;
                                    }
                                    return (
                                      assigned.length === 1 &&
                                      rid === Number(roles[0].id)
                                    );
                                  });
                                  const rlabel = String(role.name ?? "").trim();
                                  const mannedName = mannedShift
                                    ? String(
                                        mannedShift.emp_name ??
                                          mannedShift.empName ??
                                          "",
                                      ).trim()
                                    : "";
                                  const title =
                                    slotTitleBase +
                                    (rlabel ? ` · ${rlabel}` : "") +
                                    (mannedName
                                      ? ` — מאויש: ${mannedName}`
                                      : " — זמין לאיוש");
                                  return (
                                    <div key={`${tid}-${seg.syllabusNum}-r-${rid}`} title={title}>
                                      {mannedShift ? (
                                        <span
                                          className="block h-2.5 w-full max-w-full rounded-pill shadow-sm ring-1 ring-black/10"
                                          style={{ backgroundColor: fillManned }}
                                          aria-label={title}
                                        />
                                      ) : (
                                        <MatrixDraggableTypeSlotPill
                                          shiftWindowId={tid}
                                          syllabusNum={seg.syllabusNum}
                                          syllabusRoleId={rid}
                                          coveredHours={coveredHours}
                                          displayHour={displayHour}
                                          fill={fillOpen}
                                          title={title}
                                          highlightStartMs={highlightStartMs}
                                          highlightEndMs={highlightEndMs}
                                        />
                                      )}
                                    </div>
                                  );
                                })}
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
            {matrixHoverGuide ? (
              <>
                <div
                  className="pointer-events-none absolute z-[18]"
                  style={{
                    top: matrixHoverGuide.labelTop,
                    left: matrixHoverGuide.overlayLeft,
                    width: matrixHoverGuide.overlayWidth,
                    height: matrixHoverGuide.labelHeight,
                  }}
                >
                  <div className="relative h-full w-full">
                    <div
                      className="absolute inset-y-0 flex w-0 flex-col items-center justify-end pb-px"
                      style={{ insetInlineStart: `${matrixHoverGuide.timelinePct}%` }}
                    >
                      <span className="max-w-[3.25rem] shrink-0 truncate rounded px-0.5 text-center font-heading text-[9px] font-medium leading-none tracking-tight text-muted tabular-nums ring-1 ring-line/40 bg-background/80">
                        {formatLocalHmFromMs(matrixHoverGuide.snappedMs)}
                      </span>
                    </div>
                  </div>
                </div>
                {matrixHoverGuide.lineHeight > 0 ? (
                  <div
                    className="pointer-events-none absolute z-[18]"
                    style={{
                      top: matrixHoverGuide.lineTop,
                      left: matrixHoverGuide.overlayLeft,
                      width: matrixHoverGuide.overlayWidth,
                      height: matrixHoverGuide.lineHeight,
                    }}
                  >
                    <div className="relative h-full w-full">
                      <div
                        className="absolute inset-y-0 w-0 border-0 border-s border-dotted border-muted/80"
                        style={{ insetInlineStart: `${matrixHoverGuide.timelinePct}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </>
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
