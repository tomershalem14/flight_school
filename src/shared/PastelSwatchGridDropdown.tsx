import { useEffect, useRef } from "react";
import { PASTEL_SWATCH_COLUMNS } from "./pastelPalette";

export function PastelSwatchGridDropdown({
  value,
  onChange,
  open,
  onOpenChange,
  trigger = "dot",
}: {
  value: string;
  onChange: (hex: string) => void;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  trigger?: "dot" | "panel";
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      onOpenChange(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onOpenChange]);

  const norm = value.trim().toUpperCase();

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      {trigger === "dot" ? (
        <button
          type="button"
          className="size-8 shrink-0 rounded-full border border-line shadow-sm ring-1 ring-black/10 transition hover:ring-2 hover:ring-primary/40 focus-visible:outline focus-visible:ring-2 focus-visible:ring-primary"
          style={{ backgroundColor: value }}
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="בחר צבע"
          title="בחר צבע"
        />
      ) : (
        <button
          type="button"
          className="flex w-full max-w-[200px] items-center gap-2 rounded-card border border-line bg-background px-2 py-1.5 text-start"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <span
            className="size-7 shrink-0 rounded-md border border-line shadow-sm ring-1 ring-black/5"
            style={{ backgroundColor: value }}
          />
          <span className="text-xs text-muted" aria-hidden>
            ▼
          </span>
        </button>
      )}
      {open ? (
        <div
          className="absolute z-[60] mt-1 w-max rounded-card border border-line bg-white p-2 shadow-airy"
          style={{ insetInlineStart: 0 }}
        >
          <div className="flex flex-col gap-1" role="listbox">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="grid grid-cols-5 gap-1">
                {PASTEL_SWATCH_COLUMNS.map((col, colIdx) => {
                  const hex = col[row];
                  const selected = hex.toUpperCase() === norm;
                  return (
                    <button
                      key={`${colIdx}-${row}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`size-8 rounded-md border border-line shadow-sm ring-1 ring-black/5 transition-transform hover:scale-105 ${
                        selected ? "ring-2 ring-primary ring-offset-1" : ""
                      }`}
                      style={{ backgroundColor: hex }}
                      title={hex}
                      onClick={() => {
                        onChange(hex);
                        onOpenChange(false);
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
