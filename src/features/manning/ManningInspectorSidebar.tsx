import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useEffect, useId, useState } from "react";
import { useAppStore, weekStartString } from "../../app/store";
import * as api from "../../shared/api";
import type { JsonObject } from "../../shared/api";
import { formatYmd } from "../../shared/dates";
import { errorMessageFromUnknown } from "../../shared/errorMessage";
import { buildManningDayWorkbookBytes } from "./manningExportXlsx";

function jsonString(v: JsonObject, key: string): string | undefined {
  const x = v[key];
  return typeof x === "string" && x.length > 0 ? x : undefined;
}

function jsonNumber(v: JsonObject, key: string): number | undefined {
  const x = v[key];
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function jsonStringArray(v: JsonObject, key: string): string[] {
  const x = v[key];
  if (!Array.isArray(x)) return [];
  return x.filter((item): item is string => typeof item === "string");
}

function ViolationCard({ v }: { v: JsonObject }) {
  const rule = typeof v.rule === "string" ? v.rule : "";
  const message = typeof v.message === "string" ? v.message : "";

  const isCalendarOverlap = rule === "calendar_overlap";
  const isShiftOutsideAvail = rule === "global_shift_outside_availability";
  const isEventOutsideAvail = rule === "global_event_outside_availability";
  const isObsOutsideAvail = rule === "global_observation_outside_availability";
  const isRedOverlap =
    isCalendarOverlap ||
    isShiftOutsideAvail ||
    isEventOutsideAvail ||
    isObsOutsideAvail;
  const isMaxRow = rule === "max_in_row_bunch";
  const isSyllabus = rule === "syllabus_role_level";
  const isGlobalWeekRule =
    rule === "global_week_late_days" ||
    rule === "global_week_early_days" ||
    rule === "global_week_extreme_days";

  const shell = isRedOverlap
    ? "border-2 border-red-400 bg-red-100 shadow-sm"
    : "border-2 border-amber-400 bg-amber-100 shadow-sm";

  const bodyTone = isRedOverlap ? "text-red-900" : "text-amber-900";

  const emp = jsonString(v, "display_employee");
  const times = jsonStringArray(v, "display_shift_times");
  const hasStructuredHeader =
    Boolean(emp) && (times.length > 0 || isGlobalWeekRule);

  const bunchX = jsonNumber(v, "bunch_count");
  const bunchY = jsonNumber(v, "bunch_cap");
  const roleX = jsonNumber(v, "employee_role_level");
  const roleY = jsonNumber(v, "required_role_level");
  const roleNameEmp = jsonString(v, "employee_role_name");
  const roleNameReq = jsonString(v, "required_role_name");

  let body: string;
  if (isCalendarOverlap) {
    body = message || "התנגשות בזמנים ביומן";
  } else if (isShiftOutsideAvail || isEventOutsideAvail || isObsOutsideAvail) {
    body = message || "מחוץ לזמינות";
  } else if (isMaxRow && bunchX !== undefined && bunchY !== undefined) {
    body = `יותר מדי משמרות ברצף, ישנן ${bunchX} כאשר מותרות עד ${bunchY}`;
  } else if (isSyllabus && roleNameEmp && roleNameReq) {
    body = `אי עמידה בדרג מינימלי, ${roleNameEmp} כאשר נדרש ${roleNameReq}`;
  } else if (isSyllabus && roleX !== undefined && roleY !== undefined) {
    body = `אי עמידה בדרג מינימלי, דרג ${roleX} כאשר נדרש ${roleY}`;
  } else {
    body = message || "אזהרה";
  }

  if (!hasStructuredHeader) {
    return (
      <article
        className={`shrink-0 overflow-hidden rounded-lg px-2.5 py-1.5 text-right text-xs leading-snug ${shell} ${bodyTone}`}
        dir="rtl"
      >
        {message || "—"}
      </article>
    );
  }

  return (
    <article
      className={`shrink-0 overflow-hidden rounded-lg text-right ${shell}`}
      dir="rtl"
    >
      <div className="border-b border-black/10 bg-black/10 px-2.5 py-1.5 text-xs leading-snug text-ink">
        <span className="font-medium">{emp}</span>
        {times.length > 0 ? (
          <>
            <span className="text-muted">, </span>
            <span dir="ltr" className="tabular-nums">
              {times.join(", ")}
            </span>
          </>
        ) : null}
      </div>
      <div className={`px-2.5 py-1.5 text-xs leading-snug ${bodyTone}`}>{body}</div>
    </article>
  );
}

function WarningsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

/** Stroke chevrons aligned with `WarningsIcon` (same caps / width as other manning controls). */
function ChevronCollapseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronExpandIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ExportIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 15V3M12 15l4-4M12 15l-4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

type InspectorMenu = "warnings" | "export";

export function ManningInspectorSidebar({ warnings }: { warnings: JsonObject[] }) {
  const currentDay = useAppStore((s) => s.currentDay);
  const [wideOpen, setWideOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<InspectorMenu>("warnings");
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const panelId = useId();
  const hasOverlapError = warnings.some(
    (w) =>
      w.rule === "calendar_overlap" ||
      w.rule === "global_shift_outside_availability" ||
      w.rule === "global_event_outside_availability" ||
      w.rule === "global_observation_outside_availability",
  );
  const warningsPanelOpen = wideOpen && activeMenu === "warnings";
  const exportPanelOpen = wideOpen && activeMenu === "export";

  useEffect(() => {
    setExportPath(null);
    setExportError(null);
  }, [currentDay]);

  useEffect(() => {
    if (!wideOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWideOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wideOpen]);

  return (
    <div className="flex h-full min-h-0 shrink-0 border-s border-line bg-surface shadow-airy">
      {/* LTR row: icon rail fixed on the physical left; wide panel opens to its right so the rail does not jump when toggling (page root is dir=rtl). */}
      <div dir="ltr" className="flex h-full min-h-0 shrink-0 flex-row">
        <div className="flex w-12 shrink-0 flex-col items-center justify-between border-e border-line py-2">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              className={`relative flex size-9 items-center justify-center rounded-lg border text-ink transition-colors ${
                warningsPanelOpen
                  ? hasOverlapError
                    ? "border-2 border-red-400 bg-red-100 shadow-sm"
                    : "border-primary bg-primary/15 shadow-sm"
                  : "border-transparent hover:bg-background hover:border-line"
              }`}
              aria-label="אזהרות"
              aria-pressed={warningsPanelOpen}
              onClick={() => {
                setActiveMenu("warnings");
                setWideOpen(true);
              }}
            >
              <WarningsIcon className="shrink-0" />
              {warnings.length > 0 ? (
                <span
                  className={`absolute end-0 top-0 flex size-4 shrink-0 translate-x-[calc(50%-4px)] -translate-y-[calc(50%-4px)] items-center justify-center rounded-full bg-primary font-bold leading-none text-white tabular-nums ring-2 ring-surface ${
                    warnings.length > 9 ? "text-[7px]" : "text-[0.5rem]"
                  }`}
                  aria-hidden
                >
                  {warnings.length > 99 ? "99+" : warnings.length}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className={`flex size-9 items-center justify-center rounded-lg border text-ink transition-colors ${
                exportPanelOpen
                  ? "border-primary bg-primary/15 shadow-sm"
                  : "border-transparent hover:bg-background hover:border-line"
              }`}
              aria-label="ייצוא לאקסל"
              aria-pressed={exportPanelOpen}
              onClick={() => {
                setActiveMenu("export");
                setWideOpen(true);
              }}
            >
              <ExportIcon className="shrink-0" />
            </button>
          </div>

          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-background text-sm leading-none text-ink hover:bg-peach-1"
            aria-expanded={wideOpen}
            aria-controls={wideOpen ? panelId : undefined}
            aria-label={wideOpen ? "צמצם לוח צד" : "הרחב לוח צד"}
            onClick={() => setWideOpen((o) => !o)}
          >
            {wideOpen ? <ChevronCollapseIcon /> : <ChevronExpandIcon />}
          </button>
        </div>

        {wideOpen ? (
          <aside
            id={panelId}
            className="flex h-full min-h-0 w-72 min-w-0 shrink-0 flex-col overflow-hidden bg-surface"
          >
            {activeMenu === "warnings" ? (
              <>
                <div className="shrink-0 border-b border-line px-3 py-1.5 text-right" dir="rtl">
                  <h2 className="font-heading text-xs font-bold text-ink">אזהרות</h2>
                </div>
                {warnings.length > 0 ? (
                  <div
                    className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-3"
                    dir="rtl"
                  >
                    {warnings.map((v, i) => (
                      <ViolationCard
                        key={`${String(v.rule)}-${String(v.shift_id ?? "")}-${i}`}
                        v={v}
                      />
                    ))}
                  </div>
                ) : (
                  <div
                    className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-3 text-right"
                    dir="rtl"
                  >
                    <p className="shrink-0 text-xs text-muted">אין אזהרות ליום זה</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="shrink-0 border-b border-line px-3 py-1.5 text-right" dir="rtl">
                  <h2 className="font-heading text-xs font-bold text-ink">ייצוא</h2>
                </div>
                <div
                  className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 text-right"
                  dir="rtl"
                >
                  <div className="flex flex-col gap-1">
                    <input
                      type="text"
                      readOnly
                      dir="ltr"
                      placeholder="לא נבחר קובץ"
                      aria-label="נתיב הקובץ שנבחר"
                      className="manning-export-path"
                      value={exportPath ?? ""}
                    />
                    <button
                      type="button"
                      className="rounded-sm border border-line bg-background px-3 py-2 text-xs font-heading font-bold text-ink hover:bg-peach-1"
                      onClick={async () => {
                        setExportError(null);
                        try {
                          const path = await save({
                            defaultPath: `לוח-${formatYmd(currentDay)}.xlsx`,
                            filters: [{ name: "Excel", extensions: ["xlsx"] }],
                          });
                          if (path) setExportPath(path);
                        } catch (e) {
                          setExportError(errorMessageFromUnknown(e));
                        }
                      }}
                    >
                      בחר מיקום…
                    </button>
                  </div>
                  <div className="min-h-0 flex-1" aria-hidden />
                  {exportError ? (
                    <p className="shrink-0 text-[0.625rem] leading-snug text-red-700" role="alert">
                      {exportError}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={!exportPath || exportBusy}
                    className="shrink-0 rounded-pill bg-primary px-3 py-2 text-sm font-heading font-bold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={async () => {
                      if (!exportPath) return;
                      setExportError(null);
                      setExportBusy(true);
                      try {
                        const dateStr = formatYmd(currentDay);
                        const weekStr = weekStartString(currentDay);
                        const [windows, presets, shifts, observations, employees] = await Promise.all([
                          api.getShiftWindows(dateStr),
                          api.getSyllabusPresets(),
                          api.getShifts(weekStr),
                          api.getObservations(weekStr),
                          api.getEmployees(true),
                        ]);
                        const bytes = await buildManningDayWorkbookBytes({
                          dateStr,
                          windows: windows as JsonObject[],
                          presets: presets as JsonObject[],
                          shifts: shifts as JsonObject[],
                          observations: observations as JsonObject[],
                          employees: employees as JsonObject[],
                        });
                        await writeFile(exportPath, bytes);
                      } catch (e) {
                        setExportError(errorMessageFromUnknown(e));
                      } finally {
                        setExportBusy(false);
                      }
                    }}
                  >
                    {exportBusy ? "מייצא…" : "ייצוא"}
                  </button>
                </div>
              </>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
