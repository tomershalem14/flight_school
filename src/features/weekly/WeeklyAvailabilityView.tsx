import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { JsonObject } from "../../shared/api";
import * as api from "../../shared/api";
import {
  activePresetIdFromList,
  parseEmployeeKind,
  sortEmployeesByActivePreset,
} from "../../shared/employeeOrderSort";
import { errorMessageFromUnknown } from "../../shared/errorMessage";
import {
  addDays,
  DAYS_HE,
  formatDmSlashed,
  formatYmd,
} from "../../shared/dates";
import { useAppStore } from "../../app/store";
import {
  activeDayIndices,
  clampActiveDaysMask,
  DEFAULT_ACTIVE_DAYS_MASK,
} from "../../shared/weeklyActiveDays";

const DEFAULT_ROLE_HEX = "#64748b";

function isWholeDayRow(r: JsonObject): boolean {
  const st = r.start_time;
  const et = r.end_time;
  const sn = st == null || st === undefined || String(st).trim() === "";
  const en = et == null || et === undefined || String(et).trim() === "";
  return sn && en;
}

function stripKind(rows: JsonObject[]): "none" | "whole" | "timed" {
  if (rows.length === 0) return "none";
  if (rows.some(isWholeDayRow)) return "whole";
  return "timed";
}

/** v1: earliest timed window by `start_time` lexicographic (HH:mm). */
function timedRangeLabel(rows: JsonObject[]): string {
  const timed = rows.filter((r) => !isWholeDayRow(r));
  timed.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  const first = timed[0];
  return `${String(first.start_time)}–${String(first.end_time)}`;
}

function availabilityMapKey(ymd: string, employeeId: number): string {
  return `${ymd}:${employeeId}`;
}

function SmallXIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function WeeklyAvailabilityView() {
  const weeklyWeekStart = useAppStore((s) => s.weeklyWeekStart);
  const weekStartStr = formatYmd(weeklyWeekStart);
  const qc = useQueryClient();

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => api.getEmployees(true),
  });
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

  const sortedRegularEmployees = useMemo(() => {
    const itemsRaw = activeEmployeeOrderPreset?.items;
    const items = Array.isArray(itemsRaw) ? (itemsRaw as JsonObject[]) : null;
    const sorted = sortEmployeesByActivePreset(
      employees,
      activeEmployeeOrderPresetId != null ? items : null,
    );
    return sorted.filter((e) => parseEmployeeKind(e.employee_type) === "regular");
  }, [employees, activeEmployeeOrderPresetId, activeEmployeeOrderPreset]);

  const { data: availabilityRaw = [] } = useQuery({
    queryKey: ["availability", weekStartStr],
    queryFn: () => api.listAvailabilityForWeek(weekStartStr),
  });
  const availabilityRows = useMemo(
    () => availabilityRaw as JsonObject[],
    [availabilityRaw],
  );

  const { data: weeklySettingsRow } = useQuery({
    queryKey: ["weekly_settings", weekStartStr],
    queryFn: () => api.getWeeklySettings(weekStartStr),
  });
  const activeDaysMask = useMemo(() => {
    const row = weeklySettingsRow as JsonObject | null | undefined;
    if (row == null) return DEFAULT_ACTIVE_DAYS_MASK;
    return clampActiveDaysMask(Number(row.active_days_mask ?? DEFAULT_ACTIVE_DAYS_MASK));
  }, [weeklySettingsRow]);

  const visibleDayOffsets = useMemo(
    () => activeDayIndices(activeDaysMask),
    [activeDaysMask],
  );

  const byKey = useMemo(() => {
    const m = new Map<string, JsonObject[]>();
    for (const r of availabilityRows) {
      const ymd = String(r.avail_date ?? "");
      const eid = Number(r.employee_id ?? 0);
      if (!ymd || !eid) continue;
      const k = availabilityMapKey(ymd, eid);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  }, [availabilityRows]);

  type AvailVars = { employeeId: number; ymd: string };
  type AvailCtx = { previous: JsonObject[] | undefined };

  const createMut = useMutation<JsonObject, Error, AvailVars, AvailCtx>({
    mutationFn: ({ employeeId, ymd }) => api.createAvailabilityWholeDay(employeeId, ymd),
    onMutate: async ({ employeeId, ymd }) => {
      await qc.cancelQueries({ queryKey: ["availability", weekStartStr] });
      const previous = qc.getQueryData<JsonObject[]>(["availability", weekStartStr]);
      qc.setQueryData<JsonObject[]>(["availability", weekStartStr], (old) => {
        const next = [...(old ?? [])];
        next.push({
          id: -Date.now(),
          employee_id: employeeId,
          avail_date: ymd,
          start_time: null,
          end_time: null,
        });
        return next;
      });
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(["availability", weekStartStr], ctx.previous);
      }
      alert(errorMessageFromUnknown(err));
    },
    onSuccess: (data, { employeeId, ymd }) => {
      qc.setQueryData<JsonObject[]>(["availability", weekStartStr], (old) => {
        const rows = [...(old ?? [])];
        const rid = Number(data.id);
        const idx = rows.findIndex(
          (r) =>
            Number(r.id) < 0 &&
            Number(r.employee_id) === employeeId &&
            String(r.avail_date) === ymd,
        );
        if (idx >= 0 && Number.isFinite(rid)) {
          rows[idx] = {
            ...rows[idx],
            id: rid,
            employee_id: Number(data.employee_id ?? employeeId),
            avail_date: String(data.avail_date ?? ymd),
            start_time: null,
            end_time: null,
          };
        }
        return rows;
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["availability", weekStartStr] });
    },
  });

  const deleteMut = useMutation<JsonObject, Error, AvailVars, AvailCtx>({
    mutationFn: ({ employeeId, ymd }) => api.deleteAvailabilityForEmployeeDay(employeeId, ymd),
    onMutate: async ({ employeeId, ymd }) => {
      await qc.cancelQueries({ queryKey: ["availability", weekStartStr] });
      const previous = qc.getQueryData<JsonObject[]>(["availability", weekStartStr]);
      qc.setQueryData<JsonObject[]>(["availability", weekStartStr], (old) =>
        (old ?? []).filter(
          (r) =>
            !(Number(r.employee_id) === employeeId && String(r.avail_date ?? "") === ymd),
        ),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(["availability", weekStartStr], ctx.previous);
      }
      alert(errorMessageFromUnknown(err));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["availability", weekStartStr] });
    },
  });

  function isCellPending(employeeId: number, ymd: string): boolean {
    const cv = createMut.variables;
    if (createMut.isPending && cv?.employeeId === employeeId && cv?.ymd === ymd) return true;
    const dv = deleteMut.variables;
    if (deleteMut.isPending && dv?.employeeId === employeeId && dv?.ymd === ymd) return true;
    return false;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-row gap-0">
        {visibleDayOffsets.map((offset, colIdx) => {
          const dayDate = addDays(weeklyWeekStart, offset);
          const ymd = formatYmd(dayDate);
          const dow = dayDate.getDay();
          return (
            <div
              key={ymd}
              className={`flex min-w-0 flex-1 basis-0 flex-col overflow-hidden border-s border-line bg-surface/40 ${
                colIdx === 0 ? "border-s-0" : ""
              }`}
            >
              <div className="shrink-0 border-b border-line bg-surface px-1 py-1.5 text-center font-heading text-[10px] font-bold leading-tight text-ink sm:text-xs">
                <span dir="rtl">
                  {DAYS_HE[dow]}, {formatDmSlashed(dayDate)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5 px-0.5 py-1">
                {sortedRegularEmployees.map((emp) => {
                  const eid = Number(emp.id);
                  const name = String(emp.name ?? "");
                  const k = availabilityMapKey(ymd, eid);
                  const rows = byKey.get(k) ?? [];
                  const hasAny = rows.length > 0;
                  const kind = stripKind(rows);
                  const roleHex = String(emp.role_color ?? DEFAULT_ROLE_HEX).trim() || DEFAULT_ROLE_HEX;

                  const cellPending = isCellPending(eid, ymd);

                  const onRowClick = () => {
                    if (createMut.isPending || deleteMut.isPending) return;
                    if (hasAny) {
                      void deleteMut.mutateAsync({ employeeId: eid, ymd });
                    } else {
                      void createMut.mutateAsync({ employeeId: eid, ymd });
                    }
                  };

                  return (
                    <button
                      key={eid}
                      type="button"
                      disabled={cellPending}
                      onClick={onRowClick}
                      className={`flex w-full min-w-0 min-h-[28px] max-w-full items-center gap-0.5 rounded-sm border px-0.5 py-0.5 text-start transition-colors ${
                        cellPending ? "cursor-wait opacity-80" : ""
                      } ${
                        hasAny
                          ? "border-green-300/80 bg-green-100/55 hover:bg-green-100/80"
                          : "border-red-200/90 bg-red-100/45 hover:bg-red-100/70"
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                        <span
                          className="size-2 shrink-0 rounded-full ring-1 ring-black/10"
                          style={{ backgroundColor: roleHex }}
                          aria-hidden
                        />
                        <span className="min-w-0 truncate font-heading text-xs font-bold text-ink sm:text-sm" title={name}>
                          {name}
                        </span>
                      </span>
                      <span className="ms-auto flex min-w-0 max-w-[42%] shrink-0 items-center justify-end gap-0.5 font-heading font-semibold text-ink/90">
                        {kind === "none" ? (
                          <SmallXIcon className="shrink-0 text-red-700/80" aria-label="אין זמינות" />
                        ) : null}
                        {kind === "whole" ? (
                          <span className="truncate text-end text-[10px] text-green-900 sm:text-[11px]">כל היום</span>
                        ) : null}
                        {kind === "timed" ? (
                          <span
                            className="truncate text-end tabular-nums text-[10px] text-green-900 sm:text-[11px]"
                            dir="ltr"
                            title={timedRangeLabel(rows)}
                          >
                            {timedRangeLabel(rows)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
