import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppStore, weekStartString } from "../../app/store";
import * as api from "../../shared/api";
import { DAYS_HE, addDays, formatYmd } from "../../shared/dates";
import type { JsonObject } from "../../shared/api";

export function ManningLayout({ children }: { children: ReactNode }) {
  const currentDay = useAppStore((s) => s.currentDay);
  const setCurrentDay = useAppStore((s) => s.setCurrentDay);
  const manningMode = useAppStore((s) => s.manningMode);
  const setManningMode = useAppStore((s) => s.setManningMode);
  const qc = useQueryClient();
  const dateStr = formatYmd(currentDay);
  const weekStr = weekStartString(currentDay);

  const { data: violations = [] } = useQuery({
    queryKey: ["violations", dateStr],
    queryFn: () => api.getDayViolations(dateStr),
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
      qc.invalidateQueries({ queryKey: ["shifts"] });
    },
  });

  const dayLabel = `${DAYS_HE[currentDay.getDay()]} ${dateStr}`;
  const isViewingToday = dateStr === formatYmd(new Date());

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 px-4 py-3 shadow-airy backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-pill border border-line bg-background px-3 py-1.5 text-sm text-ink hover:bg-peach-1"
              onClick={() => setCurrentDay(addDays(currentDay, -1))}
            >
              ◀ יום קודם
            </button>
            <span className="font-heading text-base font-bold text-ink">{dayLabel}</span>
            <button
              type="button"
              className="rounded-pill border border-line bg-background px-3 py-1.5 text-sm text-ink hover:bg-peach-1"
              onClick={() => setCurrentDay(addDays(currentDay, 1))}
            >
              יום הבא ▶
            </button>
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

          <button
            type="button"
            className="rounded-pill border border-mint-2 bg-mint-1 px-3 py-1.5 text-sm font-heading font-semibold text-ink hover:bg-mint-2"
            onClick={() => waMut.mutate()}
          >
            שלח בוואטסאפ
          </button>
        </div>

        {violations.length > 0 && (
          <div className="mt-3 max-h-28 overflow-y-auto rounded-card border border-lilac-2 bg-lilac-1 px-3 py-2 text-sm text-ink">
            {violations.map((v, i) => (
              <div key={i} className="py-0.5">
                {String((v as JsonObject).message ?? "")}
              </div>
            ))}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}
