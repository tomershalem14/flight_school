import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAppStore, weekStartString } from "../../app/store";
import * as api from "../../shared/api";
import { formatYmd } from "../../shared/dates";
import {
  hourSlotsForWindowMaterializedOnDay,
  presetDurationById,
  shiftCoversHour,
  syllabusNumForHourInWindow,
} from "../../shared/manningHours";
import type { JsonObject } from "../../shared/api";
import { errorMessageFromUnknown } from "../../shared/errorMessage";
import {
  pickDefaultSyllabusRoleIdForSlot,
  slotHasUnmannedRole,
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

type BoardModal =
  | {
      mode: "create";
      shift_window_id: number;
      syllabus_num: number;
      syllabus_role_id?: number;
      hourLabel: string;
      employee_id: number | "";
    }
  | {
      mode: "assigned";
      shiftId: number;
      empName: string;
      upToDate: boolean;
    };

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

  const [modal, setModal] = useState<BoardModal | null>(null);

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
      setModal(null);
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
      setModal(null);
    },
    onError: (err) => {
      alert(errorMessageFromUnknown(err));
    },
  });

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
      {types.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-8 text-center text-muted shadow-airy">
          אין סוגי משמרת ליום זה.
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {types.map((ty) => {
            const tid = typeId(ty);
            const colColor = String(ty.color ?? "#7BA3B5");
            const slots = hourSlotsForWindowMaterializedOnDay(dateStr, ty, durationByPreset);
            const colShifts = dayShifts.filter((s) => Number(s.shift_window_id) === tid);
            return (
              <div
                key={tid}
                className="flex w-[min(100%,200px)] shrink-0 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-airy"
              >
                <div
                  className="sticky top-0 z-10 border-b border-line px-3 py-2 text-center font-heading text-sm font-bold text-ink"
                  style={{ backgroundColor: `${colColor}22`, borderBottomColor: colColor }}
                >
                  {String(ty.name ?? "")}
                </div>
                <div className="max-h-[min(70vh,640px)] overflow-y-auto">
                  {slots.length === 0 ? (
                    <div className="p-3 text-center text-xs text-muted">אין שעות ביום זה</div>
                  ) : (
                    slots.map((hour) => {
                      const sn = syllabusNumForHourInWindow(dateStr, ty, hour, durationByPreset);
                      const cellShifts = colShifts.filter((s) =>
                        shiftCoversHour(String(s.start_time), String(s.end_time), hour),
                      );
                      const primary = cellShifts[0];
                      const extra = cellShifts.length > 1 ? cellShifts.length - 1 : 0;
                      const stale = primary && !shiftIsUpToDate(primary);
                      const canCreateHere =
                        sn != null &&
                        slotHasUnmannedRole(
                          dateStr,
                          ty,
                          hour,
                          durationByPreset,
                          presets,
                          dayShifts,
                        );
                      return (
                        <button
                          key={hour}
                          type="button"
                          className="flex w-full flex-col gap-1 border-b border-line px-2 py-2 text-start hover:bg-sky-1/50"
                          onClick={() => {
                            if (primary) {
                              setModal({
                                mode: "assigned",
                                shiftId: Number(primary.id),
                                empName: String(primary.emp_name ?? "—"),
                                upToDate: shiftIsUpToDate(primary),
                              });
                            } else if (canCreateHere && sn != null) {
                              const rolePick = pickDefaultSyllabusRoleIdForSlot(
                                ty,
                                sn,
                                presets,
                                dayShifts,
                              );
                              setModal({
                                mode: "create",
                                shift_window_id: tid,
                                syllabus_num: sn,
                                ...(rolePick != null
                                  ? { syllabus_role_id: rolePick }
                                  : {}),
                                hourLabel: hour,
                                employee_id: "",
                              });
                            }
                          }}
                          disabled={!primary && !canCreateHere}
                        >
                          <div className="text-xs font-bold text-muted">{hour.slice(0, 2)}:00</div>
                          {primary ? (
                            <div
                              className={`rounded-pill px-2 py-0.5 text-center font-heading text-[10px] font-bold leading-none text-white ${
                                stale ? "schedule-striped-warn-pill text-ink shadow-sm ring-1 ring-black/10" : "shadow-sm ring-1 ring-black/10"
                              }`}
                              style={stale ? undefined : { backgroundColor: colColor }}
                            >
                              {String(primary.emp_name ?? "—")}
                              {extra > 0 ? ` +${extra}` : ""}
                            </div>
                          ) : canCreateHere ? (
                            <div className="text-xs text-muted">ריק</div>
                          ) : sn != null ? (
                            <div className="text-xs text-muted">מלא</div>
                          ) : (
                            <div className="schedule-striped-warn-pill rounded-pill px-2 py-0.5 text-center text-[10px] font-semibold leading-none text-ink shadow-sm ring-1 ring-black/10">
                              ללא סלוט
                            </div>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && modal.mode === "create" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-card border border-line bg-surface shadow-airy">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="font-heading text-lg font-bold text-ink">משמרת חדשה</h3>
              <button
                type="button"
                className="rounded-pill px-2 text-muted hover:bg-background"
                onClick={() => setModal(null)}
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <p className="text-sm text-muted">שעת סלוט: {modal.hourLabel}</p>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-ink">מפעיל</label>
                <select
                  value={modal.employee_id === "" ? "" : String(modal.employee_id)}
                  onChange={(e) =>
                    setModal({
                      ...modal,
                      employee_id: e.target.value ? Number(e.target.value) : "",
                    })
                  }
                >
                  <option value="">—</option>
                  {employees.map((e) => (
                    <option key={String(e.id)} value={String(e.id)}>
                      {String(e.name)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
              <button
                type="button"
                className="rounded-pill border border-line px-4 py-2 text-sm"
                onClick={() => setModal(null)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="rounded-pill bg-primary px-4 py-2 text-sm font-bold text-white"
                disabled={createMut.isPending || modal.employee_id === ""}
                onClick={() => {
                  if (modal.employee_id === "") return;
                  createMut.mutate({
                    shift_window_id: modal.shift_window_id,
                    syllabus_num: modal.syllabus_num,
                    employee_id: modal.employee_id,
                    ...(modal.syllabus_role_id != null
                      ? { syllabus_role_id: modal.syllabus_role_id }
                      : {}),
                  });
                }}
              >
                שמור
              </button>
            </div>
          </div>
        </div>
      )}

      {modal && modal.mode === "assigned" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-card border border-line bg-surface shadow-airy">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="font-heading text-lg font-bold text-ink">משמרת</h3>
              <button
                type="button"
                className="rounded-pill px-2 text-muted hover:bg-background"
                onClick={() => setModal(null)}
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <p className="text-sm text-ink">
                <span className="font-semibold">מפעיל: </span>
                {modal.empName}
              </p>
              {!modal.upToDate ? (
                <p className="text-xs text-muted">
                  המשמרת אינה מעודכנת לסילבוס הנוכחי; מומלץ למחוק וליצור מחדש.
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
              <button
                type="button"
                className="rounded-pill border border-line px-4 py-2 text-sm"
                onClick={() => setModal(null)}
              >
                סגור
              </button>
              <button
                type="button"
                className="rounded-pill bg-peach-3 px-4 py-2 text-sm font-bold text-white"
                disabled={deleteMut.isPending}
                onClick={() => deleteMut.mutate(modal.shiftId)}
              >
                מחק משמרת
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
