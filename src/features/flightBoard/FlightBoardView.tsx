import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAppStore, weekStartString } from "../../app/store";
import * as api from "../../shared/api";
import { formatYmd } from "../../shared/dates";
import { hourSlotsForTypeOnDay, shiftCoversHour } from "../../shared/manningHours";
import { formatTimeForInput } from "../../shared/timeFormat";
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
    emp_name: s.emp_name ?? s.empName,
  };
}

function typeId(ty: JsonObject): number {
  return Number(ty.id);
}

export function FlightBoardView() {
  const currentDay = useAppStore((s) => s.currentDay);
  const qc = useQueryClient();
  const dateStr = formatYmd(currentDay);
  const weekStr = weekStartString(currentDay);

  const { data: typesRaw = [] } = useQuery({
    queryKey: ["shift_types", dateStr],
    queryFn: () => api.getShiftTypes(dateStr),
  });
  const types = useMemo(() => (typesRaw as JsonObject[]).slice().sort((a, b) => typeId(a) - typeId(b)), [typesRaw]);

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

  const [modal, setModal] = useState<{
    mode: "create" | "edit";
    shiftId?: number;
    shift_type_id: number;
    employee_id: number | "";
    start: string;
    end: string;
  } | null>(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!modal) return;
      const body: api.JsonObject = {
        shift_date: dateStr,
        shift_type_id: modal.shift_type_id,
        start_time: modal.start,
        end_time: modal.end,
        employee_id: modal.employee_id === "" ? null : modal.employee_id,
      };
      if (modal.mode === "create") {
        return api.createShift(body);
      }
      return api.updateShift(modal.shiftId!, {
        employee_id: modal.employee_id === "" ? null : modal.employee_id,
        start_time: modal.start,
        end_time: modal.end,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
      setModal(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteShift(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
      setModal(null);
    },
  });

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-xl font-bold text-ink">לוח</h1>
      </div>

      {types.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-8 text-center text-muted shadow-airy">
          אין סוגי משמרת ליום זה.
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {types.map((ty) => {
            const tid = typeId(ty);
            const colColor = String(ty.color ?? "#7BA3B5");
            const slots = hourSlotsForTypeOnDay(ty, dateStr);
            const colShifts = dayShifts.filter((s) => Number(s.shift_type_id) === tid);
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
                      const cellShifts = colShifts.filter((s) =>
                        shiftCoversHour(String(s.start_time), String(s.end_time), hour),
                      );
                      const primary = cellShifts[0];
                      const extra = cellShifts.length > 1 ? cellShifts.length - 1 : 0;
                      return (
                        <button
                          key={hour}
                          type="button"
                          className="flex w-full flex-col gap-1 border-b border-line px-2 py-2 text-start hover:bg-sky-1/50"
                          onClick={() => {
                            if (primary) {
                              setModal({
                                mode: "edit",
                                shiftId: Number(primary.id),
                                shift_type_id: tid,
                                employee_id:
                                  primary.employee_id === null ||
                                  primary.employee_id === undefined ||
                                  primary.employee_id === ""
                                    ? ""
                                    : Number(primary.employee_id),
                                start: String(primary.start_time),
                                end: String(primary.end_time),
                              });
                            } else {
                              const nh = (parseInt(hour.slice(0, 2), 10) % 24) + 1;
                              setModal({
                                mode: "create",
                                shift_type_id: tid,
                                employee_id: "",
                                start: hour,
                                end: `${String(nh).padStart(2, "0")}:00`,
                              });
                            }
                          }}
                        >
                          <div className="text-xs font-bold text-muted">{hour.slice(0, 2)}:00</div>
                          {primary ? (
                            <div
                              className="rounded-pill px-2 py-1 text-center font-heading text-[11px] font-bold text-white"
                              style={{ backgroundColor: colColor }}
                            >
                              {String(primary.emp_name ?? "—")}
                              {extra > 0 ? ` +${extra}` : ""}
                            </div>
                          ) : (
                            <div className="text-xs text-muted">ריק</div>
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

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-card border border-line bg-surface shadow-airy">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="font-heading text-lg font-bold text-ink">
                {modal.mode === "create" ? "משמרת חדשה" : "עריכת משמרת"}
              </h3>
              <button
                type="button"
                className="rounded-pill px-2 text-muted hover:bg-background"
                onClick={() => setModal(null)}
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
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
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-ink">התחלה</label>
                  <input
                    type="time"
                    dir="ltr"
                    value={formatTimeForInput(modal.start)}
                    onChange={(e) => setModal({ ...modal, start: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-ink">סיום</label>
                  <input
                    type="time"
                    dir="ltr"
                    value={formatTimeForInput(modal.end)}
                    onChange={(e) => setModal({ ...modal, end: e.target.value })}
                  />
                </div>
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
              {modal.mode === "edit" && modal.shiftId != null && (
                <button
                  type="button"
                  className="rounded-pill bg-peach-3 px-4 py-2 text-sm font-bold text-white"
                  onClick={() => deleteMut.mutate(modal.shiftId!)}
                >
                  מחק
                </button>
              )}
              <button
                type="button"
                className="rounded-pill bg-primary px-4 py-2 text-sm font-bold text-white"
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
              >
                שמור
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
