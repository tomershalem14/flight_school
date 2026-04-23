import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JsonObject } from "../../shared/api";
import * as api from "../../shared/api";
import { errorMessageFromUnknown } from "../../shared/errorMessage";
import { addDays, DAYS_HE, formatDmSlashed, formatYmd } from "../../shared/dates";
import { parseSlotPresetIdsFromWindow } from "../../shared/manningHours";
import { useAppStore } from "../../app/store";
import {
  activeDayIndices,
  clampActiveDaysMask,
  DEFAULT_ACTIVE_DAYS_MASK,
} from "../../shared/weeklyActiveDays";
import {
  DeleteShiftTypeConfirmDialog,
  ShiftTypeEditorModal,
} from "../schedule/components/ShiftTypeModals";
import {
  newShiftTypeDraft,
  shiftTypeDraftFromWindow,
  typeId,
} from "../schedule/helpers/scheduleShiftModel";

const DEFAULT_WINDOW_HEX = "#6366F1";

function SmallChevronIcon({ className, expanded }: { className?: string; expanded: boolean }) {
  return (
    <svg
      className={`${className ?? ""} shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function aggregatePresetCounts(
  w: JsonObject,
  presetNameById: Map<number, string>,
): { presetId: number; count: number; label: string }[] {
  const slots = parseSlotPresetIdsFromWindow(w);
  const counts = new Map<number, number>();
  for (const pid of slots) {
    if (!Number.isFinite(pid)) continue;
    counts.set(pid, (counts.get(pid) ?? 0) + 1);
  }
  const rows: { presetId: number; count: number; label: string }[] = [];
  for (const [presetId, count] of counts) {
    const name = presetNameById.get(presetId)?.trim();
    rows.push({
      presetId,
      count,
      label: name && name.length > 0 ? name : `#${presetId}`,
    });
  }
  rows.sort((a, b) => a.label.localeCompare(b.label, "he"));
  return rows;
}

export function WeeklyResourcesColumnsPage() {
  const weeklyWeekStart = useAppStore((s) => s.weeklyWeekStart);
  const weekStartStr = formatYmd(weeklyWeekStart);
  const qc = useQueryClient();

  const { data: weeklySettingsRow } = useQuery({
    queryKey: ["weekly_settings", weekStartStr],
    queryFn: () => api.getWeeklySettings(weekStartStr),
  });
  const activeDaysMask = useMemo(() => {
    const row = weeklySettingsRow as JsonObject | null | undefined;
    if (row == null) return DEFAULT_ACTIVE_DAYS_MASK;
    return clampActiveDaysMask(Number(row.active_days_mask ?? DEFAULT_ACTIVE_DAYS_MASK));
  }, [weeklySettingsRow]);

  const visibleDayOffsets = useMemo(() => activeDayIndices(activeDaysMask), [activeDaysMask]);

  const visibleYmds = useMemo(
    () => visibleDayOffsets.map((offset) => formatYmd(addDays(weeklyWeekStart, offset))),
    [visibleDayOffsets, weeklyWeekStart],
  );

  const { data: presetsRaw = [] } = useQuery({
    queryKey: ["syllabus_presets"],
    queryFn: () => api.getSyllabusPresets(),
  });
  const presets = useMemo(() => presetsRaw as JsonObject[], [presetsRaw]);

  const presetNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of presets) {
      m.set(Number(p.id), String(p.name ?? ""));
    }
    return m;
  }, [presets]);

  const shiftWindowQueries = useQueries({
    queries: visibleYmds.map((ymd) => ({
      queryKey: ["shift_windows", ymd],
      queryFn: () => api.getShiftWindows(ymd),
    })),
  });

  const windowsByYmd = useMemo(() => {
    const m = new Map<string, JsonObject[]>();
    visibleYmds.forEach((ymd, i) => {
      const raw = shiftWindowQueries[i]?.data as JsonObject[] | undefined;
      const list = (raw ?? []).slice().sort((a, b) => typeId(a) - typeId(b));
      m.set(ymd, list);
    });
    return m;
  }, [visibleYmds, shiftWindowQueries]);

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const toggleExpanded = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const [shiftTypeDraft, setShiftTypeDraft] = useState<JsonObject | null>(null);
  const [shiftModalDateStr, setShiftModalDateStr] = useState<string | null>(null);
  const [deleteTypeConfirm, setDeleteTypeConfirm] = useState<{ id: number; name: string } | null>(
    null,
  );
  const [swatchMenuOpen, setSwatchMenuOpen] = useState(false);
  const [shiftTypeTimeError, setShiftTypeTimeError] = useState<string | null>(null);
  const shiftTypeModalBodyRef = useRef<HTMLDivElement>(null);

  const deleteShiftWindowMut = useMutation({
    mutationFn: (id: number) => api.deleteShiftWindow(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shift_windows"] });
      void qc.invalidateQueries({ queryKey: ["shifts"] });
      void qc.invalidateQueries({ queryKey: ["violations"] });
      setDeleteTypeConfirm(null);
    },
    onError: (err) => {
      alert(errorMessageFromUnknown(err));
    },
  });

  const createShiftWindowMut = useMutation({
    mutationFn: (payload: JsonObject) => api.createShiftWindow(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shift_windows"] });
      void qc.invalidateQueries({ queryKey: ["shifts"] });
      void qc.invalidateQueries({ queryKey: ["violations"] });
      setShiftTypeDraft(null);
      setShiftModalDateStr(null);
    },
    onError: (err) => {
      alert(errorMessageFromUnknown(err));
    },
  });

  const updateShiftWindowMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: JsonObject }) =>
      api.updateShiftWindow(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shift_windows"] });
      void qc.invalidateQueries({ queryKey: ["shifts"] });
      void qc.invalidateQueries({ queryKey: ["violations"] });
      setShiftTypeDraft(null);
      setShiftModalDateStr(null);
    },
    onError: (err) => {
      alert(errorMessageFromUnknown(err));
    },
  });

  const openEditShiftTypeModal = useCallback(
    (ty: JsonObject, ymd: string) => {
      createShiftWindowMut.reset();
      updateShiftWindowMut.reset();
      setShiftTypeTimeError(null);
      setSwatchMenuOpen(false);
      setShiftModalDateStr(ymd);
      setShiftTypeDraft(shiftTypeDraftFromWindow(ty, presets));
    },
    [createShiftWindowMut, presets, updateShiftWindowMut],
  );

  const openCreateShiftTypeModal = useCallback(
    (ymd: string) => {
      createShiftWindowMut.reset();
      updateShiftWindowMut.reset();
      setShiftTypeTimeError(null);
      setSwatchMenuOpen(false);
      setShiftModalDateStr(ymd);
      setShiftTypeDraft(newShiftTypeDraft(presets));
    },
    [createShiftWindowMut, presets, updateShiftWindowMut],
  );

  useEffect(() => {
    if (!shiftTypeDraft) setSwatchMenuOpen(false);
  }, [shiftTypeDraft]);

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
      setShiftModalDateStr(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteTypeConfirm, shiftTypeDraft, swatchMenuOpen]);

  const modalDateStr = shiftModalDateStr ?? visibleYmds[0] ?? formatYmd(weeklyWeekStart);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-row gap-0">
        {visibleDayOffsets.map((offset, colIdx) => {
          const dayDate = addDays(weeklyWeekStart, offset);
          const ymd = formatYmd(dayDate);
          const dow = dayDate.getDay();
          const windows = windowsByYmd.get(ymd) ?? [];

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
                  <div className="flex flex-col gap-0.5" dir="rtl">
                    {windows.map((w) => {
                      const wid = typeId(w);
                      const rowKey = `${ymd}:${wid}`;
                      const expanded = expandedKeys.has(rowKey);
                      const name = String(w.name ?? "");
                      const col =
                        String(w.color ?? DEFAULT_WINDOW_HEX).trim() || DEFAULT_WINDOW_HEX;
                      const agg = aggregatePresetCounts(w, presetNameById);
                      const slotsEmpty = parseSlotPresetIdsFromWindow(w).length === 0;

                      return (
                        <div key={wid} className="flex min-w-0 flex-col gap-0">
                          <div className="group flex min-w-0 items-stretch gap-1">
                            <button
                              type="button"
                              className="flex min-h-[28px] min-w-0 flex-1 items-center gap-0.5 rounded-sm border border-line bg-background px-0.5 py-0.5 text-start transition-colors hover:border-primary/40 hover:bg-primary/5"
                              onClick={() => toggleExpanded(rowKey)}
                              aria-expanded={expanded}
                            >
                              <SmallChevronIcon expanded={expanded} className="text-muted" />
                              <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                                <span
                                  className="size-2 shrink-0 rounded-full ring-1 ring-black/10"
                                  style={{ backgroundColor: col }}
                                  aria-hidden
                                />
                                <span
                                  className="min-w-0 flex-1 truncate font-heading text-xs font-bold text-ink sm:text-sm"
                                  title={name}
                                >
                                  {name}
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center self-center rounded border border-line bg-background text-muted opacity-0 transition-opacity hover:border-primary/40 hover:bg-background hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
                              aria-label={`עריכת חלון ${name || ""}`}
                              title="עריכת חלון"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditShiftTypeModal(w, ymd);
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
                          {expanded ? (
                            <div className="me-1 ms-6 border-s-2 border-line/80 ps-2 pe-1 pb-1 pt-0.5 text-xs text-ink">
                              {slotsEmpty ? (
                                <p className="text-muted">אין סילבוסים</p>
                              ) : (
                                <ul className="space-y-0.5">
                                  {agg.map((row) => (
                                    <li key={row.presetId} className="font-heading tabular-nums">
                                      <span dir="rtl">
                                        {row.count} × {row.label}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="flex min-h-[28px] w-full items-center justify-center gap-1 rounded-sm border border-dashed border-line bg-background/60 px-1 py-0.5 font-heading text-xs font-bold text-primary hover:bg-primary/10 sm:text-sm"
                      onClick={() => openCreateShiftTypeModal(ymd)}
                    >
                      + הוסף חלון
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {shiftTypeDraft ? (
        <ShiftTypeEditorModal
          shiftTypeDraft={shiftTypeDraft}
          setShiftTypeDraft={setShiftTypeDraft}
          presets={presets}
          dateStr={modalDateStr}
          shiftTypeModalBodyRef={shiftTypeModalBodyRef}
          swatchMenuOpen={swatchMenuOpen}
          setSwatchMenuOpen={setSwatchMenuOpen}
          shiftTypeTimeError={shiftTypeTimeError}
          setShiftTypeTimeError={setShiftTypeTimeError}
          createShiftWindowMut={createShiftWindowMut}
          updateShiftWindowMut={updateShiftWindowMut}
          onClose={() => {
            setShiftTypeDraft(null);
            setShiftModalDateStr(null);
          }}
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
