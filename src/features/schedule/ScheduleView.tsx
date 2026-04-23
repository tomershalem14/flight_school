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
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
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
  activePresetIdFromList,
  sortEmployeesByActivePreset,
} from "../../shared/employeeOrderSort";
import { MatrixEmployeeOrderMenu } from "./components/MatrixEmployeeOrderMenu";
import {
  MATRIX_DRAG_HIGHLIGHT_IDLE,
  MATRIX_DRAG_HIGHLIGHT_OVER,
  MATRIX_PILL_INSET_X,
} from "./helpers/scheduleConstants";
import { matrixPillDragSize } from "./helpers/matrixPillDragSize";
import {
  employeeHasShiftOrObservationIntersectingInterval,
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
  MatrixObservationRowDragData,
  MatrixObservationSlotDragData,
  MatrixTypeSlotDragData,
} from "./helpers/scheduleTypes";
import {
  EmployeeMatrixShiftPillChooser,
  MatrixDraggableObservationPill,
  MatrixDraggableObservationSlotPill,
  MatrixDraggableTypeSlotPill,
  MatrixEmployeeHourDropZone,
  MatrixEmployeePrepRestBands,
  MatrixEventCreatePopup,
  MatrixObservationWindowOutlinePill,
  MatrixScheduleEventBar,
  type ScheduleMatrixEventKind,
} from "./components/MatrixScheduleParts";
import {
  DeleteShiftTypeConfirmDialog,
  ShiftTypeEditorModal,
} from "./components/ShiftTypeModals";
import {
  buildEnabledHoursByEmployeeId,
  buildEnabledWallIntervalsByEmployeeId,
  buildMatrixEmployeeRows,
  clipRangeToLongestEnabledSubinterval,
  msWithinEnabledUnion,
} from "./helpers/matrixEmployeeAvailability";
import {
  clientXToSnappedMatrixMs,
  employeeTbodyRowIndexFromPoint,
  formatLocalHmFromMs,
  formatMatrixEventPersistHmForPopup,
  isPointerOverMatrixTimeGrid,
  matrixFrameSnappedEdges,
  matrixRangeDayEdgeFlags,
  matrixRangePersistTimes,
  normalizeRangeMs,
  shouldSuppressMatrixHoverGuide,
} from "./helpers/matrixHoverSnap";
import {
  clampScheduleEventResizeToPersist,
  scheduleEventWallIntervalMsSameDay,
} from "./helpers/scheduleEventResize";
import {
  buildOptimisticShiftRowTemplate,
  buildSyntheticOptimisticShiftRowForCreate,
  type CreateShiftMutationVars,
  type ScheduleEventCreatePayload,
  afterMatrixObservationMutationSuccess,
  afterMatrixShiftMutationSuccess,
  invalidateViolationsDeferred,
  observationCreateOnMutate,
  observationDeleteOnMutate,
  observationReassignOnMutate,
  restoreList,
  rollbackScheduleEventCreate,
  scheduleEventCreateOnMutate,
  scheduleEventCreateOnSuccess,
  scheduleEventDeleteOnMutate,
  scheduleEventUpdateOnMutate,
  shiftCreateOnMutate,
  shiftDeleteOnMutate,
  shiftReassignOnMutate,
  shiftsListKey,
  observationsListKey,
  scheduleEventsListKey,
} from "./helpers/scheduleMatrixQueryCache";

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

/** Coexists with @dnd-kit `PointerSensor` default activation distance (8px); raise if empty-cell drags feel wrong in QA. */
const MATRIX_RANGE_DRAG_THRESHOLD_PX = 4;

type MatrixRangeDragUi = {
  pointerId: number;
  employeeId: number;
  /** Tbody row index (0 .. employees.length - 1). */
  rowIndex: number;
  anchorMs: number;
  currentMs: number;
  gridLeft: number;
  gridWidth: number;
  bandTop: number;
  bandHeight: number;
  startPct: number;
  widthPct: number;
};

type MatrixRangePending = {
  pointerId: number;
  downX: number;
  employeeId: number;
  rowIndex: number;
  anchorMs: number;
};

function computeMatrixRangeBandLayout(
  wrap: HTMLElement,
  hourStripTh: HTMLElement,
  table: HTMLTableElement,
  rowIndex: number,
  anchorMs: number,
  currentMs: number,
  frame: { frameStartMs: number; frameEndMs: number },
  matrixRangeMs: number,
): Pick<
  MatrixRangeDragUi,
  "gridLeft" | "gridWidth" | "bandTop" | "bandHeight" | "startPct" | "widthPct"
> {
  const wr = wrap.getBoundingClientRect();
  const hr = hourStripTh.getBoundingClientRect();
  const tbody = table.tBodies[0];
  const row = tbody?.rows.item(rowIndex);
  const rr = row?.getBoundingClientRect();
  const [lo, hi] = normalizeRangeMs(anchorMs, currentMs);
  const startPct = ((lo - frame.frameStartMs) / matrixRangeMs) * 100;
  const widthPct = Math.max(0.12, ((hi - lo) / matrixRangeMs) * 100);
  return {
    gridLeft: hr.left - wr.left,
    gridWidth: hr.width,
    bandTop: rr ? rr.top - wr.top : 0,
    bandHeight: rr ? rr.height : 0,
    startPct,
    widthPct,
  };
}

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

  const { data: observationsRaw = [] } = useQuery({
    queryKey: ["observations", weekStr],
    queryFn: () => api.getObservations(weekStr),
  });
  const dayShiftIdSet = useMemo(
    () => new Set(dayShifts.map((s) => Number(s.id))),
    [dayShifts],
  );
  const dayObservationsList = useMemo(() => {
    const list = (observationsRaw as JsonObject[]) ?? [];
    return list.filter((ob) => dayShiftIdSet.has(Number(ob.shift_id ?? ob.shiftId)));
  }, [observationsRaw, dayShiftIdSet]);
  const observationByShiftId = useMemo(() => {
    const m = new Map<number, JsonObject>();
    for (const ob of dayObservationsList) {
      m.set(Number(ob.shift_id ?? ob.shiftId), ob);
    }
    return m;
  }, [dayObservationsList]);

  const { data: scheduleEventsRaw = [] } = useQuery({
    queryKey: ["schedule_events", weekStr],
    queryFn: () => api.getScheduleEvents(weekStr),
  });
  const dayScheduleEvents = useMemo(
    () =>
      (scheduleEventsRaw as JsonObject[]).filter(
        (ev) => String(ev.shift_date ?? "") === dateStr,
      ),
    [scheduleEventsRaw, dateStr],
  );

  const { data: employeeOrderPresetsRaw = [] } = useQuery({
    queryKey: ["employee_order_presets"],
    queryFn: () => api.listEmployeeOrderPresets(),
  });
  const employeeOrderPresets = useMemo(
    () => employeeOrderPresetsRaw as JsonObject[],
    [employeeOrderPresetsRaw],
  );
  const activeEmployeeOrderPresetId = useMemo(
    () => activePresetIdFromList(employeeOrderPresets),
    [employeeOrderPresets],
  );

  const { data: activeEmployeeOrderPreset } = useQuery({
    queryKey: ["employee_order_preset", activeEmployeeOrderPresetId],
    queryFn: () => api.getEmployeeOrderPreset(activeEmployeeOrderPresetId!),
    enabled: activeEmployeeOrderPresetId != null,
  });

  const sortedEmployees = useMemo(() => {
    const itemsRaw = activeEmployeeOrderPreset?.items;
    const items = Array.isArray(itemsRaw) ? (itemsRaw as JsonObject[]) : null;
    return sortEmployeesByActivePreset(
      employees,
      activeEmployeeOrderPresetId != null ? items : null,
    );
  }, [employees, activeEmployeeOrderPresetId, activeEmployeeOrderPreset]);

  const { data: availabilityRaw = [] } = useQuery({
    queryKey: ["availability", weekStr],
    queryFn: () => api.listAvailabilityForWeek(weekStr),
  });
  const availabilityRows = useMemo(
    () => availabilityRaw as JsonObject[],
    [availabilityRaw],
  );

  const matrixEmployees = useMemo(
    () =>
      buildMatrixEmployeeRows(
        sortedEmployees,
        employees,
        availabilityRows,
        dateStr,
      ),
    [sortedEmployees, employees, availabilityRows, dateStr],
  );

  const enabledHoursByEmployeeId = useMemo(
    () =>
      buildEnabledHoursByEmployeeId(
        matrixEmployees,
        availabilityRows,
        dateStr,
        hours,
      ),
    [matrixEmployees, availabilityRows, dateStr, hours],
  );

  const enabledWallIntervalsByEmployeeId = useMemo(() => {
    const f = scheduleMatrixFrame;
    if (!f || f.frameEndMs <= f.frameStartMs) {
      return new Map<number, Array<[number, number]>>();
    }
    return buildEnabledWallIntervalsByEmployeeId(
      matrixEmployees,
      availabilityRows,
      dateStr,
      f.frameStartMs,
      f.frameEndMs,
    );
  }, [matrixEmployees, availabilityRows, dateStr, scheduleMatrixFrame]);

  const enabledWallIntervalsRef = useRef(enabledWallIntervalsByEmployeeId);
  enabledWallIntervalsRef.current = enabledWallIntervalsByEmployeeId;

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
  const [matrixRangeDrag, setMatrixRangeDrag] = useState<MatrixRangeDragUi | null>(null);
  /** Finished empty-cell range: same band as drag, cleared on next pointerdown / day / pill drag. */
  const [matrixRangeCommittedBand, setMatrixRangeCommittedBand] =
    useState<MatrixRangeDragUi | null>(null);
  /** Range-drag finished: show create popup anchored to band. */
  const [matrixEventCreateDraft, setMatrixEventCreateDraft] = useState<{
    employeeId: number;
    rowIndex: number;
    loMs: number;
    hiMs: number;
    persistStartHm: string;
    persistEndHm: string;
    nameInput: string;
  } | null>(null);
  const [matrixEventPopupPos, setMatrixEventPopupPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

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
    "typeSlot" | "empShift" | "obsSlot" | "obsRow" | null
  >(null);
  const [matrixTypeSlotCoveredHours, setMatrixTypeSlotCoveredHours] = useState<
    string[] | null
  >(null);
  const [matrixEmpDragShiftId, setMatrixEmpDragShiftId] = useState<number | null>(
    null,
  );
  const [matrixObsDragId, setMatrixObsDragId] = useState<number | null>(null);
  const [dragOverlayRingBlack, setDragOverlayRingBlack] = useState(false);
  const shiftTypeModalBodyRef = useRef<HTMLDivElement>(null);
  const matrixScrollRef = useRef<HTMLDivElement>(null);
  /** Scrolls with table; band is `absolute` relative to this — not the overflow viewport. */
  const matrixTableWrapRef = useRef<HTMLDivElement>(null);
  const matrixTableRef = useRef<HTMLTableElement>(null);
  const matrixHourStripThRef = useRef<HTMLTableCellElement>(null);
  const matrixHoverRafRef = useRef<number | null>(null);
  const matrixHoverPendingRef = useRef<{ x: number; y: number } | null>(null);
  const blockMatrixHoverGuideRef = useRef(false);
  const scheduleEventResizeActiveRef = useRef(false);

  type ScheduleEventResizeSession = {
    eventId: number;
    edge: "start" | "end";
    pointerId: number;
    origStartHm: string;
    origEndHm: string;
    origPersistStart: string;
    origPersistEnd: string;
  };

  type ScheduleEventResizeDraft = {
    eventId: number;
    loMs: number;
    hiMs: number;
    persistStartHm: string;
    persistEndHm: string;
  };

  const scheduleEventResizeSessionRef = useRef<ScheduleEventResizeSession | null>(
    null,
  );
  blockMatrixHoverGuideRef.current = activeDragHighlightMs != null;

  const [scheduleEventResizeDraft, setScheduleEventResizeDraft] =
    useState<ScheduleEventResizeDraft | null>(null);
  const scheduleEventResizeDraftRef = useRef<ScheduleEventResizeDraft | null>(
    null,
  );
  const scheduleEventResizeBodyCleanupRef = useRef<(() => void) | null>(null);
  /** Negative ids for optimistic schedule_events rows until `create` returns the real id. */
  const scheduleEventCreateOptimisticIdRef = useRef(0);
  const shiftCreateOptimisticIdRef = useRef(0);
  const observationCreateOptimisticIdRef = useRef(0);

  useEffect(() => {
    scheduleEventResizeDraftRef.current = scheduleEventResizeDraft;
  }, [scheduleEventResizeDraft]);

  const matrixRangePendingRef = useRef<MatrixRangePending | null>(null);
  /** Stable layout roots for the active range gesture (avoid ref nulls mid-gesture when React re-renders). */
  const matrixRangeGestureLayoutRef = useRef<{
    wrap: HTMLElement;
    th: HTMLElement;
    tbl: HTMLTableElement;
  } | null>(null);
  const matrixRangeDragRef = useRef<MatrixRangeDragUi | null>(null);
  /** Element that received `setPointerCapture` for the active range gesture (`scroll` or `document.body`). */
  const matrixRangePointerCaptureElRef = useRef<HTMLElement | null>(null);
  /** Removes body `pointer*` listeners when capture falls back to `document.body`. */
  const matrixRangeBodyPointerCleanupRef = useRef<(() => void) | null>(null);
  const matrixRangeEndGestureRef = useRef<(e: PointerEvent) => void>(() => {});
  const matrixRangeMoveRef = useRef<(e: PointerEvent) => void>(() => {});
  const matrixEventCreatePopupRef = useRef<HTMLDivElement>(null);
  const matrixRangeBandMeasureRef = useRef<HTMLDivElement>(null);

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
        employeeHasShiftOrObservationIntersectingInterval(
          dateStr,
          dayShifts,
          dayObservationsList,
          eid,
          activeDragHighlightMs.startMs,
          activeDragHighlightMs.endMs,
          { ignoreStaleShifts: true },
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
    dayObservationsList,
    employees,
  ]);

  const matrixEmpShiftOverlapEmps = useMemo(() => {
    if (matrixDragKind !== "empShift" || !activeDragHighlightMs) return null;
    const ex = matrixEmpDragShiftId ?? undefined;
    const out = new Set<number>();
    for (const emp of employees) {
      const eid = Number(emp.id);
      if (
        employeeHasShiftOrObservationIntersectingInterval(
          dateStr,
          dayShifts,
          dayObservationsList,
          eid,
          activeDragHighlightMs.startMs,
          activeDragHighlightMs.endMs,
          { excludeShiftId: ex },
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
    dayObservationsList,
    employees,
    matrixEmpDragShiftId,
  ]);

  const matrixObsSlotOverlapEmps = useMemo(() => {
    if (matrixDragKind !== "obsSlot" || !activeDragHighlightMs) return null;
    const out = new Set<number>();
    for (const emp of employees) {
      const eid = Number(emp.id);
      if (
        employeeHasShiftOrObservationIntersectingInterval(
          dateStr,
          dayShifts,
          dayObservationsList,
          eid,
          activeDragHighlightMs.startMs,
          activeDragHighlightMs.endMs,
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
    dayObservationsList,
    employees,
  ]);

  const matrixObsRowOverlapEmps = useMemo(() => {
    if (matrixDragKind !== "obsRow" || !activeDragHighlightMs) return null;
    const ex = matrixObsDragId ?? undefined;
    const out = new Set<number>();
    for (const emp of employees) {
      const eid = Number(emp.id);
      if (
        employeeHasShiftOrObservationIntersectingInterval(
          dateStr,
          dayShifts,
          dayObservationsList,
          eid,
          activeDragHighlightMs.startMs,
          activeDragHighlightMs.endMs,
          { excludeObservationId: ex },
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
    dayObservationsList,
    employees,
    matrixObsDragId,
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

  useEffect(() => {
    matrixRangeDragRef.current = matrixRangeDrag;
  }, [matrixRangeDrag]);

  const refreshMatrixCommittedBandLayout = useCallback(() => {
    setMatrixRangeCommittedBand((prev) => {
      if (!prev) return null;
      const wrap = matrixTableWrapRef.current;
      const th = matrixHourStripThRef.current;
      const tbl = matrixTableRef.current;
      const frame = scheduleMatrixFrame;
      if (!wrap || !th || !tbl || !frame || matrixRangeMs <= 0) return prev;
      const layout = computeMatrixRangeBandLayout(
        wrap,
        th,
        tbl,
        prev.rowIndex,
        prev.anchorMs,
        prev.currentMs,
        frame,
        matrixRangeMs,
      );
      const next = { ...prev, ...layout };
      const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
      if (
        near(next.bandTop, prev.bandTop) &&
        near(next.bandHeight, prev.bandHeight) &&
        near(next.gridLeft, prev.gridLeft) &&
        near(next.gridWidth, prev.gridWidth) &&
        near(next.startPct, prev.startPct) &&
        near(next.widthPct, prev.widthPct)
      ) {
        return prev;
      }
      return next;
    });
  }, [scheduleMatrixFrame, matrixRangeMs]);

  const matrixCommittedBandLayoutKey =
    matrixRangeCommittedBand == null
      ? null
      : `${matrixRangeCommittedBand.rowIndex}:${matrixRangeCommittedBand.anchorMs}:${matrixRangeCommittedBand.currentMs}`;

  const matrixRangeBandUi = matrixRangeDrag ?? matrixRangeCommittedBand;

  const matrixRangeBandEdgeFlags = useMemo(() => {
    if (!matrixRangeBandUi || !scheduleMatrixFrame) return null;
    const [lo, hi] = normalizeRangeMs(
      matrixRangeBandUi.anchorMs,
      matrixRangeBandUi.currentMs,
    );
    return matrixRangeDayEdgeFlags(dateStr, lo, hi, scheduleMatrixFrame);
  }, [matrixRangeBandUi, scheduleMatrixFrame, dateStr]);

  useLayoutEffect(() => {
    if (matrixCommittedBandLayoutKey == null) return;
    refreshMatrixCommittedBandLayout();
    const scroll = matrixScrollRef.current;
    const wrap = matrixTableWrapRef.current;
    const ro = new ResizeObserver(() => {
      refreshMatrixCommittedBandLayout();
    });
    if (wrap) ro.observe(wrap);
    const tbl = matrixTableRef.current;
    if (tbl) ro.observe(tbl);
    window.addEventListener("resize", refreshMatrixCommittedBandLayout);
    if (scroll) {
      scroll.addEventListener("scroll", refreshMatrixCommittedBandLayout, {
        passive: true,
      });
    }
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", refreshMatrixCommittedBandLayout);
      if (scroll) {
        scroll.removeEventListener("scroll", refreshMatrixCommittedBandLayout);
      }
    };
  }, [
    matrixCommittedBandLayoutKey,
    scheduleMatrixFrame,
    matrixRangeMs,
    refreshMatrixCommittedBandLayout,
  ]);

  useEffect(() => {
    const clear = (ev: PointerEvent) => {
      const t = ev.target;
      if (t instanceof Node && matrixEventCreatePopupRef.current?.contains(t)) return;
      setMatrixRangeCommittedBand(null);
      setMatrixEventCreateDraft(null);
      setMatrixEventPopupPos(null);
    };
    document.addEventListener("pointerdown", clear, true);
    return () => document.removeEventListener("pointerdown", clear, true);
  }, []);

  useEffect(() => {
    setMatrixRangeCommittedBand(null);
    setMatrixEventCreateDraft(null);
    setMatrixEventPopupPos(null);
    scheduleEventResizeBodyCleanupRef.current?.();
    scheduleEventResizeSessionRef.current = null;
    scheduleEventResizeActiveRef.current = false;
    setScheduleEventResizeDraft(null);
  }, [dateStr]);

  useLayoutEffect(() => {
    if (!matrixEventCreateDraft || !matrixRangeCommittedBand) {
      setMatrixEventPopupPos(null);
      return;
    }
    const el = matrixRangeBandMeasureRef.current;
    if (!el) {
      setMatrixEventPopupPos(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const margin = 8;
    const popW = 200;
    const popH = 220;
    let left = r.right + 4;
    let top = r.bottom + 4;
    left = Math.min(left, window.innerWidth - popW - margin);
    top = Math.min(top, window.innerHeight - popH - margin);
    top = Math.max(margin, top);
    left = Math.max(margin, left);
    setMatrixEventPopupPos({ top, left });
  }, [matrixEventCreateDraft, matrixCommittedBandLayoutKey, matrixRangeCommittedBand]);

  useEffect(() => {
    if (!matrixEventCreateDraft) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setMatrixEventCreateDraft(null);
        setMatrixEventPopupPos(null);
        setMatrixRangeCommittedBand(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [matrixEventCreateDraft]);

  const flushMatrixHoverGuide = useCallback(() => {
    matrixHoverRafRef.current = null;
    const p = matrixHoverPendingRef.current;
    if (!p) {
      setMatrixHoverGuide(null);
      return;
    }
    if (blockMatrixHoverGuideRef.current || scheduleEventResizeActiveRef.current) {
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
    if (shouldSuppressMatrixHoverGuide(p.x, p.y, table, matrixEmployees.length)) {
      setMatrixHoverGuide(null);
      return;
    }
    const snapped = clientXToSnappedMatrixMs(p.x, th, frame, matrixRangeMs);
    if (snapped == null) {
      setMatrixHoverGuide(null);
      return;
    }
    const { earliestMs, latestMs } = matrixFrameSnappedEdges(frame);
    if (snapped === earliestMs || snapped === latestMs) {
      setMatrixHoverGuide(null);
      return;
    }
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
    const empCount = matrixEmployees.length;
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
  }, [scheduleMatrixFrame, matrixRangeMs, matrixEmployees]);

  /** Range gesture entry from the matrix scroll container (`pointerdown` capture). */
  const tryStartMatrixRangeFromPointerDown = useCallback((e: PointerEvent): boolean => {
      if (e.button !== 0) return false;
      const target = e.target;
      if (target instanceof Element && target.closest("[data-matrix-schedule-event]")) {
        return false;
      }
      if (blockMatrixHoverGuideRef.current || scheduleEventResizeActiveRef.current) {
        return false;
      }
      const scroll = matrixScrollRef.current;
      const wrap = matrixTableWrapRef.current;
      const th = matrixHourStripThRef.current;
      const table = matrixTableRef.current;
      if (!scroll || !wrap || !th || !table) return false;
      const frame = scheduleMatrixFrame;
      if (!frame || matrixRangeMs <= 0) return false;
      if (!isPointerOverMatrixTimeGrid(e.clientX, e.clientY, th, table)) {
        return false;
      }
      if (shouldSuppressMatrixHoverGuide(e.clientX, e.clientY, table, matrixEmployees.length)) {
        return false;
      }
      const rowIdx = employeeTbodyRowIndexFromPoint(
        e.clientX,
        e.clientY,
        table,
        matrixEmployees.length,
      );
      if (rowIdx == null) {
        return false;
      }
      const emp = matrixEmployees[rowIdx];
      if (!emp) return false;
      const snapped = clientXToSnappedMatrixMs(e.clientX, th, frame, matrixRangeMs);
      if (snapped == null) return false;
      const merged =
        enabledWallIntervalsRef.current.get(Number(emp.id)) ?? [];
      if (!msWithinEnabledUnion(snapped, merged)) return false;
      matrixRangeGestureLayoutRef.current = { wrap, th, tbl: table };
      matrixRangePendingRef.current = {
        pointerId: e.pointerId,
        downX: e.clientX,
        employeeId: Number(emp.id),
        rowIndex: rowIdx,
        anchorMs: snapped,
      };

      matrixRangeBodyPointerCleanupRef.current?.();
      matrixRangeBodyPointerCleanupRef.current = null;
      matrixRangePointerCaptureElRef.current = null;

      const pid = e.pointerId;
      let capEl: HTMLElement | null = null;
      try {
        scroll.setPointerCapture(pid);
      } catch {
        /* another handler may own capture */
      }
      if (scroll.hasPointerCapture(pid)) capEl = scroll;
      else {
        try {
          document.body.setPointerCapture(pid);
        } catch {
          /* ignore */
        }
        if (document.body.hasPointerCapture(pid)) capEl = document.body;
      }
      matrixRangePointerCaptureElRef.current = capEl;

      if (capEl === document.body) {
        const move = (ev: PointerEvent) => matrixRangeMoveRef.current(ev);
        const up = (ev: PointerEvent) => matrixRangeEndGestureRef.current(ev);
        const onLost = (ev: PointerEvent) => {
          if (ev.pointerId !== pid) return;
          matrixRangeEndGestureRef.current(ev);
        };
        document.body.addEventListener("pointermove", move);
        document.body.addEventListener("pointerup", up);
        document.body.addEventListener("pointercancel", up);
        document.body.addEventListener("lostpointercapture", onLost);
        matrixRangeBodyPointerCleanupRef.current = () => {
          document.body.removeEventListener("pointermove", move);
          document.body.removeEventListener("pointerup", up);
          document.body.removeEventListener("pointercancel", up);
          document.body.removeEventListener("lostpointercapture", onLost);
          matrixRangeBodyPointerCleanupRef.current = null;
        };
      }

      return true;
    },
    [scheduleMatrixFrame, matrixRangeMs, matrixEmployees],
  );

  useEffect(() => {
    if (!activeDragHighlightMs) return;
    setMatrixHoverGuide(null);
    matrixRangeBodyPointerCleanupRef.current?.();
    matrixRangeBodyPointerCleanupRef.current = null;
    matrixRangePointerCaptureElRef.current = null;
    matrixRangeGestureLayoutRef.current = null;
    matrixRangePendingRef.current = null;
    matrixRangeDragRef.current = null;
    setMatrixRangeDrag(null);
    setMatrixRangeCommittedBand(null);
    setMatrixEventCreateDraft(null);
    setMatrixEventPopupPos(null);
    scheduleEventResizeBodyCleanupRef.current?.();
    scheduleEventResizeSessionRef.current = null;
    scheduleEventResizeActiveRef.current = false;
    setScheduleEventResizeDraft(null);
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

    const onScrollPointerDownCapture = (e: PointerEvent) => {
      void tryStartMatrixRangeFromPointerDown(e);
    };

    const releaseRangePointerCapture = (pointerId: number) => {
      matrixRangeBodyPointerCleanupRef.current?.();
      matrixRangeBodyPointerCleanupRef.current = null;
      const cap = matrixRangePointerCaptureElRef.current;
      matrixRangePointerCaptureElRef.current = null;
      try {
        if (cap?.hasPointerCapture(pointerId)) {
          cap.releasePointerCapture(pointerId);
          return;
        }
        if (scroll.hasPointerCapture(pointerId)) {
          scroll.releasePointerCapture(pointerId);
        }
      } catch {
        /* ignore */
      }
    };

    const endRangeGesture = (e: PointerEvent) => {
      const pend = matrixRangePendingRef.current;
      const drag = matrixRangeDragRef.current;
      if (pend && e.pointerId === pend.pointerId) {
        matrixRangePendingRef.current = null;
        matrixRangeGestureLayoutRef.current = null;
        releaseRangePointerCapture(e.pointerId);
        return;
      }
      if (drag && e.pointerId === drag.pointerId) {
        if (e.type === "pointerup") {
          const L = matrixRangeGestureLayoutRef.current;
          const wrap = L?.wrap ?? matrixTableWrapRef.current;
          const th = L?.th ?? matrixHourStripThRef.current;
          const tbl = L?.tbl ?? matrixTableRef.current;
          const frame = scheduleMatrixFrame;
          if (wrap && th && tbl && frame && matrixRangeMs > 0) {
            const [lo0, hi0] = normalizeRangeMs(drag.anchorMs, drag.currentMs);
            const merged =
              enabledWallIntervalsRef.current.get(drag.employeeId) ?? [];
            const clipped = clipRangeToLongestEnabledSubinterval(lo0, hi0, merged);
            if (clipped) {
              const lo = clipped.loMs;
              const hi = clipped.hiMs;
              const layout = computeMatrixRangeBandLayout(
                wrap,
                th,
                tbl,
                drag.rowIndex,
                lo,
                hi,
                frame,
                matrixRangeMs,
              );
              setMatrixRangeCommittedBand({
                pointerId: -1,
                employeeId: drag.employeeId,
                rowIndex: drag.rowIndex,
                anchorMs: lo,
                currentMs: hi,
                ...layout,
              });
              const persist = matrixRangePersistTimes(dateStr, lo, hi, frame);
              setMatrixEventCreateDraft({
                employeeId: drag.employeeId,
                rowIndex: drag.rowIndex,
                loMs: lo,
                hiMs: hi,
                persistStartHm: persist.persistStartHm,
                persistEndHm: persist.persistEndHm,
                nameInput: "",
              });
            }
          }
        }
        matrixRangeDragRef.current = null;
        matrixRangeGestureLayoutRef.current = null;
        setMatrixRangeDrag(null);
        releaseRangePointerCapture(e.pointerId);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const L = matrixRangeGestureLayoutRef.current;
      const pend = matrixRangePendingRef.current;
      if (pend && e.pointerId === pend.pointerId) {
        if (Math.abs(e.clientX - pend.downX) >= MATRIX_RANGE_DRAG_THRESHOLD_PX) {
          const wrap = L?.wrap ?? matrixTableWrapRef.current;
          const th = L?.th ?? matrixHourStripThRef.current;
          const tbl = L?.tbl ?? matrixTableRef.current;
          const frame = scheduleMatrixFrame;
          if (wrap && th && tbl && frame && matrixRangeMs > 0) {
            const cur =
              clientXToSnappedMatrixMs(e.clientX, th, frame, matrixRangeMs) ?? pend.anchorMs;
            const layout = computeMatrixRangeBandLayout(
              wrap,
              th,
              tbl,
              pend.rowIndex,
              pend.anchorMs,
              cur,
              frame,
              matrixRangeMs,
            );
            const next: MatrixRangeDragUi = {
              pointerId: pend.pointerId,
              employeeId: pend.employeeId,
              rowIndex: pend.rowIndex,
              anchorMs: pend.anchorMs,
              currentMs: cur,
              ...layout,
            };
            matrixRangePendingRef.current = null;
            matrixRangeDragRef.current = next;
            setMatrixRangeDrag(next);
          }
        }
      }
      const drag = matrixRangeDragRef.current;
      if (drag && e.pointerId === drag.pointerId) {
        const wrap = L?.wrap ?? matrixTableWrapRef.current;
        const th = L?.th ?? matrixHourStripThRef.current;
        const tbl = L?.tbl ?? matrixTableRef.current;
        const frame = scheduleMatrixFrame;
        if (wrap && th && tbl && frame && matrixRangeMs > 0) {
          const cur =
            clientXToSnappedMatrixMs(e.clientX, th, frame, matrixRangeMs) ?? drag.anchorMs;
          const layout = computeMatrixRangeBandLayout(
            wrap,
            th,
            tbl,
            drag.rowIndex,
            drag.anchorMs,
            cur,
            frame,
            matrixRangeMs,
          );
          const next: MatrixRangeDragUi = {
            ...drag,
            currentMs: cur,
            ...layout,
          };
          matrixRangeDragRef.current = next;
          setMatrixRangeDrag(next);
        }
      }

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

    const onPointerUpOrCancel = (e: PointerEvent) => {
      endRangeGesture(e);
    };

    matrixRangeEndGestureRef.current = onPointerUpOrCancel;
    matrixRangeMoveRef.current = onPointerMove;

    const onPointerCancel = (e: PointerEvent) => {
      endRangeGesture(e);
      onPointerLeave();
    };

    scroll.addEventListener("pointerdown", onScrollPointerDownCapture, true);
    scroll.addEventListener("pointermove", onPointerMove);
    scroll.addEventListener("pointerup", onPointerUpOrCancel);
    scroll.addEventListener("pointercancel", onPointerCancel);
    scroll.addEventListener("lostpointercapture", onPointerUpOrCancel);
    scroll.addEventListener("pointerleave", onPointerLeave);

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
      matrixRangeEndGestureRef.current = () => {};
      matrixRangeMoveRef.current = () => {};
      scroll.removeEventListener("pointerdown", onScrollPointerDownCapture, true);
      scroll.removeEventListener("pointermove", onPointerMove);
      scroll.removeEventListener("pointerup", onPointerUpOrCancel);
      scroll.removeEventListener("pointercancel", onPointerCancel);
      scroll.removeEventListener("lostpointercapture", onPointerUpOrCancel);
      scroll.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      if (matrixHoverRafRef.current != null) {
        cancelAnimationFrame(matrixHoverRafRef.current);
        matrixHoverRafRef.current = null;
      }
    };
  }, [
    dateStr,
    hours.length,
    flushMatrixHoverGuide,
    scheduleMatrixFrame,
    matrixRangeMs,
    tryStartMatrixRangeFromPointerDown,
  ]);

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
    setMatrixObsDragId(null);
    setDragOverlayRingBlack(false);
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
    onMutate: (args) =>
      shiftReassignOnMutate({
        qc,
        weekStr,
        shiftId: args.shift_id,
        employeeId: args.employee_id,
      }),
    onSuccess: () => afterMatrixShiftMutationSuccess(qc, weekStr),
    onError: (err, _args, context) => {
      restoreList(qc, shiftsListKey(weekStr), context?.previous);
      alert(errorMessageFromUnknown(err));
    },
  });

  const createMut = useMutation({
    mutationFn: (args: CreateShiftMutationVars) => {
      const { optimisticRow: _ignored, ...rest } = args;
      return api.createShift({
        shift_date: dateStr,
        shift_window_id: rest.shift_window_id,
        syllabus_num: rest.syllabus_num,
        employee_id: rest.employee_id,
        ...(rest.syllabus_role_id != null
          ? { syllabus_role_id: rest.syllabus_role_id }
          : {}),
      });
    },
    onMutate: (args) =>
      shiftCreateOnMutate({
        qc,
        weekStr,
        optimisticRow: args.optimisticRow,
        tempIdRef: shiftCreateOptimisticIdRef,
      }),
    onSuccess: () => afterMatrixShiftMutationSuccess(qc, weekStr),
    onError: (err, _args, context) => {
      restoreList(qc, shiftsListKey(weekStr), context?.previous);
      alert(errorMessageFromUnknown(err));
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteShift(id),
    onMutate: (id) => shiftDeleteOnMutate({ qc, weekStr, shiftId: id }),
    onSuccess: () => afterMatrixShiftMutationSuccess(qc, weekStr),
    onError: (err, _id, context) => {
      restoreList(qc, shiftsListKey(weekStr), context?.previous);
      alert(errorMessageFromUnknown(err));
    },
  });

  const createObservationMut = useMutation({
    mutationFn: (args: { shift_id: number; employee_id: number }) =>
      api.createObservation(args),
    onMutate: (args) =>
      observationCreateOnMutate({
        qc,
        weekStr,
        shiftId: args.shift_id,
        employeeId: args.employee_id,
        tempIdRef: observationCreateOptimisticIdRef,
      }),
    onSuccess: () => afterMatrixObservationMutationSuccess(qc, weekStr),
    onError: (err, _args, context) => {
      restoreList(qc, observationsListKey(weekStr), context?.previous);
      alert(errorMessageFromUnknown(err));
    },
  });

  const reassignObservationMut = useMutation({
    mutationFn: (args: { observation_id: number; employee_id: number }) =>
      api.reassignObservationEmployee(args),
    onMutate: (args) =>
      observationReassignOnMutate({
        qc,
        weekStr,
        observationId: args.observation_id,
        employeeId: args.employee_id,
      }),
    onSuccess: () => afterMatrixObservationMutationSuccess(qc, weekStr),
    onError: (err, _args, context) => {
      restoreList(qc, observationsListKey(weekStr), context?.previous);
      alert(errorMessageFromUnknown(err));
    },
  });

  const deleteObservationMut = useMutation({
    mutationFn: (id: number) => api.deleteObservation(id),
    onMutate: (id) =>
      observationDeleteOnMutate({ qc, weekStr, observationId: id }),
    onSuccess: () => afterMatrixObservationMutationSuccess(qc, weekStr),
    onError: (err, _id, context) => {
      restoreList(qc, observationsListKey(weekStr), context?.previous);
      alert(errorMessageFromUnknown(err));
    },
  });

  const scheduleEventCreateMut = useMutation({
    mutationFn: (payload: JsonObject) => api.createScheduleEvent(payload),
    /** Synchronous: append the new row and dismiss create UI in the same frame so the bar never vanishes. */
    onMutate: (payload) =>
      scheduleEventCreateOnMutate({
        qc,
        weekStr,
        payload: payload as ScheduleEventCreatePayload,
        tempIdRef: scheduleEventCreateOptimisticIdRef,
        matrixEmployees,
        employees,
        clearCreateUi: () => {
          setMatrixEventCreateDraft(null);
          setMatrixEventPopupPos(null);
          setMatrixRangeCommittedBand(null);
        },
      }),
    onError: (err, _payload, context) => {
      rollbackScheduleEventCreate(qc, weekStr, context);
      alert(errorMessageFromUnknown(err));
    },
    onSuccess: (data, _variables, context) => {
      scheduleEventCreateOnSuccess({
        qc,
        weekStr,
        data: data as JsonObject,
        tempId: context?.tempId,
      });
      invalidateViolationsDeferred(qc);
    },
  });

  const scheduleEventDeleteMut = useMutation({
    mutationFn: (id: number) => api.deleteScheduleEvent(id),
    onMutate: (id) => scheduleEventDeleteOnMutate({ qc, weekStr, eventId: id }),
    onSuccess: () => {
      invalidateViolationsDeferred(qc);
    },
    onError: (err, _id, context) => {
      restoreList(qc, scheduleEventsListKey(weekStr), context?.previous);
      alert(errorMessageFromUnknown(err));
    },
  });

  const scheduleEventUpdateMut = useMutation({
    mutationFn: (payload: JsonObject) => api.updateScheduleEvent(payload),
    /** Must stay synchronous: `mutate()` does not await async `onMutate`, so the UI clears the resize draft in the same tick. */
    onMutate: (payload) =>
      scheduleEventUpdateOnMutate({ qc, weekStr, payload }),
    onError: (err, _payload, context) => {
      restoreList(qc, scheduleEventsListKey(weekStr), context?.previous);
      alert(errorMessageFromUnknown(err));
    },
    onSuccess: () => {
      invalidateViolationsDeferred(qc);
    },
  });

  const beginScheduleEventResize = useCallback(
    (
      eventId: number,
      edge: "start" | "end",
      startHmRaw: unknown,
      endHmRaw: unknown,
      e: ReactPointerEvent<HTMLDivElement>,
    ) => {
      if (e.button !== 0) return;
      if (scheduleEventUpdateMut.isPending) return;
      if (scheduleEventResizeSessionRef.current) return;

      const th = matrixHourStripThRef.current;
      const frame = scheduleMatrixFrame;
      if (!th || !frame || matrixRangeMs <= 0) return;

      const sh = String(startHmRaw ?? "").trim().slice(0, 5);
      const eh = String(endHmRaw ?? "").trim().slice(0, 5);
      const { startMs: sm0, endMs: em0 } = scheduleEventWallIntervalMsSameDay(
        dateStr,
        sh,
        eh,
      );
      const p0 = matrixRangePersistTimes(dateStr, sm0, em0, frame);

      const snapped = clientXToSnappedMatrixMs(e.clientX, th, frame, matrixRangeMs);
      if (snapped == null) return;

      scheduleEventResizeBodyCleanupRef.current?.();
      scheduleEventResizeBodyCleanupRef.current = null;

      const first = clampScheduleEventResizeToPersist(
        dateStr,
        frame,
        edge,
        snapped,
        sh,
        eh,
      );
      const sess: ScheduleEventResizeSession = {
        eventId,
        edge,
        pointerId: e.pointerId,
        origStartHm: sh,
        origEndHm: eh,
        origPersistStart: p0.persistStartHm,
        origPersistEnd: p0.persistEndHm,
      };
      scheduleEventResizeSessionRef.current = sess;
      const draft0: ScheduleEventResizeDraft = { eventId, ...first };
      scheduleEventResizeDraftRef.current = draft0;
      setScheduleEventResizeDraft(draft0);

      scheduleEventResizeActiveRef.current = true;

      const pid = e.pointerId;
      const frameSnap = frame;
      const mrm = matrixRangeMs;
      const ds = dateStr;

      let listenersDetached = false;
      function teardownListeners() {
        if (listenersDetached) return;
        listenersDetached = true;
        document.body.removeEventListener("pointermove", move);
        document.body.removeEventListener("pointerup", end);
        document.body.removeEventListener("pointercancel", end);
        document.body.removeEventListener("lostpointercapture", onLost);
        scheduleEventResizeBodyCleanupRef.current = null;
      }

      function move(ev: PointerEvent) {
        const s = scheduleEventResizeSessionRef.current;
        if (!s || ev.pointerId !== pid) return;
        const th2 = matrixHourStripThRef.current;
        if (!th2) return;
        const sn = clientXToSnappedMatrixMs(ev.clientX, th2, frameSnap, mrm);
        if (sn == null) return;
        const out = clampScheduleEventResizeToPersist(
          ds,
          frameSnap,
          s.edge,
          sn,
          s.origStartHm,
          s.origEndHm,
        );
        const d: ScheduleEventResizeDraft = { eventId: s.eventId, ...out };
        scheduleEventResizeDraftRef.current = d;
        setScheduleEventResizeDraft(d);
      }

      function end(ev: PointerEvent) {
        if (ev.pointerId !== pid) return;
        const s = scheduleEventResizeSessionRef.current;
        if (!s) return;
        teardownListeners();
        try {
          if (document.body.hasPointerCapture(pid)) {
            document.body.releasePointerCapture(pid);
          }
        } catch {
          /* ignore */
        }

        const d = scheduleEventResizeDraftRef.current;
        if (
          d &&
          (d.persistStartHm !== s.origPersistStart ||
            d.persistEndHm !== s.origPersistEnd)
        ) {
          scheduleEventUpdateMut.mutate({
            event_id: s.eventId,
            start_time: d.persistStartHm,
            end_time: d.persistEndHm,
          });
        }
        scheduleEventResizeSessionRef.current = null;
        scheduleEventResizeActiveRef.current = false;
        setScheduleEventResizeDraft(null);
      }

      function onLost(ev: PointerEvent) {
        if (ev.pointerId !== pid) return;
        end(ev);
      }

      document.body.addEventListener("pointermove", move);
      document.body.addEventListener("pointerup", end);
      document.body.addEventListener("pointercancel", end);
      document.body.addEventListener("lostpointercapture", onLost);

      scheduleEventResizeBodyCleanupRef.current = () => {
        teardownListeners();
        try {
          if (document.body.hasPointerCapture(pid)) {
            document.body.releasePointerCapture(pid);
          }
        } catch {
          /* ignore */
        }
      };

      try {
        document.body.setPointerCapture(pid);
      } catch {
        /* ignore */
      }
    },
    [dateStr, matrixRangeMs, scheduleEventUpdateMut, scheduleMatrixFrame],
  );

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

  const setEmployeeOrderActiveMut = useMutation({
    mutationFn: (presetId: number | null) => api.setEmployeeOrderActive(presetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee_order_presets"] });
      qc.invalidateQueries({ queryKey: ["employee_order_preset"] });
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
      | MatrixObservationSlotDragData
      | MatrixObservationRowDragData
      | undefined;
    if (!d) return;
    if (d.kind === "typeSlot") {
      setMatrixDragKind("typeSlot");
      setMatrixTypeSlotCoveredHours(d.coveredHours);
      setMatrixEmpDragShiftId(null);
      setMatrixObsDragId(null);
      setDragOverlayRingBlack(false);
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
      setMatrixObsDragId(null);
      setDragOverlayRingBlack(false);
      setActiveDragHighlightMs({
        startMs: d.highlightStartMs,
        endMs: d.highlightEndMs,
      });
      setDragOverlayColor(d.color);
      setDragOverlaySize(matrixPillDragSize(event));
      return;
    }
    if (d.kind === "obsSlot") {
      setMatrixDragKind("obsSlot");
      setMatrixTypeSlotCoveredHours(d.coveredHours);
      setMatrixEmpDragShiftId(null);
      setMatrixObsDragId(null);
      setDragOverlayRingBlack(true);
      setActiveDragHighlightMs({
        startMs: d.highlightStartMs,
        endMs: d.highlightEndMs,
      });
      setDragOverlayColor(d.color);
      setDragOverlaySize(matrixPillDragSize(event));
      return;
    }
    if (d.kind === "obsRow") {
      setMatrixDragKind("obsRow");
      setMatrixTypeSlotCoveredHours(null);
      setMatrixEmpDragShiftId(null);
      setMatrixObsDragId(d.observationId);
      setDragOverlayRingBlack(true);
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
      const resolution = resolveMatrixDragEnd({
        active,
        over,
        dateStr,
        dayShifts,
        dayObservations: dayObservationsList,
      });
      if (resolution.kind === "noop") {
        clearMatrixDragOverlay();
        return;
      }
      // Apply cache updates before clearing overlay so the first paint already shows the pill
      // (same tick as drag end; avoids a one-frame gap after the drag overlay hides).
      if (resolution.kind === "reassign") {
        reassignMut.mutate({
          shift_id: resolution.shift_id,
          employee_id: resolution.employee_id,
        });
        clearMatrixDragOverlay();
        return;
      }
      if (resolution.kind === "reassignObservation") {
        reassignObservationMut.mutate({
          observation_id: resolution.observation_id,
          employee_id: resolution.employee_id,
        });
        clearMatrixDragOverlay();
        return;
      }
      if (resolution.kind === "createObservation") {
        createObservationMut.mutate({
          shift_id: resolution.shift_id,
          employee_id: resolution.employee_id,
        });
        clearMatrixDragOverlay();
        return;
      }
      if (resolution.kind === "create") {
        const eid = resolution.employee_id;
        const emp =
          matrixEmployees.find((x) => Number(x.id) === eid) ??
          employees.find((x) => Number(x.id) === eid);
        const empName = emp ? String(emp.name ?? "").trim() : "";
        const ty = typesOrdered.find((t) => typeId(t) === resolution.shift_window_id);
        const template = buildOptimisticShiftRowTemplate(dayShifts, dateStr, {
          shift_window_id: resolution.shift_window_id,
          employee_id: resolution.employee_id,
          syllabus_num: resolution.syllabus_num,
          syllabus_role_id: resolution.syllabus_role_id ?? undefined,
        });
        const optimisticRow =
          template ??
          (ty != null
            ? buildSyntheticOptimisticShiftRowForCreate({
                dateStr,
                shift_window_id: resolution.shift_window_id,
                employee_id: resolution.employee_id,
                syllabus_num: resolution.syllabus_num,
                syllabus_role_id: resolution.syllabus_role_id,
                highlightStartMs: resolution.highlightStartMs,
                highlightEndMs: resolution.highlightEndMs,
                shiftWindow: ty,
                durationByPreset,
                presets,
                empName,
              })
            : null);
        createMut.mutate({
          shift_window_id: resolution.shift_window_id,
          employee_id: resolution.employee_id,
          syllabus_num: resolution.syllabus_num,
          ...(resolution.syllabus_role_id != null
            ? { syllabus_role_id: resolution.syllabus_role_id }
            : {}),
          optimisticRow,
        });
        clearMatrixDragOverlay();
        return;
      }
      clearMatrixDragOverlay();
    },
    [
      clearMatrixDragOverlay,
      createMut,
      createObservationMut,
      reassignObservationMut,
      dateStr,
      dayShifts,
      dayObservationsList,
      durationByPreset,
      employees,
      presets,
      reassignMut,
      matrixEmployees,
      typesOrdered,
    ],
  );

  const pickScheduleEventKind = useCallback(
    (kind: ScheduleMatrixEventKind) => {
      const d = matrixEventCreateDraft;
      if (!d || !d.nameInput.trim() || scheduleEventCreateMut.isPending) return;
      scheduleEventCreateMut.mutate({
        shift_date: dateStr,
        employee_id: d.employeeId,
        start_time: d.persistStartHm,
        end_time: d.persistEndHm,
        name: d.nameInput.trim(),
        notes: "",
        event_kind: kind,
      });
    },
    [matrixEventCreateDraft, dateStr, scheduleEventCreateMut],
  );

  // --- Render ---
  return (
    <>
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
            className="w-full select-none overflow-auto rounded-card border border-line bg-surface shadow-airy"
          >
            <div ref={matrixTableWrapRef} className="relative w-full min-w-full">
            <table
              ref={matrixTableRef}
              className="w-full min-w-full table-fixed border-collapse"
            >
            <colgroup>
              <col className="w-[7.75rem]" />
              {hours.map((h) => (
                <col key={h} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky right-0 z-20 w-[7.75rem] min-w-0 max-w-[7.75rem] border-b border-line border-s border-line bg-surface px-1.5 py-1 text-start font-heading text-[10px] font-bold uppercase tracking-wide text-muted">
                  <div className="flex min-w-0 items-center gap-0.5">
                    <span className="min-w-0 flex-1 truncate">מפעיל</span>
                    <MatrixEmployeeOrderMenu
                      presets={employeeOrderPresets}
                      scrollContainerRef={matrixScrollRef}
                      onPick={(presetId) =>
                        void setEmployeeOrderActiveMut.mutateAsync(presetId)
                      }
                    />
                  </div>
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
              {matrixEmployees.map((emp) => {
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
                const rowScheduleEvents = dayScheduleEvents.filter(
                  (ev) => Number(ev.employee_id ?? 0) === eid,
                );
                /** Prep/rest bands sit above calendar event bars but below the main shift pill stack. */
                const zEventStart = 4;
                const zPrepStart = zEventStart + rowScheduleEvents.length + 1;
                const maxClusterSize = shiftClusters.reduce(
                  (acc, c) => Math.max(acc, c.length),
                  0,
                );
                const zPrepStridePerCluster = Math.max(12, maxClusterSize + 4);
                const zShiftClusterStart =
                  zPrepStart + shiftClusters.length * zPrepStridePerCluster + 2;
                const enabledSet = enabledHoursByEmployeeId.get(eid) ?? new Set<string>();
                const rowFullyDisabled = enabledSet.size === 0;
                const rowObservations = dayObservationsList.filter(
                  (ob) => Number(ob.employee_id ?? ob.employeeId) === eid,
                );
                const hasActivityInHour = (hour: string) => {
                  if (
                    rowShifts.some((s) =>
                      shiftCoversHour(String(s.start_time), String(s.end_time), hour),
                    )
                  ) {
                    return true;
                  }
                  for (const ob of rowObservations) {
                    const sh = dayShifts.find(
                      (x) => Number(x.id) === Number(ob.shift_id ?? ob.shiftId),
                    );
                    if (
                      sh &&
                      shiftCoversHour(
                        String(sh.start_time),
                        String(sh.end_time),
                        hour,
                      )
                    ) {
                      return true;
                    }
                  }
                  return false;
                };
                const obsStackedIds = new Set<number>();
                for (const c of shiftClusters) {
                  for (const cl of c) {
                    const ob = observationByShiftId.get(Number(cl.id));
                    if (
                      ob &&
                      Number(ob.employee_id ?? ob.employeeId) === eid
                    ) {
                      obsStackedIds.add(Number(ob.id));
                    }
                  }
                }
                const standaloneRowObs = rowObservations.filter(
                  (ob) => !obsStackedIds.has(Number(ob.id)),
                );
                return (
                  <tr key={eid} className="border-b border-line hover:bg-peach-1/30">
                    <td
                      className={`sticky right-0 z-10 w-[7.75rem] max-w-[7.75rem] min-w-0 border-s border-line px-1.5 py-1 align-middle ${
                        rowFullyDisabled ? "bg-muted/35" : "bg-surface"
                      }`}
                    >
                      <span
                        className={`block truncate font-heading text-sm font-bold ${
                          rowFullyDisabled ? "text-muted" : "text-ink"
                        }`}
                        title={name}
                      >
                        {name}
                      </span>
                    </td>
                    <td
                      colSpan={hours.length}
                      className="relative border-s border-line px-0 py-0 align-middle"
                    >
                      <div className="relative min-h-[28px] w-full">
                        <div className="absolute inset-0 z-0 flex min-h-[28px] items-stretch">
                          {hours.map((hour) => {
                            const hasShift = hasActivityInHour(hour);
                            const hourEnabled =
                              enabledHoursByEmployeeId.get(eid)?.has(hour) ?? false;
                            const hl = activeDragHighlightMs;
                            let droppableDisabled: boolean;
                            if (matrixDragKind === null || !hl) {
                              droppableDisabled = hasShift || !hourEnabled;
                            } else if (matrixDragKind === "typeSlot") {
                              const ch = matrixTypeSlotCoveredHours ?? [];
                              droppableDisabled =
                                !hourEnabled ||
                                !ch.includes(hour) ||
                                (matrixTypeSlotOverlapEmps?.has(eid) ?? false);
                            } else if (matrixDragKind === "empShift") {
                              droppableDisabled =
                                !hourEnabled ||
                                (matrixEmpShiftOverlapEmps?.has(eid) ?? false);
                            } else if (matrixDragKind === "obsSlot") {
                              const ch = matrixTypeSlotCoveredHours ?? [];
                              droppableDisabled =
                                !hourEnabled ||
                                !ch.includes(hour) ||
                                (matrixObsSlotOverlapEmps?.has(eid) ?? false);
                            } else if (matrixDragKind === "obsRow") {
                              droppableDisabled =
                                !hourEnabled ||
                                (matrixObsRowOverlapEmps?.has(eid) ?? false);
                            } else {
                              droppableDisabled = !hourEnabled;
                            }
                            const cellBg = !hourEnabled
                              ? "bg-muted/35"
                              : hasShift
                                ? ""
                                : "bg-background/40";
                            return (
                              <MatrixEmployeeHourDropZone
                                key={`${eid}-dz-${hour}`}
                                employeeId={eid}
                                hour={hour}
                                hasEmployeeShiftInHour={hasShift}
                                droppableDisabled={droppableDisabled}
                                className={cellBg}
                              />
                            );
                          })}
                        </div>
                        {scheduleMatrixFrame && matrixRangeMs > 0 ? (
                          <div className="pointer-events-none relative z-[2] min-h-[28px] w-full">
                            {rowScheduleEvents.map((ev, evIdx) => {
                                const rawKind = String(ev.event_kind ?? "event");
                                const eventKind: ScheduleMatrixEventKind =
                                  rawKind === "constraint" ||
                                  rawKind === "operational" ||
                                  rawKind === "event"
                                    ? rawKind
                                    : "event";
                                const resizingThis =
                                  scheduleEventResizeDraft?.eventId ===
                                  Number(ev.id);
                                const startHmUse = resizingThis
                                  ? scheduleEventResizeDraft.persistStartHm
                                  : String(ev.start_time ?? "");
                                const endHmUse = resizingThis
                                  ? scheduleEventResizeDraft.persistEndHm
                                  : String(ev.end_time ?? "");
                                const iv = shiftWallIntervalMs(
                                  dateStr,
                                  startHmUse,
                                  endHmUse,
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
                                  ((s - scheduleMatrixFrame.frameStartMs) /
                                    matrixRangeMs) *
                                  100;
                                const widthPct = Math.max(
                                  0.12,
                                  ((e - s) / matrixRangeMs) * 100,
                                );
                                const sh = startHmUse.trim().slice(0, 5);
                                const eh = endHmUse.trim().slice(0, 5);
                                return (
                                  <MatrixScheduleEventBar
                                    key={`se-${ev.id}`}
                                    name={String(ev.name ?? "")}
                                    eventKind={eventKind}
                                    leftPct={leftPct}
                                    widthPct={widthPct}
                                    zIndex={zEventStart + evIdx}
                                    pillInsetClassName={MATRIX_PILL_INSET_X}
                                    showStartContinuation={sh === "00:00"}
                                    showEndContinuation={eh === "23:59"}
                                    onResizeEdgePointerDown={(edge, pe) =>
                                      beginScheduleEventResize(
                                        Number(ev.id),
                                        edge,
                                        ev.start_time,
                                        ev.end_time,
                                        pe,
                                      )
                                    }
                                    onLongPressDelete={() =>
                                      scheduleEventDeleteMut.mutate(Number(ev.id))
                                    }
                                  />
                                );
                              })}
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
                                      zIndexBase={zPrepStart + idx * zPrepStridePerCluster + subIdx}
                                      pillInsetClassName={MATRIX_PILL_INSET_X}
                                    />
                                  ))}
                                  <div
                                    className="pointer-events-auto absolute top-1/2 box-border -translate-y-1/2 py-0.5"
                                    style={{
                                      insetInlineStart: `${leftPct}%`,
                                      width: `${widthPct}%`,
                                      zIndex: zShiftClusterStart + idx,
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
                                      {cluster.flatMap((clShift) => {
                                        const ob = observationByShiftId.get(
                                          Number(clShift.id),
                                        );
                                        if (
                                          !ob ||
                                          Number(ob.employee_id ?? ob.employeeId) !==
                                            eid
                                        ) {
                                          return [];
                                        }
                                        const { muted: obsMuted } = shiftTypePillColors(
                                          String(
                                            clShift.type_color ??
                                              clShift.typeColor ??
                                              "#7BA3B5",
                                          ),
                                        );
                                        const rname = String(
                                          clShift.syllabus_role_name ??
                                            clShift.syllabusRoleName ??
                                            "",
                                        ).trim();
                                        const obsTitle =
                                          `תצפית\n${pillTitle}` +
                                          (rname ? `\n${rname}` : "");
                                        return [
                                          <MatrixDraggableObservationPill
                                            key={`obs-in-${ob.id}`}
                                            observationId={Number(ob.id)}
                                            shiftId={Number(clShift.id)}
                                            employeeId={eid}
                                            typeColorMuted={obsMuted}
                                            title={obsTitle}
                                            highlightStartMs={s}
                                            highlightEndMs={e}
                                            onLongPressDelete={() =>
                                              deleteObservationMut.mutate(
                                                Number(ob.id),
                                              )
                                            }
                                          />,
                                        ];
                                      })}
                                    </div>
                                  </div>
                                </Fragment>
                              );
                            })}
                            {standaloneRowObs.map((ob, soIdx) => {
                              const sh = dayShifts.find(
                                (x) =>
                                  Number(x.id) === Number(ob.shift_id ?? ob.shiftId),
                              );
                              if (!sh) return null;
                              const sIv = shiftWallIntervalMs(
                                dateStr,
                                String(sh.start_time),
                                String(sh.end_time),
                              );
                              const sClip = clipIntervalToFrame(
                                sIv.startMs,
                                sIv.endMs,
                                scheduleMatrixFrame.frameStartMs,
                                scheduleMatrixFrame.frameEndMs,
                              );
                              if (!sClip) return null;
                              const [s0, s1] = sClip;
                              const sLeft =
                                ((s0 - scheduleMatrixFrame.frameStartMs) /
                                  matrixRangeMs) *
                                100;
                              const sW = ((s1 - s0) / matrixRangeMs) * 100;
                              const tcol = String(
                                sh.type_color ?? sh.typeColor ?? "#7BA3B5",
                              );
                              const { muted: sMuted } = shiftTypePillColors(tcol);
                              const sTitle = `תצפית\n${String(sh.type_name ?? "")}`;
                              const zSolo =
                                zShiftClusterStart +
                                shiftClusters.length +
                                soIdx +
                                1;
                              return (
                                <Fragment key={`obs-standalone-${ob.id}`}>
                                  <MatrixEmployeePrepRestBands
                                    dateStr={dateStr}
                                    shift={sh}
                                    frameStartMs={scheduleMatrixFrame.frameStartMs}
                                    frameEndMs={scheduleMatrixFrame.frameEndMs}
                                    matrixRangeMs={matrixRangeMs}
                                    zIndexBase={zPrepStart - 1 + soIdx}
                                    pillInsetClassName={MATRIX_PILL_INSET_X}
                                  />
                                  <div
                                    className="pointer-events-auto absolute top-1/2 box-border -translate-y-1/2 py-0.5"
                                    style={{
                                      insetInlineStart: `${sLeft}%`,
                                      width: `${sW}%`,
                                      zIndex: zSolo,
                                    }}
                                  >
                                    <div
                                      className={`box-border flex min-h-0 w-full min-w-0 flex-col gap-0.5 ${MATRIX_PILL_INSET_X}`}
                                    >
                                      <MatrixDraggableObservationPill
                                        observationId={Number(ob.id)}
                                        shiftId={Number(sh.id)}
                                        employeeId={eid}
                                        typeColorMuted={sMuted}
                                        title={sTitle}
                                        highlightStartMs={s0}
                                        highlightEndMs={s1}
                                        onLongPressDelete={() =>
                                          deleteObservationMut.mutate(Number(ob.id))
                                        }
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
                    <td className="sticky right-0 z-10 w-[7.75rem] max-w-[7.75rem] min-w-0 border-s border-line bg-ink/[0.055] px-2 py-0.5 align-middle">
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
                          const slotHasObservation = assigned.some((s) =>
                            observationByShiftId.has(Number(s.id)),
                          );

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
                                    (() => {
                                      const ms = assigned[0];
                                      if (!ms) return null;
                                      if (slotHasObservation) {
                                        return (
                                          <MatrixObservationWindowOutlinePill
                                            title={title}
                                          />
                                        );
                                      }
                                      return (
                                        <MatrixDraggableObservationSlotPill
                                          shiftId={Number(ms.id)}
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
                                          fill={fillManned}
                                          title={title}
                                          highlightStartMs={highlightStartMs}
                                          highlightEndMs={highlightEndMs}
                                        />
                                      );
                                    })()
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
                                        observationByShiftId.has(
                                          Number(mannedShift.id),
                                        ) || slotHasObservation ? (
                                          <MatrixObservationWindowOutlinePill
                                            title={title}
                                          />
                                        ) : (
                                          <MatrixDraggableObservationSlotPill
                                            shiftId={Number(mannedShift.id)}
                                            shiftWindowId={tid}
                                            syllabusNum={seg.syllabusNum}
                                            syllabusRoleId={rid}
                                            coveredHours={coveredHours}
                                            displayHour={displayHour}
                                            fill={fillManned}
                                            title={title}
                                            highlightStartMs={highlightStartMs}
                                            highlightEndMs={highlightEndMs}
                                          />
                                        )
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
                <td className="sticky right-0 z-10 w-[7.75rem] max-w-[7.75rem] min-w-0 border-s border-line bg-ink/[0.055] px-2 py-0.5 align-middle">
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
                  className={`pointer-events-none absolute ${matrixRangeDrag ? "z-[20]" : "z-[18]"}`}
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
                    className={`pointer-events-none absolute ${matrixRangeDrag ? "z-[20]" : "z-[18]"}`}
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
            {matrixRangeBandUi ? (
              <div
                className="pointer-events-none absolute z-[19]"
                style={{
                  top: matrixRangeBandUi.bandTop,
                  left: matrixRangeBandUi.gridLeft,
                  width: matrixRangeBandUi.gridWidth,
                  height: matrixRangeBandUi.bandHeight,
                }}
              >
                <div
                  ref={matrixEventCreateDraft ? matrixRangeBandMeasureRef : undefined}
                  className={`absolute inset-y-0 box-border ${MATRIX_PILL_INSET_X}`}
                  style={{
                    insetInlineStart: `${matrixRangeBandUi.startPct}%`,
                    width: `${matrixRangeBandUi.widthPct}%`,
                  }}
                >
                  <div className="relative h-full w-full rounded-sm bg-primary/15 ring-1 ring-primary/35">
                    {matrixRangeBandEdgeFlags?.showStartContinuation ? (
                      <span
                        className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-0.5 font-heading text-[8px] font-semibold leading-none text-primary"
                        aria-hidden
                      >
                        ▶
                      </span>
                    ) : null}
                    {matrixRangeBandEdgeFlags?.showEndContinuation ? (
                      <span
                        className="pointer-events-none absolute inset-y-0 end-0 flex items-center pe-0.5 font-heading text-[8px] font-semibold leading-none text-primary"
                        aria-hidden
                      >
                        ◀
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {dragOverlayColor ? (
            <span
              className={`box-border block shrink-0 rounded-pill shadow-sm ${
                dragOverlayRingBlack ? "ring-2 ring-ink" : "ring-1 ring-black/10"
              }`}
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
    {matrixEventCreateDraft && matrixEventPopupPos && typeof document !== "undefined"
      ? createPortal(
          <MatrixEventCreatePopup
            rootRef={matrixEventCreatePopupRef}
            top={matrixEventPopupPos.top}
            left={matrixEventPopupPos.left}
            timeLabel={`צור אירוע - ${formatMatrixEventPersistHmForPopup(matrixEventCreateDraft.persistStartHm, "start")}–${formatMatrixEventPersistHmForPopup(matrixEventCreateDraft.persistEndHm, "end")}`}
            name={matrixEventCreateDraft.nameInput}
            onNameChange={(v) =>
              setMatrixEventCreateDraft((prev) =>
                prev ? { ...prev, nameInput: v.slice(0, 18) } : null,
              )
            }
            onPickKind={pickScheduleEventKind}
            isSubmitting={scheduleEventCreateMut.isPending}
          />,
          document.body,
        )
      : null}
    </>
  );
}
