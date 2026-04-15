import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { JsonObject } from "../../../shared/api";
import { activePresetIdFromList } from "../../../shared/employeeOrderSort";

type ListPos = {
  top: number;
  /** Distance from viewport right edge to menu’s right edge (= pin to anchor x). */
  right: number;
  minWidth: number;
  maxHeight: number;
};

export function MatrixEmployeeOrderMenu({
  presets,
  onPick,
  scrollContainerRef,
}: {
  presets: JsonObject[];
  onPick: (presetId: number | null) => void | Promise<void>;
  scrollContainerRef?: RefObject<HTMLElement | null>;
}) {
  const activeId = activePresetIdFromList(presets);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [listPos, setListPos] = useState<ListPos | null>(null);

  const updateListPos = useCallback(() => {
    const root = anchorRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const spaceBelow = window.innerHeight - r.bottom - gap - margin;
    // Top-right of menu at button’s bottom-left: menu’s right edge at r.left.
    setListPos({
      top: r.bottom + gap,
      right: window.innerWidth - r.left,
      minWidth: Math.max(140, r.width),
      maxHeight: Math.min(320, Math.max(96, spaceBelow)),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setListPos(null);
      return;
    }
    updateListPos();
  }, [open, updateListPos, presets.length]);

  useEffect(() => {
    if (!open) return;
    updateListPos();
    window.addEventListener("resize", updateListPos);
    const scrollEl = scrollContainerRef?.current;
    if (scrollEl) {
      scrollEl.addEventListener("scroll", updateListPos, { passive: true });
    }
    return () => {
      window.removeEventListener("resize", updateListPos);
      if (scrollEl) {
        scrollEl.removeEventListener("scroll", updateListPos);
      }
    };
  }, [open, updateListPos, scrollContainerRef]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const portal =
    open && listPos ? (
      <div
        ref={menuRef}
        className="fixed z-[200] overflow-y-auto rounded-card border border-line bg-surface py-1 text-start shadow-airy"
        style={{
          top: listPos.top,
          right: listPos.right,
          left: "auto",
          minWidth: listPos.minWidth,
          maxHeight: listPos.maxHeight,
        }}
        role="menu"
      >
        <button
          type="button"
          role="menuitem"
          className={`flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-background ${
            activeId == null ? "font-semibold text-primary" : "text-ink"
          }`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            void Promise.resolve(onPick(null)).then(() => setOpen(false));
          }}
        >
          <span className="w-4 shrink-0 text-center" aria-hidden>
            {activeId == null ? "✓" : ""}
          </span>
          <span className="min-w-0 truncate">ברירת מחדל</span>
        </button>
        {presets.map((p) => {
          const pid = Number(p.id);
          const isSel = pid === activeId;
          return (
            <button
              key={pid}
              type="button"
              role="menuitem"
              className={`flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-background ${
                isSel ? "font-semibold text-primary" : "text-ink"
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                void Promise.resolve(onPick(pid)).then(() => setOpen(false));
              }}
            >
              <span className="w-4 shrink-0 text-center" aria-hidden>
                {isSel ? "✓" : ""}
              </span>
              <span className="min-w-0 truncate">{String(p.name ?? "")}</span>
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line bg-background text-muted hover:border-primary/40 hover:text-primary"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="סדר מפעילים"
        title="סדר מפעילים"
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-3.5 w-3.5"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6.75h16.5M3.75 12h10.5M3.75 17.25h7.5"
          />
        </svg>
      </button>
      {typeof document !== "undefined" && portal
        ? createPortal(portal, document.body)
        : null}
    </>
  );
}
