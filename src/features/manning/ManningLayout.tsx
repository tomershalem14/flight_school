import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAppStore } from "../../app/store";
import * as api from "../../shared/api";
import { DAYS_HE, addDays, formatDdMmYy, formatYmd } from "../../shared/dates";
import { ManningInspectorSidebar } from "./ManningInspectorSidebar";

export function ManningLayout({ children }: { children: ReactNode }) {
  const currentDay = useAppStore((s) => s.currentDay);
  const setCurrentDay = useAppStore((s) => s.setCurrentDay);
  const manningMode = useAppStore((s) => s.manningMode);
  const setManningMode = useAppStore((s) => s.setManningMode);
  const dateStr = formatYmd(currentDay);

  const { data: warnings = [] } = useQuery({
    queryKey: ["violations", dateStr],
    queryFn: () => api.getDayViolations(dateStr),
  });

  const dayNameHe = DAYS_HE[currentDay.getDay()];
  const dateDdMmYy = formatDdMmYy(currentDay);
  const isViewingToday = dateStr === formatYmd(new Date());

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 px-4 py-3 shadow-airy backdrop-blur-sm">
        <div className="flex min-h-11 flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-block w-[9rem] shrink-0 text-center font-heading text-base font-bold text-ink">
              {dayNameHe},{" "}
              <span className="tabular-nums" dir="ltr">
                {dateDdMmYy}
              </span>
            </span>
            <span className="inline-flex flex-row items-center gap-2" dir="ltr">
              <button
                type="button"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-background text-sm leading-none text-ink hover:bg-peach-1"
                aria-label="יום הבא"
                onClick={() => setCurrentDay(addDays(currentDay, 1))}
              >
                ◀
              </button>
              <button
                type="button"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-background text-sm leading-none text-ink hover:bg-peach-1"
                aria-label="יום קודם"
                onClick={() => setCurrentDay(addDays(currentDay, -1))}
              >
                ▶
              </button>
            </span>
            <button
              type="button"
              className={
                isViewingToday
                  ? "rounded-pill bg-primary px-3 py-1.5 text-sm font-heading font-bold text-white shadow-sm hover:opacity-90"
                  : "rounded-pill border border-primary bg-surface px-3 py-1.5 text-sm font-heading font-bold text-primary shadow-sm hover:bg-primary/10"
              }
              onClick={() => setCurrentDay(new Date())}
            >
              היום
            </button>
          </div>

          <div
            className="ms-auto flex rounded-pill border border-line bg-background p-1"
            role="tablist"
            aria-label="מצב תצוגה"
          >
            {(
              [
                ["matrix", "מטריצה"],
                ["board", "לוח"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={manningMode === id}
                onClick={() => setManningMode(id)}
                className={`rounded-pill px-4 py-1.5 font-heading text-sm font-bold transition-colors ${
                  manningMode === id ? "bg-surface text-ink shadow-airy" : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-row">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">{children}</div>
        <ManningInspectorSidebar warnings={warnings} />
      </div>
    </div>
  );
}
