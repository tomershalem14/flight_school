import { useEffect, useId, useState } from "react";
import type { JsonObject } from "../../shared/api";

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

export function ManningInspectorSidebar({ warnings }: { warnings: JsonObject[] }) {
  const [wideOpen, setWideOpen] = useState(false);
  /** Extensible when more inspector menus are added */
  const activeMenu = "warnings" as const;
  const panelId = useId();

  useEffect(() => {
    if (!wideOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWideOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wideOpen]);

  return (
    <div className="flex min-h-0 shrink-0 border-s border-line bg-surface shadow-airy">
      {/* LTR row: icon rail fixed on the physical left; wide panel opens to its right so the rail does not jump when toggling (page root is dir=rtl). */}
      <div
        dir="ltr"
        className="flex min-h-0 shrink-0 flex-row"
      >
        <div className="flex w-12 shrink-0 flex-col items-center justify-between border-e border-line py-2">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              className={`relative flex size-9 items-center justify-center rounded-lg border text-ink transition-colors ${
                activeMenu === "warnings"
                  ? "border-primary bg-primary/15 shadow-sm"
                  : "border-transparent hover:bg-background hover:border-line"
              }`}
              aria-label="אזהרות"
              aria-pressed={activeMenu === "warnings"}
              onClick={() => setWideOpen(true)}
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
            className="flex w-72 min-w-0 shrink-0 flex-col bg-surface"
          >
            <div className="border-b border-line px-3 py-2 text-right" dir="rtl">
              <h2 className="font-heading text-sm font-bold text-ink">אזהרות</h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3" dir="rtl">
              {warnings.length > 0 ? (
                <div className="max-h-28 overflow-y-auto rounded-card border border-lilac-2 bg-lilac-1 px-3 py-2 text-sm text-ink">
                  {warnings.map((v, i) => (
                    <div key={i} className="py-0.5">
                      {String(v.message ?? "")}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">אין אזהרות ליום זה</p>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
