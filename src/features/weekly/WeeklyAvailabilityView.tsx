import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { TimeInput24 } from "../../shared/TimeInput24";
import { formatTimeForInput } from "../../shared/timeFormat";
import {
  activeDayIndices,
  clampActiveDaysMask,
  DEFAULT_ACTIVE_DAYS_MASK,
} from "../../shared/weeklyActiveDays";

const DEFAULT_ROLE_HEX = "#64748b";

type ExtraReserveDraft = {
  query: string;
  employeeId: number | null;
  start: string;
  end: string;
};

function emptyExtraReserveDraft(): ExtraReserveDraft {
  return { query: "", employeeId: null, start: "", end: "" };
}

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

function SmallCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "h-3 w-3 shrink-0"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ExtraReserveComposerRow({
  draft,
  onChangeDraft,
  extraReserveEmployees,
  disabled,
  onSubmit,
}: {
  draft: ExtraReserveDraft;
  onChangeDraft: (patch: Partial<ExtraReserveDraft>) => void;
  extraReserveEmployees: JsonObject[];
  disabled: boolean;
  onSubmit: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = draft.query.trim();
    if (!q) return [];
    return extraReserveEmployees.filter((e) => String(e.name ?? "").includes(q));
  }, [draft.query, extraReserveEmployees]);

  const onBlurName = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const root = rootRef.current;
        if (root?.contains(document.activeElement)) return;
      });
    });
  }, []);

  const commitPick = useCallback(
    (employeeId: number) => {
      const emp = extraReserveEmployees.find((e) => Number(e.id) === employeeId);
      onChangeDraft({
        employeeId,
        query: emp ? String(emp.name ?? "") : "",
      });
    },
    [extraReserveEmployees, onChangeDraft],
  );

  return (
    <div ref={rootRef} dir="rtl" className="flex min-h-5 items-center gap-0.5">
      <div className="relative min-w-0 flex-1">
        <input
          type="text"
          dir="rtl"
          autoComplete="off"
          disabled={disabled}
          value={draft.query}
          onChange={(e) => {
            onChangeDraft({ query: e.target.value, employeeId: null });
          }}
          onBlur={onBlurName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const first = filtered[0];
              if (first) commitPick(Number(first.id));
              return;
            }
          }}
          className="wk-avail-composer-name max-w-full"
          placeholder="מפעיל"
          aria-autocomplete="list"
          aria-expanded={filtered.length > 0}
        />
        {filtered.length > 0 ? (
          <ul
            className="absolute start-0 bottom-full z-30 mb-0.5 max-h-36 min-w-full overflow-y-auto rounded-md border border-line bg-surface py-0.5 shadow-airy"
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
      <TimeInput24
        dir="ltr"
        disabled={disabled}
        value={formatTimeForInput(draft.end)}
        onChange={(v) => onChangeDraft({ end: v })}
        allowEmpty
        className="wk-avail-composer-time"
        aria-label="שעת סיום"
      />
      <span className="shrink-0 translate-y-px text-[9px] font-semibold leading-5 text-ink/70" aria-hidden>
        -
      </span>
      <TimeInput24
        dir="ltr"
        disabled={disabled}
        value={formatTimeForInput(draft.start)}
        onChange={(v) => onChangeDraft({ start: v })}
        allowEmpty
        className="wk-avail-composer-time"
        aria-label="שעת התחלה"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={onSubmit}
        className="flex size-5 shrink-0 items-center justify-center rounded border border-green-600/50 bg-green-100/70 text-green-900 transition hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="הוסף זמינות"
      >
        <SmallCheckIcon />
      </button>
    </div>
  );
}

export function WeeklyAvailabilityView() {
  const weeklyWeekStart = useAppStore((s) => s.weeklyWeekStart);
  const weekStartStr = formatYmd(weeklyWeekStart);
  const qc = useQueryClient();

  const [extraReserveDrafts, setExtraReserveDrafts] = useState<
    Record<string, ExtraReserveDraft>
  >({});

  useEffect(() => {
    setExtraReserveDrafts({});
  }, [weekStartStr]);

  const updateExtraReserveDraft = useCallback((ymd: string, patch: Partial<ExtraReserveDraft>) => {
    setExtraReserveDrafts((prev) => {
      const cur = prev[ymd] ?? emptyExtraReserveDraft();
      return { ...prev, [ymd]: { ...cur, ...patch } };
    });
  }, []);

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

  const extraReserveEmployees = useMemo(
    () =>
      employees.filter((e) => {
        const k = parseEmployeeKind(e.employee_type);
        return k === "extra" || k === "reserve";
      }),
    [employees],
  );

  const employeeKindById = useMemo(() => {
    const m = new Map<number, ReturnType<typeof parseEmployeeKind>>();
    for (const e of employees) {
      const id = Number(e.id);
      if (!id) continue;
      m.set(id, parseEmployeeKind(e.employee_type));
    }
    return m;
  }, [employees]);

  const employeeNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of employees) {
      const id = Number(e.id);
      if (!id) continue;
      m.set(id, String(e.name ?? ""));
    }
    return m;
  }, [employees]);

  const { data: availabilityRaw = [] } = useQuery({
    queryKey: ["availability", weekStartStr],
    queryFn: () => api.listAvailabilityForWeek(weekStartStr),
  });
  const availabilityRows = useMemo(
    () => availabilityRaw as JsonObject[],
    [availabilityRaw],
  );

  const timedExtraReserveByYmd = useMemo(() => {
    const m = new Map<string, JsonObject[]>();
    for (const r of availabilityRows) {
      if (isWholeDayRow(r)) continue;
      const ymd = String(r.avail_date ?? "").trim();
      const eid = Number(r.employee_id ?? 0);
      if (!ymd || !eid) continue;
      const kind = employeeKindById.get(eid);
      if (kind !== "extra" && kind !== "reserve") continue;
      if (!m.has(ymd)) m.set(ymd, []);
      m.get(ymd)!.push(r);
    }
    for (const arr of m.values()) {
      arr.sort(
        (a, b) =>
          String(a.start_time ?? "").localeCompare(String(b.start_time ?? "")) ||
          Number(a.employee_id ?? 0) - Number(b.employee_id ?? 0) ||
          Number(a.id ?? 0) - Number(b.id ?? 0),
      );
    }
    return m;
  }, [availabilityRows, employeeKindById]);

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
    const map = new Map<string, JsonObject[]>();
    for (const r of availabilityRows) {
      const ymd = String(r.avail_date ?? "");
      const eid = Number(r.employee_id ?? 0);
      if (!ymd || !eid) continue;
      const k = availabilityMapKey(ymd, eid);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return map;
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

  type TimedCreateVars = {
    employeeId: number;
    ymd: string;
    start: string;
    end: string;
  };
  type TimedCreateCtx = { previous: JsonObject[] | undefined; tempId: number };

  const createTimedMut = useMutation<JsonObject, Error, TimedCreateVars, TimedCreateCtx>({
    mutationFn: ({ employeeId, ymd, start, end }) =>
      api.createAvailabilityTimed(employeeId, ymd, start, end),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["availability", weekStartStr] });
      const previous = qc.getQueryData<JsonObject[]>(["availability", weekStartStr]);
      const tempId = -Date.now();
      qc.setQueryData<JsonObject[]>(["availability", weekStartStr], (old) => {
        const next = [...(old ?? [])];
        next.push({
          id: tempId,
          employee_id: vars.employeeId,
          avail_date: vars.ymd,
          start_time: vars.start,
          end_time: vars.end,
        });
        return next;
      });
      return { previous, tempId };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(["availability", weekStartStr], ctx.previous);
      }
      alert(errorMessageFromUnknown(err));
    },
    onSuccess: (data, vars, ctx) => {
      const tempId = ctx?.tempId;
      if (tempId == null) return;
      qc.setQueryData<JsonObject[]>(["availability", weekStartStr], (old) => {
        const rows = [...(old ?? [])];
        const rid = Number(data.id);
        const idx = rows.findIndex(
          (r) =>
            Number(r.id) === tempId &&
            Number(r.employee_id) === vars.employeeId &&
            String(r.avail_date) === vars.ymd,
        );
        if (idx >= 0 && Number.isFinite(rid)) {
          rows[idx] = { ...(data as JsonObject), id: rid };
        }
        return rows;
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["availability", weekStartStr] });
    },
  });

  type DeleteIdCtx = { previous: JsonObject[] | undefined };

  const deleteTimedMut = useMutation<JsonObject, Error, number, DeleteIdCtx>({
    mutationFn: (id) => api.deleteAvailabilityById(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["availability", weekStartStr] });
      const previous = qc.getQueryData<JsonObject[]>(["availability", weekStartStr]);
      qc.setQueryData<JsonObject[]>(["availability", weekStartStr], (old) =>
        (old ?? []).filter((r) => Number(r.id) !== id),
      );
      return { previous };
    },
    onError: (err, _id, ctx) => {
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

  function isTimedRowPending(rowId: number): boolean {
    return deleteTimedMut.isPending && deleteTimedMut.variables === rowId;
  }

  function submitExtraReserve(ymd: string): void {
    const d = extraReserveDrafts[ymd] ?? emptyExtraReserveDraft();
    if (d.employeeId == null) {
      alert("בחר מפעיל");
      return;
    }
    const startHm = formatTimeForInput(d.start);
    const endHm = formatTimeForInput(d.end);
    if (!startHm || !endHm) {
      alert("הזן שעת התחלה ושעת סיום");
      return;
    }
    void createTimedMut
      .mutateAsync({
        employeeId: d.employeeId,
        ymd,
        start: startHm,
        end: endHm,
      })
      .then(() => {
        setExtraReserveDrafts((prev) => ({ ...prev, [ymd]: emptyExtraReserveDraft() }));
      });
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-row gap-0">
        {visibleDayOffsets.map((offset, colIdx) => {
          const dayDate = addDays(weeklyWeekStart, offset);
          const ymd = formatYmd(dayDate);
          const dow = dayDate.getDay();
          const timedExtraRows = timedExtraReserveByYmd.get(ymd) ?? [];
          const draft = extraReserveDrafts[ymd] ?? emptyExtraReserveDraft();
          const composerPending =
            createTimedMut.isPending && createTimedMut.variables?.ymd === ymd;

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
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-0.5 py-1">
                  <div className="flex flex-col gap-0.5">
                    {sortedRegularEmployees.map((emp) => {
                      const eid = Number(emp.id);
                      const name = String(emp.name ?? "");
                      const k = availabilityMapKey(ymd, eid);
                      const rows = byKey.get(k) ?? [];
                      const hasAny = rows.length > 0;
                      const kind = stripKind(rows);
                      const roleHex =
                        String(emp.role_color ?? DEFAULT_ROLE_HEX).trim() || DEFAULT_ROLE_HEX;

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
                            <span
                              className="min-w-0 truncate font-heading text-xs font-bold text-ink sm:text-sm"
                              title={name}
                            >
                              {name}
                            </span>
                          </span>
                          <span className="ms-auto flex min-w-0 max-w-[42%] shrink-0 items-center justify-end gap-0.5 font-heading font-semibold text-ink/90">
                            {kind === "none" ? (
                              <SmallXIcon className="shrink-0 text-red-700/80" aria-label="אין זמינות" />
                            ) : null}
                            {kind === "whole" ? (
                              <span className="truncate text-end text-[10px] text-green-900 sm:text-[11px]">
                                כל היום
                              </span>
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
                <div className="shrink-0 border-t border-line bg-surface/40 px-0.5 pb-1 pt-0.5">
                  <div className="flex flex-col gap-0.5">
                    {timedExtraRows.map((r) => {
                      const rid = Number(r.id);
                      const eid = Number(r.employee_id ?? 0);
                      const name = employeeNameById.get(eid) ?? "—";
                      const roleHex =
                        String(
                          employees.find((e) => Number(e.id) === eid)?.role_color ??
                            DEFAULT_ROLE_HEX,
                        ).trim() || DEFAULT_ROLE_HEX;
                      const pending = isTimedRowPending(rid);

                      return (
                        <div
                          key={rid}
                          className={`flex min-h-[28px] w-full min-w-0 items-center gap-0.5 rounded-sm border border-green-300/80 bg-green-100/55 px-0.5 py-0.5 ${
                            pending ? "opacity-70" : ""
                          }`}
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                            <span
                              className="size-2 shrink-0 rounded-full ring-1 ring-black/10"
                              style={{ backgroundColor: roleHex }}
                              aria-hidden
                            />
                            <span
                              className="min-w-0 truncate font-heading text-xs font-bold text-green-950 sm:text-sm"
                              title={name}
                            >
                              {name}
                            </span>
                          </span>
                          <span
                            className="ms-auto shrink-0 tabular-nums font-heading text-[10px] font-semibold text-green-900 sm:text-[11px]"
                            dir="ltr"
                          >
                            {String(r.start_time)}–{String(r.end_time)}
                          </span>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              void deleteTimedMut.mutateAsync(rid);
                            }}
                            className="shrink-0 rounded p-0.5 text-green-900/80 transition hover:bg-green-200/60 disabled:cursor-not-allowed"
                            aria-label="מחק זמינות"
                          >
                            <SmallXIcon className="size-3.5" />
                          </button>
                        </div>
                      );
                    })}
                    <ExtraReserveComposerRow
                      draft={draft}
                      onChangeDraft={(patch) => updateExtraReserveDraft(ymd, patch)}
                      extraReserveEmployees={extraReserveEmployees}
                      disabled={composerPending}
                      onSubmit={() => submitExtraReserve(ymd)}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
