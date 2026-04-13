import { useAppStore, type AppView } from "./store";

const NAV: { id: AppView; label: string }[] = [
  { id: "manning", label: "לוח" },
  { id: "management", label: "ניהול" },
  { id: "reports", label: "דוחות" },
];

export function Sidebar() {
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-s border-line bg-surface shadow-airy">
      <div className="border-b border-line px-3 py-3">
        <div className="min-w-0">
          <div className="font-heading text-lg font-bold text-ink">לוח טיסות</div>
          <div className="truncate text-xs text-muted">בית ספר למפעילי כטמ״מ</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveView(item.id)}
            className={`rounded-sm px-3 py-2 text-start font-heading text-sm font-semibold transition-colors ${
              activeView === item.id
                ? "bg-primary/20 text-ink shadow-sm"
                : "text-muted hover:bg-background hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
