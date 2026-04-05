import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { JsonObject } from "../../../shared/api";

type SyllabusPresetListPos = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

export function SyllabusPresetCombo({
  presets,
  valueId,
  onPick,
  disabled,
  scrollContainerRef,
}: {
  presets: JsonObject[];
  valueId: number;
  onPick: (id: number) => void;
  disabled?: boolean;
  /** When set (e.g. modal body with overflow), keep the portaled list aligned on scroll. */
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [listPos, setListPos] = useState<SyllabusPresetListPos | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const selected = presets.find((p) => Number(p.id) === valueId);
  const label = selected ? String(selected.name ?? "") : "";
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return presets;
    return presets.filter((p) => String(p.name ?? "").toLowerCase().includes(qq));
  }, [presets, q]);

  const updateListPos = useCallback(() => {
    const root = anchorRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const spaceBelow = window.innerHeight - r.bottom - gap - margin;
    const maxHeight = Math.min(160, Math.max(80, spaceBelow));
    setListPos({
      top: r.bottom + gap,
      left: r.left,
      width: r.width,
      maxHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open || disabled) {
      setListPos(null);
      return;
    }
    updateListPos();
  }, [open, disabled, updateListPos, filtered.length]);

  useEffect(() => {
    if (!open || disabled) return;
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
  }, [open, disabled, updateListPos, scrollContainerRef]);

  const listEl =
    open && !disabled && listPos ? (
      <ul
        className="fixed z-[200] overflow-auto rounded-card border border-line bg-surface py-1 text-start shadow-airy"
        style={{
          top: listPos.top,
          left: listPos.left,
          width: listPos.width,
          maxHeight: listPos.maxHeight,
        }}
        role="listbox"
      >
        {filtered.map((p) => {
          const pid = Number(p.id);
          const roleHint = p.min_role_name != null ? String(p.min_role_name) : "";
          return (
            <li key={pid}>
              <button
                type="button"
                className="w-full px-2 py-1.5 text-start text-sm hover:bg-background"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(pid);
                  setOpen(false);
                  setQ("");
                }}
              >
                <span className="font-medium text-ink">{String(p.name ?? "")}</span>
                {roleHint ? (
                  <span className="block text-[10px] text-muted">{roleHint}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    ) : null;

  return (
    <div ref={anchorRef} className="relative min-w-0">
      <input
        className="w-full min-w-0"
        disabled={disabled}
        value={open ? q : label}
        placeholder="בחר סילבוס…"
        onFocus={() => {
          setOpen(true);
          // Clear query so the list shows every preset; seeding `q` with the label
          // would filter to names containing that substring (often only the default).
          setQ("");
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
        }}
      />
      {listEl ? createPortal(listEl, document.body) : null}
    </div>
  );
}
