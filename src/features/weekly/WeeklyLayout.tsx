import { useAppStore } from "../../app/store";
import { addDays, formatWeeklyAppBarTitle, formatYmd, getSunday } from "../../shared/dates";
import { WeeklyAvailabilityColumnsPage } from "./WeeklyAvailabilityColumnsPage";
import { WeeklyInspectorSidebar } from "./WeeklyInspectorSidebar";
import { WeeklyResourcesColumnsPage } from "./WeeklyResourcesColumnsPage";

export function WeeklyLayout() {
  const weeklyWeekStart = useAppStore((s) => s.weeklyWeekStart);
  const setWeeklyWeekStart = useAppStore((s) => s.setWeeklyWeekStart);
  const weeklySubView = useAppStore((s) => s.weeklySubView);
  const setWeeklySubView = useAppStore((s) => s.setWeeklySubView);
  const weekStr = formatYmd(weeklyWeekStart);
  const thisWeekSundayStr = formatYmd(getSunday(new Date()));
  const isViewingThisWeek = weekStr === thisWeekSundayStr;
  const title = formatWeeklyAppBarTitle(weeklyWeekStart);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 px-4 py-3 shadow-airy backdrop-blur-sm">
        <div className="flex min-h-11 flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-block w-[11.2rem] shrink-0 text-center font-heading text-base font-bold text-ink">
              <span className="block truncate tabular-nums" dir="rtl" title={title}>
                {title}
              </span>
            </span>
            <span className="inline-flex flex-row items-center gap-2" dir="ltr">
              <button
                type="button"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-background text-sm leading-none text-ink hover:bg-peach-1"
                aria-label="שבוע הבא"
                onClick={() => setWeeklyWeekStart(addDays(weeklyWeekStart, 7))}
              >
                ◀
              </button>
              <button
                type="button"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-background text-sm leading-none text-ink hover:bg-peach-1"
                aria-label="שבוע קודם"
                onClick={() => setWeeklyWeekStart(addDays(weeklyWeekStart, -7))}
              >
                ▶
              </button>
            </span>
            <button
              type="button"
              className={
                isViewingThisWeek
                  ? "rounded-pill bg-primary px-3 py-1.5 text-sm font-heading font-bold text-white shadow-sm hover:opacity-90"
                  : "rounded-pill border border-primary bg-surface px-3 py-1.5 text-sm font-heading font-bold text-primary shadow-sm hover:bg-primary/10"
              }
              onClick={() => setWeeklyWeekStart(getSunday(new Date()))}
            >
              השבוע
            </button>
          </div>

          <div
            className="ms-auto flex rounded-pill border border-line bg-background p-1"
            role="tablist"
            aria-label="מצב תצוגה שבועית"
          >
            {(
              [
                ["availability", "זמינויות"],
                ["resources", "משאבים"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={weeklySubView === id}
                onClick={() => setWeeklySubView(id)}
                className={`rounded-pill px-4 py-1.5 font-heading text-sm font-bold transition-colors ${
                  weeklySubView === id ? "bg-surface text-ink shadow-airy" : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-row">
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
          {weeklySubView === "availability" ? (
            <WeeklyAvailabilityColumnsPage />
          ) : (
            <WeeklyResourcesColumnsPage />
          )}
        </div>
        <WeeklyInspectorSidebar />
      </div>
    </div>
  );
}
