import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";
import type { JsonObject } from "../../shared/api";
import * as api from "../../shared/api";
import {
  activePresetIdFromList,
  parseEmployeeKind,
  sortEmployeesByActivePreset,
} from "../../shared/employeeOrderSort";
import { errorMessageFromUnknown } from "../../shared/errorMessage";
import { formatYmd } from "../../shared/dates";
import { useAppStore } from "../../app/store";
import {
  clampActiveDaysMask,
  countAvailabilityOnActiveDays,
  DEFAULT_ACTIVE_DAYS_MASK,
  DEFAULT_DAYS_IN_SCHOOL,
  HEBREW_DAY_SEGMENTS,
  isDayActive,
  toggleDay,
} from "../../shared/weeklyActiveDays";

function clampDays(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_DAYS_IN_SCHOOL;
  return Math.max(0, Math.min(7, Math.round(n)));
}

function PersonWarningCard({
  employeeName,
  body,
}: {
  employeeName: string;
  body: string;
}) {
  const shell = "border-2 border-amber-400 bg-amber-100 shadow-sm";
  const bodyTone = "text-amber-900";
  return (
    <article className={`shrink-0 overflow-hidden rounded-lg text-right ${shell}`} dir="rtl">
      <div className="border-b border-black/10 bg-black/10 px-2.5 py-1.5 text-xs leading-snug text-ink">
        <span className="font-medium">{employeeName}</span>
      </div>
      <div className={`px-2.5 py-1.5 text-xs leading-snug ${bodyTone}`}>{body}</div>
    </article>
  );
}

export function WeeklyPeopleInspectorPanel() {
  const daysFieldId = useId();
  const weeklyWeekStart = useAppStore((s) => s.weeklyWeekStart);
  const weekStartStr = formatYmd(weeklyWeekStart);
  const qc = useQueryClient();

  const { data: settingsRow } = useQuery({
    queryKey: ["weekly_settings", weekStartStr],
    queryFn: () => api.getWeeklySettings(weekStartStr),
  });

  const [draftDays, setDraftDays] = useState(DEFAULT_DAYS_IN_SCHOOL);
  const [draftMask, setDraftMask] = useState(DEFAULT_ACTIVE_DAYS_MASK);

  useEffect(() => {
    const row = settingsRow as JsonObject | null | undefined;
    if (row == null) {
      setDraftDays(DEFAULT_DAYS_IN_SCHOOL);
      setDraftMask(DEFAULT_ACTIVE_DAYS_MASK);
    } else {
      setDraftDays(clampDays(Number(row.days_in_school ?? DEFAULT_DAYS_IN_SCHOOL)));
      setDraftMask(clampActiveDaysMask(Number(row.active_days_mask ?? DEFAULT_ACTIVE_DAYS_MASK)));
    }
  }, [settingsRow, weekStartStr]);

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

  const savedMask = useMemo(() => {
    const row = settingsRow as JsonObject | null | undefined;
    if (row == null) return DEFAULT_ACTIVE_DAYS_MASK;
    return clampActiveDaysMask(Number(row.active_days_mask ?? DEFAULT_ACTIVE_DAYS_MASK));
  }, [settingsRow]);

  const requiredDays = useMemo(() => {
    const row = settingsRow as JsonObject | null | undefined;
    if (row == null) return DEFAULT_DAYS_IN_SCHOOL;
    return clampDays(Number(row.days_in_school ?? DEFAULT_DAYS_IN_SCHOOL));
  }, [settingsRow]);

  const activeDayCounts = useMemo(
    () => countAvailabilityOnActiveDays(availabilityRows, savedMask, weekStartStr),
    [availabilityRows, savedMask, weekStartStr],
  );

  const staffingWarnings = useMemo(() => {
    const out: { emp: JsonObject; kind: "under" | "over"; x: number; y: number }[] = [];
    const y = requiredDays;
    for (const emp of sortedRegularEmployees) {
      const eid = Number(emp.id);
      const x = activeDayCounts.get(eid) ?? 0;
      if (x < y) out.push({ emp, kind: "under", x, y });
      else if (x > y) out.push({ emp, kind: "over", x, y });
    }
    return out;
  }, [sortedRegularEmployees, activeDayCounts, requiredDays]);

  const saveMut = useMutation({
    mutationFn: () =>
      api.saveWeeklySettings(weekStartStr, {
        daysInSchool: clampDays(draftDays),
        activeDaysMask: clampActiveDaysMask(draftMask),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["weekly_settings", weekStartStr] });
    },
    onError: (err) => {
      alert(errorMessageFromUnknown(err));
    },
  });

  const onSave = () => {
    saveMut.mutate();
  };

  return (
    <div className="flex flex-col gap-3 p-3 pb-4" dir="rtl">
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        <label
          htmlFor={daysFieldId}
          className="block w-full text-sm font-semibold text-ink"
        >
          ימים בבית הספר:
        </label>
        <div className="flex w-full min-w-0 max-w-none overflow-hidden rounded-pill border border-line bg-surface shadow-sm">
          <div className="relative min-w-0 flex-1">
            <input
              id={daysFieldId}
              type="number"
              min={0}
              max={7}
              step={1}
              className="h-full w-full min-w-0 border-0 bg-transparent py-2.5 ps-3 pe-2 text-center font-heading text-sm font-semibold tabular-nums text-ink outline-none ring-0 [-moz-appearance:textfield] focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              value={draftDays}
              onChange={(e) => setDraftDays(clampDays(Number(e.target.value)))}
            />
          </div>
          <button
            type="button"
            className="flex shrink-0 cursor-pointer items-center border-s border-line bg-surface px-3 py-2.5 text-sm font-heading font-bold text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={saveMut.isPending}
            onClick={onSave}
          >
            שמור
          </button>
        </div>
      </div>

      <div className="flex w-full min-w-0 flex-col gap-1.5">
        <span className="block w-full text-sm font-semibold text-ink">ימים פעילים:</span>
        <div className="flex w-full min-w-0 overflow-hidden rounded-pill border border-line bg-surface shadow-sm">
          {([0, 1, 2, 3, 4, 5, 6] as const).map((d) => {
            const on = isDayActive(draftMask, d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                className={`flex min-w-0 flex-1 items-center justify-center border-s border-line py-2 text-sm font-heading font-bold transition-colors first:border-s-0 ${
                  on
                    ? "bg-primary/20 text-ink"
                    : "bg-background/90 text-muted hover:bg-background"
                }`}
                onClick={() => setDraftMask((m) => toggleDay(m, d))}
              >
                {HEBREW_DAY_SEGMENTS[d]}
              </button>
            );
          })}
        </div>
      </div>

      <hr className="border-0 border-t border-line" />

      <div className="flex flex-col gap-2">
        {staffingWarnings.length === 0 ? (
          <p className="shrink-0 text-xs text-muted">אין התראות לפי ההגדרה הנוכחית</p>
        ) : (
          staffingWarnings.map(({ emp, kind, x, y }) => {
            const name = String(emp.name ?? "");
            const body =
              kind === "under"
                ? `לא מאויש למספיק ימים, ${x} כאשר נדרש ${y}`
                : `מאויש ליותר מדי ימים, ${x} כאשר נדרש ${y}`;
            return <PersonWarningCard key={Number(emp.id)} employeeName={name} body={body} />;
          })
        )}
      </div>
    </div>
  );
}
