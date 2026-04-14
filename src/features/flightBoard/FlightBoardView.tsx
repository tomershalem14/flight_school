import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore, weekStartString } from "../../app/store";
import * as api from "../../shared/api";
import { formatYmd } from "../../shared/dates";
import { presetDurationById, shiftPrepRestHmPairs, windowDayTimeline } from "../../shared/manningHours";
import type { JsonObject } from "../../shared/api";
import { errorMessageFromUnknown } from "../../shared/errorMessage";
import { formatTimeForInput } from "../../shared/timeFormat";
import {
  DeleteShiftTypeConfirmDialog,
  ShiftTypeEditorModal,
} from "../schedule/components/ShiftTypeModals";
import { useMatrixPillLongPress } from "../schedule/helpers/useMatrixPillLongPress";
import {
  maxSyllabusRolesInWindowDay,
  pickDefaultSyllabusRoleIdForSlot,
  presetSyllabusRolesSorted,
  shiftIsUpToDate,
  shiftTypeDraftFromWindow,
  slotHasUnmannedRoleForSyllabusNum,
  syllabusRoleCellCanAssign,
  typeId,
} from "../schedule/helpers/scheduleShiftModel";

function normalizeShiftRow(s: JsonObject): JsonObject {
  return {
    ...s,
    shift_date: s.shift_date ?? s.shiftDate,
    employee_id: "employee_id" in s ? s.employee_id : s.employeeId,
    start_time: s.start_time ?? s.startTime,
    end_time: s.end_time ?? s.endTime,
    type_name: s.type_name ?? s.typeName,
    shift_window_id: s.shift_window_id ?? s.shiftWindowId,
    emp_name: s.emp_name ?? s.empName,
    up_to_date: s.up_to_date ?? s.upToDate,
    syllabus_num: s.syllabus_num ?? s.syllabusNum,
    syllabus_role_id: s.syllabus_role_id ?? s.syllabusRoleId,
    prep_start: s.prep_start ?? s.prepStart,
    prep_end: s.prep_end ?? s.prepEnd,
    rest_start: s.rest_start ?? s.restStart,
    rest_end: s.rest_end ?? s.restEnd,
    prep_minutes: s.prep_minutes ?? s.prepMinutes,
    rest_minutes: s.rest_minutes ?? s.restMinutes,
  };
}

function formatHmFromMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Distribute `globalMax` HTML columns across `localMax` logical role columns; sums to `globalMax`. */
function employeeColspans(localMax: number, globalMax: number): number[] {
  if (localMax <= 0) return [globalMax];
  const spans: number[] = [];
  let remaining = globalMax;
  for (let i = 0; i < localMax; i++) {
    const colsLeft = localMax - i;
    const span = i === localMax - 1 ? remaining : Math.ceil(remaining / colsLeft);
    spans.push(span);
    remaining -= span;
  }
  return spans;
}

function prepRestDisplay(shift: JsonObject | undefined): { prep: string; rest: string } {
  if (!shift) return { prep: "—", rest: "—" };
  const { prep, rest } = shiftPrepRestHmPairs(shift);
  const prepStr =
    prep && prep.startHm && prep.endHm
      ? `${formatTimeForInput(prep.startHm)}–${formatTimeForInput(prep.endHm)}`
      : "—";
  const restStr =
    rest && rest.startHm && rest.endHm
      ? `${formatTimeForInput(rest.startHm)}–${formatTimeForInput(rest.endHm)}`
      : "—";
  return { prep: prepStr, rest: restStr };
}

function representativeShiftForMeta(slotShifts: JsonObject[]): JsonObject | undefined {
  const withEmp = slotShifts.filter((s) => {
    const e = s.employee_id;
    return e !== null && e !== undefined && e !== "";
  });
  if (withEmp.length > 0) return withEmp[0];
  return slotShifts[0];
}

function assignedShiftForRoleCell(
  slotShifts: JsonObject[],
  roleId: number,
  roles: JsonObject[],
): JsonObject | undefined {
  const withEmp = slotShifts.filter((s) => {
    const e = s.employee_id;
    return e !== null && e !== undefined && e !== "";
  });
  if (roles.length <= 1) return withEmp[0];
  return withEmp.find((s) => Number(s.syllabus_role_id) === roleId);
}

type SlotEditorTarget = {
  key: string;
  shift_window_id: number;
  syllabus_num: number;
  syllabus_role_id?: number;
};

function FlightBoardAssignedPill({
  empName,
  colColor,
  stale,
  onLongPressDelete,
}: {
  empName: string;
  colColor: string;
  stale: boolean;
  onLongPressDelete: () => void;
}) {
  const lp = useMatrixPillLongPress({ onLongPressDelete });
  const label = String(empName ?? "—");
  return (
    <span
      className="mx-auto flex h-5 min-h-5 max-h-5 w-full max-w-full touch-none select-none items-center justify-center rounded-lg px-1 py-0"
      title="לחיצה ארוכה למחיקה"
      aria-label={label}
      onPointerDown={lp.onPointerDown}
      onPointerMove={lp.onPointerMove}
      onPointerUp={lp.onPointerUp}
      onPointerCancel={lp.onPointerCancel}
    >
      <span
        className={`flex h-full min-h-0 w-full max-w-full items-center justify-center rounded-pill px-1.5 py-0 text-center font-heading text-[10px] font-bold leading-5 text-white ${
          stale
            ? "schedule-striped-warn-pill text-ink shadow-sm ring-1 ring-inset ring-black/10"
            : "shadow-sm ring-1 ring-inset ring-black/10"
        }`}
        style={stale ? undefined : { backgroundColor: colColor }}
      >
        {label}
      </span>
    </span>
  );
}

function EmptySlotAssignCell({
  cellKey,
  editor,
  slotQuery,
  setEditor,
  setSlotQuery,
  employees,
  createMut,
  openPayload,
}: {
  cellKey: string;
  editor: SlotEditorTarget | null;
  slotQuery: string;
  setEditor: (v: SlotEditorTarget | null) => void;
  setSlotQuery: (q: string) => void;
  employees: JsonObject[];
  createMut: UseMutationResult<
    unknown,
    Error,
    {
      shift_window_id: number;
      syllabus_num: number;
      employee_id: number;
      syllabus_role_id?: number;
    },
    unknown
  >;
  openPayload: Omit<SlotEditorTarget, "key">;
}) {
  const isOpen = editor?.key === cellKey;
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = slotQuery.trim();
    if (!q) return employees.slice(0, 25);
    return employees.filter((e) => String(e.name ?? "").includes(q));
  }, [employees, slotQuery]);

  const closeEditor = useCallback(() => {
    setEditor(null);
    setSlotQuery("");
  }, [setEditor, setSlotQuery]);

  const commitPick = useCallback(
    (employeeId: number) => {
      if (!editor || editor.key !== cellKey) return;
      createMut.mutate({
        shift_window_id: editor.shift_window_id,
        syllabus_num: editor.syllabus_num,
        employee_id: employeeId,
        ...(editor.syllabus_role_id != null
          ? { syllabus_role_id: editor.syllabus_role_id }
          : {}),
      });
      closeEditor();
    },
    [cellKey, closeEditor, createMut, editor],
  );

  const onInputBlur = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const root = rootRef.current;
        if (root?.contains(document.activeElement)) return;
        if (!editor || editor.key !== cellKey) return;
        closeEditor();
      });
    });
  }, [cellKey, closeEditor, editor]);

  if (!isOpen) {
    return (
      <button
        type="button"
        className="fb-slot-assign transition hover:border-primary/40 hover:bg-primary/5 hover:text-ink"
        onClick={() => {
          setEditor({
            key: cellKey,
            shift_window_id: openPayload.shift_window_id,
            syllabus_num: openPayload.syllabus_num,
            ...(openPayload.syllabus_role_id != null
              ? { syllabus_role_id: openPayload.syllabus_role_id }
              : {}),
          });
          setSlotQuery("");
        }}
      >
        ריק
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative h-5 min-h-0 w-full min-w-0">
      <input
        ref={inputRef}
        type="text"
        dir="rtl"
        autoComplete="off"
        disabled={createMut.isPending}
        value={slotQuery}
        onChange={(e) => setSlotQuery(e.target.value)}
        onBlur={onInputBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const first = filtered[0];
            if (first) commitPick(Number(first.id));
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            closeEditor();
          }
        }}
        className="fb-slot-assign"
        placeholder="שם מפעיל"
        aria-autocomplete="list"
        aria-expanded={filtered.length > 0}
      />
      {filtered.length > 0 ? (
        <ul
          className="absolute start-0 top-full z-30 mt-0.5 max-h-40 min-w-full overflow-y-auto rounded-md border border-line bg-surface py-0.5 shadow-airy"
          onMouseDown={(e) => e.preventDefault()}
        >
          {filtered.map((e) => (
            <li key={String(e.id)}>
              <button
                type="button"
                className="w-full px-2 py-1 text-start text-xs text-ink hover:bg-sky-1/50"
                onMouseDown={() => commitPick(Number(e.id))}
              >
                {String(e.name ?? "")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function FlightBoardView() {
  const currentDay = useAppStore((s) => s.currentDay);
  const qc = useQueryClient();
  const dateStr = formatYmd(currentDay);
  const weekStr = weekStartString(currentDay);

  const { data: presetsRaw = [] } = useQuery({
    queryKey: ["syllabus_presets"],
    queryFn: () => api.getSyllabusPresets(),
  });
  const presets = useMemo(() => presetsRaw as JsonObject[], [presetsRaw]);

  const { data: typesRaw = [] } = useQuery({
    queryKey: ["shift_windows", dateStr],
    queryFn: () => api.getShiftWindows(dateStr),
  });
  const types = useMemo(
    () => (typesRaw as JsonObject[]).slice().sort((a, b) => typeId(a) - typeId(b)),
    [typesRaw],
  );
  const durationByPreset = useMemo(() => presetDurationById(presets), [presets]);

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => api.getEmployees(true),
  });

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

  const globalMax = useMemo(() => {
    let m = 1;
    for (const ty of types) {
      m = Math.max(m, maxSyllabusRolesInWindowDay(dateStr, ty, durationByPreset, presets));
    }
    return m;
  }, [types, dateStr, durationByPreset, presets]);

  const [slotEditor, setSlotEditor] = useState<SlotEditorTarget | null>(null);
  const [slotQuery, setSlotQuery] = useState("");
  const [shiftTypeDraft, setShiftTypeDraft] = useState<JsonObject | null>(null);
  const [deleteTypeConfirm, setDeleteTypeConfirm] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [swatchMenuOpen, setSwatchMenuOpen] = useState(false);
  const [shiftTypeTimeError, setShiftTypeTimeError] = useState<string | null>(null);
  const shiftTypeModalBodyRef = useRef<HTMLDivElement>(null);

  const createMut = useMutation({
    mutationFn: (args: {
      shift_window_id: number;
      syllabus_num: number;
      employee_id: number;
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
      setSlotEditor(null);
      setSlotQuery("");
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
      setSlotEditor(null);
      setSlotQuery("");
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
      setSlotEditor(null);
      setSlotQuery("");
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

  useEffect(() => {
    if (!slotEditor && !deleteTypeConfirm && !shiftTypeDraft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (shiftTypeDraft && swatchMenuOpen) {
        setSwatchMenuOpen(false);
        return;
      }
      setSlotEditor(null);
      setSlotQuery("");
      setDeleteTypeConfirm(null);
      setShiftTypeDraft(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slotEditor, deleteTypeConfirm, shiftTypeDraft, swatchMenuOpen]);

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 px-1">
      {types.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-8 text-center text-muted shadow-airy">
          אין סוגי משמרת ליום זה.
        </div>
      ) : (
        types.map((ty) => {
          const tid = typeId(ty);
          const typeName = String(ty.name ?? "");
          const colColor = String(ty.color ?? "#7BA3B5");
          const localMax = maxSyllabusRolesInWindowDay(dateStr, ty, durationByPreset, presets);
          const colSpans = employeeColspans(localMax, globalMax);
          const { segments } = windowDayTimeline(dateStr, ty, durationByPreset, colColor);
          const colShifts = dayShifts.filter((s) => Number(s.shift_window_id) === tid);
          const presetById = new Map(presets.map((p) => [Number(p.id), p]));
          const employeeBlockWidthPct = 33;
          const metaColWidthPct = (100 - employeeBlockWidthPct) / 5;

          return (
            <div
              key={tid}
              className={
                slotEditor?.shift_window_id === tid
                  ? "overflow-visible rounded-card border border-line bg-surface shadow-airy"
                  : "overflow-hidden rounded-card border border-line bg-surface shadow-airy"
              }
            >
              <div
                className="border-b border-line px-4 py-2 font-heading text-sm font-bold text-ink"
                style={{ backgroundColor: `${colColor}22`, borderBottomColor: colColor }}
              >
                <div className="group mx-auto flex max-w-full items-center justify-center gap-1">
                  <span className="min-w-0 truncate text-center" title={typeName}>
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
              </div>
              <div
                className={
                  slotEditor?.shift_window_id === tid
                    ? "min-w-0 overflow-visible"
                    : "overflow-x-auto"
                }
              >
                <table className="w-full min-w-[720px] table-fixed border-collapse border-2 border-ink/18 text-xs">
                  <colgroup>
                    {Array.from({ length: 4 }, (_, i) => (
                      <col key={`t-${i}`} style={{ width: `${metaColWidthPct.toFixed(2)}%` }} />
                    ))}
                    {Array.from({ length: globalMax }, (_, i) => (
                      <col
                        key={i}
                        style={{
                          width: `${(employeeBlockWidthPct / globalMax).toFixed(2)}%`,
                        }}
                      />
                    ))}
                    <col style={{ width: `${metaColWidthPct.toFixed(2)}%` }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-background/80 text-ink">
                      <th className="border-2 border-ink/18 px-2 py-1 text-center font-heading text-xs font-bold">
                        תדריך
                      </th>
                      <th className="border-2 border-ink/18 px-2 py-1 text-center font-heading text-xs font-bold">
                        התחלה
                      </th>
                      <th className="border-2 border-ink/18 px-2 py-1 text-center font-heading text-xs font-bold">
                        סיום
                      </th>
                      <th className="border-2 border-ink/18 px-2 py-1 text-center font-heading text-xs font-bold">
                        תחקיר
                      </th>
                      <th
                        colSpan={globalMax}
                        className="border-2 border-ink/18 px-2 py-1 text-center font-heading text-xs font-bold"
                      >
                        איוש
                      </th>
                      <th className="border-2 border-ink/18 px-2 py-1 text-center font-heading text-xs font-bold">
                        סילבוס
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {segments.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5 + globalMax}
                          className="border-2 border-ink/18 px-3 py-4 text-center text-xs text-muted"
                        >
                          אין סלוטים בחלון זה
                        </td>
                      </tr>
                    ) : (
                      segments.map((seg) => {
                        const sn = seg.syllabusNum;
                        const slotShifts = colShifts.filter((s) => Number(s.syllabus_num) === sn);
                        const preset = presetById.get(seg.presetId);
                        const rowRoles = presetSyllabusRolesSorted(preset);
                        const metaShift = representativeShiftForMeta(slotShifts);
                        const startEndFromShift =
                          metaShift &&
                          String(metaShift.start_time ?? "").trim() &&
                          String(metaShift.end_time ?? "").trim();
                        const startCell = startEndFromShift
                          ? formatTimeForInput(String(metaShift!.start_time))
                          : formatHmFromMs(seg.startMs);
                        const endCell = startEndFromShift
                          ? formatTimeForInput(String(metaShift!.end_time))
                          : formatHmFromMs(seg.endMs);
                        const { prep: prepCell, rest: restCell } = prepRestDisplay(metaShift);
                        const syllabusName = String(preset?.name ?? "—");
                        const slotOpen = slotHasUnmannedRoleForSyllabusNum(
                          ty,
                          sn,
                          presets,
                          dayShifts,
                        );
                        return (
                          <tr key={sn} className="hover:bg-sky-1/30">
                            <td
                              className="border-2 border-ink/18 px-2 py-1 text-center align-middle tabular-nums"
                              dir="ltr"
                            >
                              {prepCell}
                            </td>
                            <td
                              className="border-2 border-ink/18 px-2 py-1 text-center align-middle tabular-nums"
                              dir="ltr"
                            >
                              {startCell}
                            </td>
                            <td
                              className="border-2 border-ink/18 px-2 py-1 text-center align-middle tabular-nums"
                              dir="ltr"
                            >
                              {endCell}
                            </td>
                            <td
                              className="border-2 border-ink/18 px-2 py-1 text-center align-middle tabular-nums"
                              dir="ltr"
                            >
                              {restCell}
                            </td>
                            {Array.from({ length: localMax }, (_, idx) => {
                              const colspan = colSpans[idx] ?? 1;
                              const employeeTd =
                                "border-2 border-ink/18 px-2 py-1 text-center align-middle";

                              if (idx >= rowRoles.length) {
                                return (
                                  <td
                                    key={`${sn}-pad-${idx}`}
                                    colSpan={colspan}
                                    className={employeeTd}
                                  />
                                );
                              }

                              const role = rowRoles[idx]!;
                              const rid = Number(role.id);
                              const cellShift = assignedShiftForRoleCell(
                                slotShifts,
                                rid,
                                rowRoles,
                              );
                              const hasEmployee =
                                cellShift &&
                                cellShift.employee_id !== null &&
                                cellShift.employee_id !== undefined &&
                                cellShift.employee_id !== "";
                              const stale = cellShift && !shiftIsUpToDate(cellShift);
                              const canAssign = syllabusRoleCellCanAssign(
                                ty,
                                sn,
                                rid,
                                presets,
                                dayShifts,
                              );

                              if (hasEmployee && cellShift) {
                                return (
                                  <td
                                    key={`${sn}-r-${rid}`}
                                    colSpan={colspan}
                                    className={employeeTd}
                                  >
                                    <FlightBoardAssignedPill
                                      empName={String(cellShift.emp_name ?? "—")}
                                      colColor={colColor}
                                      stale={Boolean(stale)}
                                      onLongPressDelete={() =>
                                        deleteMut.mutate(Number(cellShift.id))
                                      }
                                    />
                                  </td>
                                );
                              }

                              if (canAssign) {
                                const cellKey = `${tid}-${sn}-${rid}`;
                                const roleForCreate =
                                  rowRoles.length > 1
                                    ? rid
                                    : pickDefaultSyllabusRoleIdForSlot(
                                        ty,
                                        sn,
                                        presets,
                                        dayShifts,
                                      );
                                return (
                                  <td
                                    key={`${sn}-r-${rid}`}
                                    colSpan={colspan}
                                    className={employeeTd}
                                  >
                                    <EmptySlotAssignCell
                                      cellKey={cellKey}
                                      editor={slotEditor}
                                      slotQuery={slotQuery}
                                      setEditor={setSlotEditor}
                                      setSlotQuery={setSlotQuery}
                                      employees={employees}
                                      createMut={createMut}
                                      openPayload={{
                                        shift_window_id: tid,
                                        syllabus_num: sn,
                                        ...(roleForCreate != null
                                          ? { syllabus_role_id: roleForCreate }
                                          : {}),
                                      }}
                                    />
                                  </td>
                                );
                              }

                              return (
                                <td
                                  key={`${sn}-r-${rid}`}
                                  colSpan={colspan}
                                  className={`${employeeTd} text-xs text-muted`}
                                >
                                  {slotOpen ? "—" : "מלא"}
                                </td>
                              );
                            })}
                            <td
                              className="min-w-0 border-2 border-ink/18 px-2 py-1 align-middle text-center text-ink"
                              title={syllabusName}
                            >
                              <span className="inline-block max-w-full truncate">{syllabusName}</span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
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
  );
}
