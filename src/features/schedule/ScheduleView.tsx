import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { useAppStore, weekStartString } from "../../app/store";
import * as api from "../../shared/api";
import { formatYmd } from "../../shared/dates";
import {
  hourSlotsForTypeOnDay,
  shiftCoversHour,
  timeToMin,
  typesCoveringHourSlot,
  unionHourSlotsForDay,
} from "../../shared/manningHours";
import {
  DEFAULT_SHIFT_TYPE_PASTEL_HEX,
  PASTEL_SWATCH_COLUMNS,
} from "../../shared/pastelPalette";
import { shiftTypePillColors } from "../../shared/shiftTypeColors";
import { coverageIsoToHm, formatTimeForInput } from "../../shared/timeFormat";
import type { JsonObject } from "../../shared/api";

function normalizeShiftRow(s: JsonObject): JsonObject {
  return {
    ...s,
    shift_date: s.shift_date ?? s.shiftDate,
    employee_id: "employee_id" in s ? s.employee_id : s.employeeId,
    start_time: s.start_time ?? s.startTime,
    end_time: s.end_time ?? s.endTime,
    type_name: s.type_name ?? s.typeName,
    shift_type_id: s.shift_type_id ?? s.shiftTypeId,
  };
}

function typeId(ty: JsonObject): number {
  return Number(ty.id);
}

function coverageIsoFromDayAndHm(dateStr: string, hm: string): string {
  const t = String(hm).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (m) {
    const hh = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    return `${dateStr}T${hh}:${mm}:00`;
  }
  return `${dateStr}T${t}`;
}

function buildShiftTypePayload(d: JsonObject, dateStr: string): JsonObject {
  const startHm = String(d.coverage_start_time ?? "06:00");
  const endHm = String(d.coverage_end_time ?? "21:00");
  return {
    name: String(d.name ?? "").trim(),
    duration_minutes: Number(d.duration_minutes ?? 60),
    prep_minutes: Number(d.prep_minutes ?? 0),
    recovery_minutes: Number(d.recovery_minutes ?? 0),
    color: String(d.color ?? DEFAULT_SHIFT_TYPE_PASTEL_HEX),
    min_role_id:
      d.min_role_id === "" || d.min_role_id == null ? null : Number(d.min_role_id),
    allow_fly: Boolean(d.allow_fly),
    max_concurrent_management: Number(d.max_concurrent_management ?? 0),
    notes: d.notes ? String(d.notes) : null,
    coverage_start: coverageIsoFromDayAndHm(dateStr, startHm),
    coverage_end: coverageIsoFromDayAndHm(dateStr, endHm),
  };
}

function slotEndFromHourStart(hour: string): string {
  const nh = (parseInt(hour.slice(0, 2), 10) % 24) + 1;
  return `${String(nh).padStart(2, "0")}:00`;
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

type MatrixShiftDragData = {
  kind: "shift";
  shiftId: number;
  sourceEmployeeId: number;
  hour: string;
  color: string;
};

type MatrixTypeSlotDragData = {
  kind: "typeSlot";
  shiftTypeId: number;
  hour: string;
  color: string;
};

function MatrixDraggableShiftPill({
  shiftId,
  sourceEmployeeId,
  hour,
  typeColor,
  title,
  onLongPressDelete,
}: {
  shiftId: number;
  sourceEmployeeId: number;
  hour: string;
  typeColor: string;
  title: string;
  onLongPressDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `employee-shift-${shiftId}`,
    data: {
      kind: "shift" as const,
      shiftId,
      sourceEmployeeId,
      hour,
      color: typeColor,
    },
  });

  const isDraggingRef = useRef(false);
  isDraggingRef.current = isDragging;

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

  useEffect(() => {
    if (isDragging) clearLongPress();
  }, [isDragging, clearLongPress]);

  const l = (listeners ?? {}) as {
    onPointerDown?: PointerEventHandler<HTMLSpanElement>;
    onPointerMove?: PointerEventHandler<HTMLSpanElement>;
    onPointerUp?: PointerEventHandler<HTMLSpanElement>;
    onPointerCancel?: PointerEventHandler<HTMLSpanElement>;
  } & Record<string, unknown>;
  const {
    onPointerDown: dndPointerDown,
    onPointerMove: dndPointerMove,
    onPointerUp: dndPointerUp,
    onPointerCancel: dndPointerCancel,
    ...restListeners
  } = l;

  const moveThresholdSq = LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX;

  return (
    <span
      ref={setNodeRef}
      className="block h-2.5 w-full max-w-full cursor-grab touch-none rounded-pill shadow-sm ring-1 ring-black/10 active:cursor-grabbing"
      style={{
        backgroundColor: typeColor,
        opacity: isDragging ? 0.4 : 1,
      }}
      title={title}
      aria-label={title}
      {...attributes}
      {...restListeners}
      onPointerDown={(e) => {
        startPos.current = { x: e.clientX, y: e.clientY };
        longPressTimer.current = window.setTimeout(() => {
          longPressTimer.current = null;
          startPos.current = null;
          if (isDraggingRef.current) return;
          onLongPressDelete();
        }, LONG_PRESS_MS);
        dndPointerDown?.(e);
      }}
      onPointerMove={(e) => {
        const s = startPos.current;
        if (s) {
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (dx * dx + dy * dy > moveThresholdSq) clearLongPress();
        }
        dndPointerMove?.(e);
      }}
      onPointerUp={(e) => {
        clearLongPress();
        dndPointerUp?.(e);
      }}
      onPointerCancel={(e) => {
        clearLongPress();
        dndPointerCancel?.(e);
      }}
    />
  );
}

function MatrixDraggableTypeSlotPill({
  shiftTypeId,
  hour,
  fill,
  title,
}: {
  shiftTypeId: number;
  hour: string;
  fill: string;
  title: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `type-slot-${shiftTypeId}-${hour}`,
    data: {
      kind: "typeSlot" as const,
      shiftTypeId,
      hour,
      color: fill,
    },
  });
  return (
    <span
      ref={setNodeRef}
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

function MatrixEmployeeHourTd({
  employeeId,
  hour,
  highlightColumnHour,
  className,
  onClick,
  children,
}: {
  employeeId: number;
  hour: string;
  highlightColumnHour: string | null;
  className?: string;
  onClick: (e: ReactMouseEvent<HTMLTableCellElement>) => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `emp-cell-${employeeId}-${hour}`,
    data: { employeeId, hour },
  });
  const colOn = highlightColumnHour !== null && hour === highlightColumnHour;
  const colTint = colOn
    ? isOver
      ? " !bg-primary/25"
      : " !bg-primary/15"
    : "";
  return (
    <td ref={setNodeRef} className={`${className ?? ""}${colTint}`} onClick={onClick}>
      {children}
    </td>
  );
}

function PastelSwatchGridDropdown({
  value,
  onChange,
  open,
  onOpenChange,
  trigger = "dot",
}: {
  value: string;
  onChange: (hex: string) => void;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  trigger?: "dot" | "panel";
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      onOpenChange(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onOpenChange]);

  const norm = value.trim().toUpperCase();

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      {trigger === "dot" ? (
        <button
          type="button"
          className="size-8 shrink-0 rounded-full border border-line shadow-sm ring-1 ring-black/10 transition hover:ring-2 hover:ring-primary/40 focus-visible:outline focus-visible:ring-2 focus-visible:ring-primary"
          style={{ backgroundColor: value }}
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="בחר צבע"
          title="בחר צבע"
        />
      ) : (
        <button
          type="button"
          className="flex w-full max-w-[200px] items-center gap-2 rounded-card border border-line bg-background px-2 py-1.5 text-start"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <span
            className="size-7 shrink-0 rounded-md border border-line shadow-sm ring-1 ring-black/5"
            style={{ backgroundColor: value }}
          />
          <span className="text-xs text-muted" aria-hidden>
            ▼
          </span>
        </button>
      )}
      {open ? (
        <div
          className="absolute z-[60] mt-1 w-max rounded-card border border-line bg-white p-2 shadow-airy"
          style={{ insetInlineStart: 0 }}
        >
          <div className="flex flex-col gap-1" role="listbox">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="grid grid-cols-5 gap-1">
                {PASTEL_SWATCH_COLUMNS.map((col, colIdx) => {
                  const hex = col[row];
                  const selected = hex.toUpperCase() === norm;
                  return (
                    <button
                      key={`${colIdx}-${row}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`size-8 rounded-md border border-line shadow-sm ring-1 ring-black/5 transition-transform hover:scale-105 ${
                        selected ? "ring-2 ring-primary ring-offset-1" : ""
                      }`}
                      style={{ backgroundColor: hex }}
                      title={hex}
                      onClick={() => {
                        onChange(hex);
                        onOpenChange(false);
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ShiftTypeDraftFormFields({
  draft,
  setDraft,
  roles,
  shiftTypeTimeError,
  setShiftTypeTimeError,
  saveErrorMessage,
}: {
  draft: JsonObject;
  setDraft: (next: JsonObject) => void;
  roles: JsonObject[];
  shiftTypeTimeError: string | null;
  setShiftTypeTimeError: (v: string | null) => void;
  saveErrorMessage: string | null;
}) {
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
      <div className="grid grid-cols-2 gap-3">
        <div className="form-row">
          <label className="text-sm font-semibold text-ink">התחלת חלון</label>
          <input
            type="time"
            dir="ltr"
            value={formatTimeForInput(String(draft.coverage_start_time ?? "06:00"))}
            onChange={(e) => {
              setShiftTypeTimeError(null);
              setDraft({
                ...draft,
                coverage_start_time: e.target.value,
              });
            }}
          />
        </div>
        <div className="form-row">
          <label className="text-sm font-semibold text-ink">סיום חלון</label>
          <input
            type="time"
            dir="ltr"
            value={formatTimeForInput(String(draft.coverage_end_time ?? "21:00"))}
            onChange={(e) => {
              setShiftTypeTimeError(null);
              setDraft({
                ...draft,
                coverage_end_time: e.target.value,
              });
            }}
          />
        </div>
      </div>
      <details className="rounded-card border border-line bg-background/50 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          אפשרויות מתקדמות
        </summary>
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="form-row">
              <label className="text-sm font-semibold text-ink">משך (דק׳)</label>
              <input
                type="number"
                className="px-2 py-2"
                value={String(draft.duration_minutes ?? 60)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    duration_minutes: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="form-row">
              <label className="text-sm font-semibold text-ink">הכנה</label>
              <input
                type="number"
                className="px-2 py-2"
                value={String(draft.prep_minutes ?? 0)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    prep_minutes: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="form-row">
              <label className="text-sm font-semibold text-ink">התאוששות</label>
              <input
                type="number"
                className="px-2 py-2"
                value={String(draft.recovery_minutes ?? 0)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    recovery_minutes: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>
          <div className="form-row">
            <label className="text-sm font-semibold text-ink">דרג מינימלי</label>
            <select
              value={
                draft.min_role_id === "" || draft.min_role_id == null
                  ? ""
                  : String(draft.min_role_id)
              }
              onChange={(e) =>
                setDraft({
                  ...draft,
                  min_role_id: e.target.value ? Number(e.target.value) : "",
                })
              }
            >
              <option value="">—</option>
              {roles.map((r) => (
                <option key={String(r.id)} value={String(r.id)}>
                  {String(r.name)}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={Boolean(draft.allow_fly)}
                onChange={(e) => setDraft({ ...draft, allow_fly: e.target.checked })}
              />
              מאפשר טיסה
            </label>
          </div>
          <div className="form-row">
            <label className="text-sm font-semibold text-ink">מקס׳ ניהול במקביל</label>
            <input
              type="number"
              value={String(draft.max_concurrent_management ?? 0)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  max_concurrent_management: Number(e.target.value),
                })
              }
            />
          </div>
          <div className="form-row">
            <label className="text-sm font-semibold text-ink">הערות</label>
            <input
              value={String(draft.notes ?? "")}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>
        </div>
      </details>
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
  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: api.getRoles,
  });
  const { data: typesRaw = [] } = useQuery({
    queryKey: ["shift_types", dateStr],
    queryFn: () => api.getShiftTypes(dateStr),
  });
  const types = useMemo(() => typesRaw as JsonObject[], [typesRaw]);
  const typesOrdered = useMemo(
    () => [...types].sort((a, b) => typeId(a) - typeId(b)),
    [types],
  );
  const typeHourSlots = useMemo(() => {
    const m = new Map<number, Set<string>>();
    for (const ty of types) {
      m.set(typeId(ty), new Set(hourSlotsForTypeOnDay(ty, dateStr)));
    }
    return m;
  }, [types, dateStr]);
  const hours = useMemo(() => unionHourSlotsForDay(dateStr, types), [dateStr, types]);

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
  const [activeDragHour, setActiveDragHour] = useState<string | null>(null);
  const [dragOverlayColor, setDragOverlayColor] = useState<string | null>(null);
  const suppressCellClickUntil = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  /** Types that cover this hour and have no assigned shift of that type covering this hour on this day. */
  const typesAvailableForPicker = useMemo(() => {
    if (!typePicker) return [];
    const hour = typePicker.hour;
    const covering = typesCoveringHourSlot(types, dateStr, hour);
    return covering.filter((ty) => {
      const tid = typeId(ty);
      const hasAssigned = dayShifts.some((s) => {
        const sid = Number(s.shift_type_id ?? s.shiftTypeId);
        if (sid !== tid) return false;
        if (!shiftCoversHour(String(s.start_time), String(s.end_time), hour)) return false;
        const eid = s.employee_id;
        return eid !== null && eid !== undefined && eid !== "";
      });
      return !hasAssigned;
    });
  }, [typePicker, types, dateStr, dayShifts]);

  const createMut = useMutation({
    mutationFn: (args: {
      shift_type_id: number;
      employee_id: number;
      start: string;
      end: string;
    }) =>
      api.createShift({
        shift_date: dateStr,
        shift_type_id: args.shift_type_id,
        start_time: args.start,
        end_time: args.end,
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

  const reassignMut = useMutation({
    mutationFn: ({
      shiftId,
      employee_id,
    }: {
      shiftId: number;
      employee_id: number;
    }) => api.updateShift(shiftId, { employee_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
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

  const deleteShiftTypeMut = useMutation({
    mutationFn: (id: number) => api.deleteShiftType(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift_types"] });
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
      setDeleteTypeConfirm(null);
      setTypePicker(null);
    },
  });

  const createShiftTypeMut = useMutation({
    mutationFn: (payload: JsonObject) => api.createShiftType(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift_types"] });
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
      setShiftTypeDraft(null);
    },
    onError: (err) => {
      window.alert(err instanceof Error ? err.message : String(err));
    },
  });

  const updateShiftTypeMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: JsonObject }) =>
      api.updateShiftType(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift_types"] });
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
      setShiftTypeDraft(null);
    },
    onError: (err) => {
      window.alert(err instanceof Error ? err.message : String(err));
    },
  });

  function openEditShiftTypeModal(ty: JsonObject) {
    createShiftTypeMut.reset();
    updateShiftTypeMut.reset();
    setShiftTypeTimeError(null);
    setSwatchMenuOpen(false);
    const covStart = String(ty.coverage_start ?? "");
    const covEnd = String(ty.coverage_end ?? "");
    setShiftTypeDraft({
      id: typeId(ty),
      name: String(ty.name ?? ""),
      coverage_start_time: covStart
        ? formatTimeForInput(coverageIsoToHm(covStart))
        : "06:00",
      coverage_end_time: covEnd
        ? formatTimeForInput(coverageIsoToHm(covEnd))
        : "21:00",
      color: String(ty.color ?? DEFAULT_SHIFT_TYPE_PASTEL_HEX),
      duration_minutes: Number(ty.duration_minutes ?? 60),
      prep_minutes: Number(ty.prep_minutes ?? 0),
      recovery_minutes: Number(ty.recovery_minutes ?? 0),
      min_role_id:
        ty.min_role_id == null || ty.min_role_id === "" ? "" : Number(ty.min_role_id),
      allow_fly: Boolean(ty.allow_fly),
      max_concurrent_management: Number(ty.max_concurrent_management ?? 0),
      notes: ty.notes != null ? String(ty.notes) : "",
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
    createShiftTypeMut.reset();
    updateShiftTypeMut.reset();
    setShiftTypeTimeError(null);
    setSwatchMenuOpen(false);
    setShiftTypeDraft({
      name: "",
      coverage_start_time: "06:00",
      coverage_end_time: "21:00",
      color: DEFAULT_SHIFT_TYPE_PASTEL_HEX,
      duration_minutes: 60,
      prep_minutes: 0,
      recovery_minutes: 0,
      min_role_id: "",
      allow_fly: true,
      max_concurrent_management: 0,
      notes: "",
    });
  }

  function openTypePicker(
    rect: DOMRect,
    employeeId: number,
    employeeName: string,
    hour: string,
  ) {
    const start = hour;
    const end = slotEndFromHourStart(hour);
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
    const d = event.active.data.current as MatrixShiftDragData | MatrixTypeSlotDragData | undefined;
    if (!d) return;
    setActiveDragHour(d.hour);
    setDragOverlayColor(d.color);
  }, []);

  const handleMatrixDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragHour(null);
      setDragOverlayColor(null);
      suppressCellClickUntil.current = Date.now() + 400;

      const { active, over } = event;
      if (!over) return;

      const a = active.data.current as MatrixShiftDragData | MatrixTypeSlotDragData | undefined;
      const o = over.data.current as { employeeId?: number; hour?: string } | undefined;
      if (!a || !o || o.employeeId === undefined || o.hour === undefined) return;
      if (o.hour !== a.hour) return;

      if (a.kind === "shift") {
        if (a.sourceEmployeeId === o.employeeId) return;
        reassignMut.mutate({ shiftId: a.shiftId, employee_id: o.employeeId });
      } else {
        createMut.mutate({
          shift_type_id: a.shiftTypeId,
          employee_id: o.employeeId,
          start: a.hour,
          end: slotEndFromHourStart(a.hour),
        });
      }
    },
    [reassignMut, createMut],
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
          onDragStart={handleMatrixDragStart}
          onDragEnd={handleMatrixDragEnd}
        >
          <div className="w-full overflow-auto rounded-card border border-line bg-surface shadow-airy">
            <table className="w-full min-w-full table-fixed border-collapse">
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
                {hours.map((h) => (
                  <th
                    key={h}
                    className={`min-w-[40px] border-b border-line px-0.5 py-1 text-center font-heading text-[10px] font-bold text-muted ${
                      activeDragHour !== null && h === activeDragHour
                        ? "!bg-primary/15"
                        : "bg-background/80"
                    }`}
                  >
                    {h.slice(0, 2)}
                  </th>
                ))}
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
                    {hours.map((hour) => {
                      const hMin = timeToMin(hour);
                      const overlapping = rowShifts.filter((s) => {
                        const sm = timeToMin(String(s.start_time));
                        const em = timeToMin(String(s.end_time));
                        const crosses = em <= sm;
                        if (!crosses) return hMin >= sm && hMin < em;
                        return hMin >= sm || hMin < em;
                      });
                      const shift = overlapping[0];
                      const isStart =
                        shift && hMin === timeToMin(String(shift.start_time));
                      const extra = overlapping.length > 1 ? overlapping.length - 1 : 0;
                      const typeColor = String(
                        shift?.type_color ?? shift?.typeColor ?? "#7BA3B5",
                      );
                      const pillTitle =
                        String(shift?.type_name ?? "") +
                        (extra > 0 ? ` (+${extra} משמרות נוספות באותה תא)` : "");
                      return (
                        <MatrixEmployeeHourTd
                          key={hour}
                          employeeId={eid}
                          hour={hour}
                          highlightColumnHour={activeDragHour}
                          className={`relative min-h-[28px] min-w-[40px] cursor-pointer border-s border-line px-1 py-0.5 align-middle ${
                            shift ? "" : "bg-background/40"
                          }`}
                          onClick={(e) => {
                            if (Date.now() < suppressCellClickUntil.current) {
                              e.preventDefault();
                              e.stopPropagation();
                              return;
                            }
                            if (shift) return;
                            openTypePicker(
                              (e.currentTarget as HTMLTableCellElement).getBoundingClientRect(),
                              eid,
                              name,
                              hour,
                            );
                          }}
                        >
                          {shift && isStart ? (
                            <div className="flex w-full justify-center py-0.5">
                              <MatrixDraggableShiftPill
                                shiftId={Number(shift.id)}
                                sourceEmployeeId={eid}
                                hour={hour}
                                typeColor={typeColor}
                                title={pillTitle}
                                onLongPressDelete={() => {
                                  suppressCellClickUntil.current = Date.now() + 400;
                                  deleteMut.mutate(Number(shift.id));
                                }}
                              />
                            </div>
                          ) : null}
                        </MatrixEmployeeHourTd>
                      );
                    })}
                  </tr>
                );
              })}
              {typesOrdered.map((ty, idx) => {
                const tid = typeId(ty);
                const slotSet = typeHourSlots.get(tid) ?? new Set<string>();
                const typeName = String(ty.name ?? "");
                const { base, muted } = shiftTypePillColors(String(ty.color ?? "#7BA3B5"));
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
                          aria-label={`עריכת סוג משמרת ${typeName}`}
                          title="עריכת סוג משמרת"
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
                    {hours.map((hour) => {
                      if (!slotSet.has(hour)) {
                        return (
                          <td
                            key={hour}
                            className="min-h-[28px] min-w-[40px] border-s border-line bg-ink/[0.055] px-1 py-0.5 align-middle"
                          />
                        );
                      }
                      const assigned = dayShifts.filter((s) => {
                        const sid = Number(s.shift_type_id ?? s.shiftTypeId);
                        if (sid !== tid) return false;
                        if (!shiftCoversHour(String(s.start_time), String(s.end_time), hour))
                          return false;
                        const eid = s.employee_id;
                        return eid !== null && eid !== undefined && eid !== "";
                      });
                      const hasAssigned = assigned.length > 0;
                      const fill = hasAssigned ? muted : base;
                      const names = [
                        ...new Set(
                          assigned
                            .map((s) => String(s.emp_name ?? s.empName ?? "").trim())
                            .filter(Boolean),
                        ),
                      ];
                      const title =
                        `${typeName} · ${hour}` +
                        (hasAssigned
                          ? ` — מאויש: ${names.join(", ")}`
                          : " — זמין לאיוש");
                      return (
                        <td
                          key={hour}
                          className="relative min-h-[28px] min-w-[40px] border-s border-line bg-ink/[0.055] px-1 py-0.5 align-middle"
                          title={title}
                        >
                          <div
                            className="flex w-full justify-center py-0.5"
                            aria-label={title}
                          >
                            {hasAssigned ? (
                              <span
                                className="block h-2.5 w-full max-w-full rounded-pill shadow-sm ring-1 ring-black/10"
                                style={{ backgroundColor: fill }}
                              />
                            ) : (
                              <MatrixDraggableTypeSlotPill
                                shiftTypeId={tid}
                                hour={hour}
                                fill={fill}
                                title={title}
                              />
                            )}
                          </div>
                        </td>
                      );
                    })}
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
        </div>
        <DragOverlay dropAnimation={null}>
          {dragOverlayColor ? (
            <div className="w-20 py-0.5">
              <span
                className="block h-2.5 w-full rounded-pill shadow-md ring-2 ring-primary/50"
                style={{ backgroundColor: dragOverlayColor }}
              />
            </div>
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
                        createMut.mutate({
                          shift_type_id: tid,
                          employee_id: typePicker.employeeId,
                          start: typePicker.start,
                          end: typePicker.end,
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
                  {Number(shiftTypeDraft.id) > 0 ? "עריכת סוג משמרת" : "סוג משמרת חדש"}
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
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              <ShiftTypeDraftFormFields
                draft={shiftTypeDraft}
                setDraft={(next) => setShiftTypeDraft(next)}
                roles={roles as JsonObject[]}
                shiftTypeTimeError={shiftTypeTimeError}
                setShiftTypeTimeError={setShiftTypeTimeError}
                saveErrorMessage={
                  createShiftTypeMut.isError
                    ? String(
                        (createShiftTypeMut.error as Error)?.message ??
                          createShiftTypeMut.error,
                      )
                    : updateShiftTypeMut.isError
                      ? String(
                          (updateShiftTypeMut.error as Error)?.message ??
                            updateShiftTypeMut.error,
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
                  createShiftTypeMut.isPending ||
                  updateShiftTypeMut.isPending ||
                  !String(shiftTypeDraft.name ?? "").trim()
                }
                onClick={() => {
                  const d = shiftTypeDraft;
                  const startHm = String(d.coverage_start_time ?? "06:00");
                  const endHm = String(d.coverage_end_time ?? "21:00");
                  if (timeToMin(endHm) <= timeToMin(startHm)) {
                    setShiftTypeTimeError("שעת הסיום חייבת להיות אחרי שעת ההתחלה באותו יום");
                    return;
                  }
                  setShiftTypeTimeError(null);
                  const payload = buildShiftTypePayload(d, dateStr);
                  const editId = Number(d.id);
                  if (editId > 0) {
                    updateShiftTypeMut.mutate({ id: editId, payload });
                  } else {
                    createShiftTypeMut.mutate(payload);
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
                disabled={deleteShiftTypeMut.isPending}
                onClick={() => deleteShiftTypeMut.mutate(deleteTypeConfirm.id)}
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
