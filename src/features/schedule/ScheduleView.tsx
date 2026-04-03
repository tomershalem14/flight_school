import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppStore, weekStartString } from "../../app/store";
import * as api from "../../shared/api";
import { DAYS_HE, addDays, formatYmd } from "../../shared/dates";
import type { JsonObject } from "../../shared/api";

const HOURS = Array.from({ length: 16 }, (_, h) => `${String(h + 6).padStart(2, "0")}:00`);

function timeToMin(t: string): number {
  const parts = String(t).trim().split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/** Tauri IPC may return camelCase keys; DB rows use snake_case. */
function normalizeShiftRow(s: JsonObject): JsonObject {
  return {
    ...s,
    shift_date: s.shift_date ?? s.shiftDate,
    employee_id: "employee_id" in s ? s.employee_id : s.employeeId,
    start_time: s.start_time ?? s.startTime,
    end_time: s.end_time ?? s.endTime,
    type_name: s.type_name ?? s.typeName,
    notes: s.notes,
  };
}

export function ScheduleView() {
  const currentDay = useAppStore((s) => s.currentDay);
  const setCurrentDay = useAppStore((s) => s.setCurrentDay);
  const qc = useQueryClient();
  const dateStr = formatYmd(currentDay);
  const weekStr = weekStartString(currentDay);

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
  const { data: violations = [] } = useQuery({
    queryKey: ["violations", dateStr],
    queryFn: () => api.getDayViolations(dateStr),
  });
  const { data: workload = [] } = useQuery({
    queryKey: ["workload", weekStr],
    queryFn: () => api.getWorkloadReport(weekStr),
  });

  const dayShifts = useMemo(
    () => shifts.filter((s) => String(s.shift_date) === dateStr),
    [shifts, dateStr],
  );

  const [modal, setModal] = useState<{
    mode: "create" | "edit";
    shiftId?: number;
    employee_id: number | "";
    start: string;
    end: string;
    notes: string;
  } | null>(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!modal) return;
      const types = await api.getShiftTypes();
      const typeId = Number(types[0]?.id ?? 1);
      const body: api.JsonObject = {
        shift_date: dateStr,
        shift_type_id: typeId,
        start_time: modal.start,
        end_time: modal.end,
        employee_id: modal.employee_id === "" ? null : modal.employee_id,
        notes: modal.notes || null,
      };
      if (modal.mode === "create") {
        return api.createShift(body);
      }
      const updateBody: api.JsonObject = {
        employee_id: modal.employee_id === "" ? null : modal.employee_id,
        start_time: modal.start,
        end_time: modal.end,
        notes: modal.notes || null,
      };
      return api.updateShift(modal.shiftId!, updateBody);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
      qc.invalidateQueries({ queryKey: ["workload"] });
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

  const waMut = useMutation({
    mutationFn: () => api.sendWhatsapp(weekStr),
    onSuccess: async (rows) => {
      for (const row of rows) {
        const u = String((row as JsonObject).wa_url ?? "");
        if (u) {
          await openUrl(u);
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    },
  });

  const dayLabel = `${DAYS_HE[currentDay.getDay()]} ${dateStr}`;

  return (
    <div className="matrix-layout">
      <div className="week-bar">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCurrentDay(addDays(currentDay, 1))}
        >
          ▶
        </button>
        <span className="week-label">{dayLabel}</span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCurrentDay(addDays(currentDay, -1))}
        >
          ◀
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setCurrentDay(new Date())}
        >
          היום
        </button>
        <div className="spacer" />
        <button type="button" className="btn-wa" onClick={() => waMut.mutate()}>
          שלח בוואטסאפ
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() =>
            setModal({
              mode: "create",
              employee_id: "",
              start: "08:00",
              end: "09:00",
              notes: "",
            })
          }
        >
          + הוסף משמרת
        </button>
      </div>

      {violations.length > 0 && (
        <div className="violations-banner">
          {violations.map((v, i) => (
            <div key={i} className="violation-item">
              {String((v as JsonObject).message ?? "")}
            </div>
          ))}
        </div>
      )}

      <div className="table-wrapper">
        <table id="schedule-table">
          <thead>
            <tr>
              <th className="col-emp-sticky">מפעיל</th>
              {HOURS.map((h) => (
                <th key={h} className="col-hour-slot">
                  {h.slice(0, 2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => {
              const eid = Number(emp.id);
              const name = String(emp.name ?? "");
              const roleColor = String(emp.role_color ?? "#888");
              const roleName = String(emp.role_name ?? "");
              const rowShifts = dayShifts.filter((s) => {
                const se = s.employee_id;
                if (se === null || se === undefined || se === "") return false;
                return Number(se) === eid;
              });
              return (
                <tr key={eid}>
                  <td className="col-emp-sticky">
                    <span style={{ color: roleColor, fontWeight: 700 }}>{name}</span>
                    <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                      {roleName}
                    </div>
                  </td>
                  {HOURS.map((hour) => {
                    const hMin = timeToMin(hour);
                    const shift = rowShifts.find((s) => {
                      const sm = timeToMin(String(s.start_time));
                      const em = timeToMin(String(s.end_time));
                      return hMin >= sm && hMin < em;
                    });
                    const isStart =
                      shift && hMin === timeToMin(String(shift.start_time));
                    return (
                      <td
                        key={hour}
                        className={`hour-cell ${shift ? "shift-cell-hour" : "empty-cell-hour"}`}
                        onClick={() => {
                          if (shift) {
                            setModal({
                              mode: "edit",
                              shiftId: Number(shift.id),
                              employee_id: eid,
                              start: String(shift.start_time),
                              end: String(shift.end_time),
                              notes: String(shift.notes ?? ""),
                            });
                          } else {
                            setModal({
                              mode: "create",
                              employee_id: eid,
                              start: hour,
                              end: `${String((parseInt(hour.slice(0, 2), 10) % 24) + 1).padStart(2, "0")}:00`,
                              notes: "",
                            });
                          }
                        }}
                      >
                        {isStart ? (
                          <span className="hour-label-shift">
                            {String(shift!.type_name ?? "").slice(0, 10)}
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="workload-bar">
        <div className="wl-title">עומסי שבוע</div>
        <div className="workload-items">
          {workload.map((w) => {
            const c = String(w.color ?? "green");
            const wid = w.employee_id ?? w.employeeId;
            return (
              <div key={String(wid)} className={`wl-item ${c}`}>
                <span>{String(w.employee_name ?? w.employeeName ?? "")}</span>
                <span>
                  {String(w.total_shifts ?? w.totalShifts ?? "")} משמרות ·{" "}
                  {String(w.total_hours ?? w.totalHours ?? "")} שעות
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <RemoteRegInline weekStr={weekStr} />

      {modal && (
        <div className="modal-overlay" role="dialog">
          <div className="modal">
            <div className="modal-header">
              <h3>{modal.mode === "create" ? "משמרת חדשה" : "עריכת משמרת"}</h3>
              <button type="button" className="modal-close" onClick={() => setModal(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <label>מפעיל</label>
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
              <div className="form-row">
                <label>התחלה</label>
                <input
                  type="time"
                  value={modal.start}
                  onChange={(e) => setModal({ ...modal, start: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label>סיום</label>
                <input
                  type="time"
                  value={modal.end}
                  onChange={(e) => setModal({ ...modal, end: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label>הערות</label>
                <input
                  value={modal.notes}
                  onChange={(e) => setModal({ ...modal, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setModal(null)}>
                ביטול
              </button>
              {modal.mode === "edit" && modal.shiftId != null && (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => deleteMut.mutate(modal.shiftId!)}
                >
                  מחק
                </button>
              )}
              <button
                type="button"
                className="btn-primary"
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
    <div className="remote-reg-panel" style={{ marginTop: 12 }}>
      <div className="remote-reg-header">
        <span>רישום מרחוק</span>
        <button type="button" className="btn-secondary" onClick={() => regs.refetch()}>
          רענן
        </button>
      </div>
      <div style={{ padding: 8 }}>
        <input
          dir="ltr"
          style={{ width: "60%", marginLeft: 8 }}
          placeholder="Google Sheet URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            await api.saveSheetConfig(url);
            qc.invalidateQueries({ queryKey: ["sheet_config"] });
          }}
        >
          שמור
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            await api.sheetPoll();
            regs.refetch();
          }}
        >
          משוך
        </button>
      </div>
      <div id="remote-reg-list">
        {(regs.data ?? []).map((r) => (
          <div key={String(r.id)} className="remote-reg-item">
            <span>{String(r.employee_name)}</span>
            <span>{String(r.shift_date)}</span>
            <span>{String(r.status)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
