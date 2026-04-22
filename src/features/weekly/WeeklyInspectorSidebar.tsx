import { useEffect, useId, useState } from "react";
import { WeeklyPeopleInspectorPanel } from "./WeeklyPeopleInspectorPanel";

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

function PersonIcon({ className }: { className?: string }) {
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
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

type WeeklyInspectorMenu = "people";

export function WeeklyInspectorSidebar() {
  const [wideOpen, setWideOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<WeeklyInspectorMenu>("people");
  const panelId = useId();
  const peoplePanelOpen = wideOpen && activeMenu === "people";

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
      <div dir="ltr" className="flex h-full min-h-0 shrink-0 flex-row">
        <div className="flex w-12 shrink-0 flex-col items-center justify-between border-e border-line py-2">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              className={`relative flex size-9 items-center justify-center rounded-lg border text-ink transition-colors ${
                peoplePanelOpen
                  ? "border-primary bg-primary/15 shadow-sm"
                  : "border-transparent hover:bg-background hover:border-line"
              }`}
              aria-label="אנשים"
              aria-pressed={peoplePanelOpen}
              onClick={() => {
                setActiveMenu("people");
                setWideOpen(true);
              }}
            >
              <PersonIcon className="shrink-0" />
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
            {activeMenu === "people" ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                <div className="shrink-0 border-b border-line px-3 py-1.5 text-right" dir="rtl">
                  <h2 className="font-heading text-xs font-bold text-ink">אנשים</h2>
                </div>
                <WeeklyPeopleInspectorPanel />
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
