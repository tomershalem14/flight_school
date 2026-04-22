import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";
import { formatTimeForInput } from "./timeFormat";

function isCompleteHmToken(text: string): boolean {
  const t = text.trim();
  if (!/^\d{1,2}:\d{2}$/.test(t)) return false;
  return Boolean(formatTimeForInput(t));
}

/** Snap wall time to the nearest `stepMinutes` boundary (e.g. 60 → whole hours), clamped to 00:00–23:59. */
export function snapHmToMinuteStep(hm: string, stepMinutes: number): string {
  const normalized = formatTimeForInput(hm);
  if (!normalized || stepMinutes <= 0) return normalized;
  const m = /^(\d{2}):(\d{2})$/.exec(normalized);
  if (!m) return normalized;
  let total = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  total = Math.round(total / stepMinutes) * stepMinutes;
  total = Math.max(0, Math.min(23 * 60 + 59, total));
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function digitsOnly(s: string, maxLen: number): string {
  return s.replace(/\D/g, "").slice(0, maxLen);
}

/** Parse pasted text into hour + minute digit strings (before clamp). */
export function parseHmPaste(raw: string): { h: string; m: string } | null {
  const t = raw.trim();
  if (!t) return null;
  const colon = t.indexOf(":");
  if (colon >= 0) {
    const h = digitsOnly(t.slice(0, colon), 2);
    const m = digitsOnly(t.slice(colon + 1), 2);
    if (h || m) return { h, m };
    return null;
  }
  const d = digitsOnly(t, 4);
  if (d.length === 3) return { h: d.slice(0, 1), m: d.slice(1) };
  if (d.length >= 4) return { h: d.slice(0, 2), m: d.slice(2, 4) };
  if (d.length === 2) return { h: d, m: "" };
  if (d.length === 1) return { h: d, m: "" };
  return null;
}

function tryEmitHm(
  h: string,
  m: string,
  value: string,
  onChange: (hm: string) => void,
): void {
  const t = `${digitsOnly(h, 2)}:${digitsOnly(m, 2)}`;
  if (!isCompleteHmToken(t)) return;
  const normalized = formatTimeForInput(t);
  if (normalized && normalized !== value) onChange(normalized);
}

function parentHmParts(value: string): { h: string; m: string } {
  const n = formatTimeForInput(String(value ?? "").trim());
  if (!n) return { h: "", m: "" };
  const [h, m] = n.split(":");
  return { h: h ?? "", m: m ?? "" };
}

export type TimeInput24Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange" | "inputMode"
> & {
  value: string;
  onChange: (hm: string) => void;
  snapMinutesToStep?: number;
  allowEmpty?: boolean;
  /** Tight inline control (e.g. weekly availability composer): short segments, no min-h-9 / px-3. */
  compact?: boolean;
};

export function TimeInput24({
  value,
  onChange,
  snapMinutesToStep,
  allowEmpty = false,
  compact = false,
  onBlur,
  onFocus,
  className,
  style,
  id,
  disabled,
  "aria-label": ariaLabel,
  ...rest
}: TimeInput24Props) {
  const [hour, setHour] = useState("");
  const [minute, setMinute] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const hourRef = useRef<HTMLInputElement>(null);
  const minuteRef = useRef<HTMLInputElement>(null);
  const insideRef = useRef(false);

  const syncFromValue = useCallback(() => {
    const v = String(value ?? "").trim();
    if (!v && allowEmpty) {
      setHour("");
      setMinute("");
      return;
    }
    const { h, m } = parentHmParts(v || value);
    setHour(h);
    setMinute(m);
  }, [value, allowEmpty]);

  useEffect(() => {
    if (!insideRef.current) syncFromValue();
  }, [syncFromValue]);

  const commit = useCallback(() => {
    const dh = digitsOnly(hour, 2);
    const dm = digitsOnly(minute, 2);
    const combinedEmpty = !dh && !dm;

    let next: string;
    if (combinedEmpty && allowEmpty) {
      next = "";
    } else {
      const { h: ph, m: pm } = parentHmParts(value);
      const hh = dh ? dh.padStart(2, "0") : ph;
      const mm = dm ? dm.padStart(2, "0") : pm;
      next = formatTimeForInput(`${hh}:${mm}`) || "";
      if (!next) next = formatTimeForInput(value) || value;
    }
    if (snapMinutesToStep && snapMinutesToStep > 0 && next) {
      next = snapHmToMinuteStep(next, snapMinutesToStep);
    }
    if (next) {
      const { h, m } = parentHmParts(next);
      setHour(h);
      setMinute(m);
    } else {
      setHour("");
      setMinute("");
    }
    if (next !== value) onChange(next);
  }, [hour, minute, allowEmpty, value, onChange, snapMinutesToStep]);

  const scheduleBlurCommit = useCallback(() => {
    requestAnimationFrame(() => {
      const root = rootRef.current;
      if (root?.contains(document.activeElement)) return;
      insideRef.current = false;
      commit();
      if (onBlur && root) {
        const ev = {
          currentTarget: root,
          target: document.activeElement,
        } as unknown as FocusEvent<HTMLInputElement>;
        onBlur(ev);
      }
    });
  }, [commit, onBlur]);

  const applyParsedParts = (parsed: { h: string; m: string }) => {
    setHour(parsed.h);
    setMinute(parsed.m);
    const th = digitsOnly(parsed.h, 2).padStart(2, "0");
    const tm = digitsOnly(parsed.m, 2).padStart(2, "0");
    if (digitsOnly(parsed.m, 2).length >= 2 && isCompleteHmToken(`${th}:${tm}`)) {
      const n = formatTimeForInput(`${th}:${tm}`);
      if (n && n !== value) onChange(n);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData?.getData("text") ?? "";
    if (text.length <= 2 && !text.includes(":")) return;
    const parsed = parseHmPaste(text);
    if (!parsed) return;
    e.preventDefault();
    applyParsedParts(parsed);
    if (digitsOnly(parsed.m, 2).length >= 2) {
      minuteRef.current?.focus();
      minuteRef.current?.select();
    } else {
      hourRef.current?.focus();
      hourRef.current?.select();
    }
  };

  const wrapperClass = compact
    ? [
        "time-input-24 inline-flex shrink-0 items-center gap-0 rounded-md border border-line bg-surface px-0 font-body tabular-nums text-ink shadow-sm scheme-light",
        "h-7 min-h-0 max-h-7 max-w-[2.95rem] !text-[10px] !leading-none",
        "focus-within:border-primary focus-within:outline-none focus-within:ring-1 focus-within:ring-primary/25",
        disabled ? "cursor-not-allowed opacity-60" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")
    : [
        "time-input-24 inline-flex max-w-full min-w-0 shrink-0 items-center gap-0.5 rounded-card border border-line bg-background px-3 font-body text-sm text-ink shadow-none tabular-nums scheme-light",
        "min-h-9 focus-within:border-primary focus-within:outline-none focus-within:ring-2 focus-within:ring-primary/25",
        disabled ? "cursor-not-allowed opacity-60" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ");

  const segClass = compact
    ? "time-input-24__seg box-border h-7 max-h-7 !min-w-0 w-[0.92rem] max-w-[0.92rem] shrink-0 flex-none border-0 bg-transparent p-0 text-center !text-[10px] !leading-none tracking-tight [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    : "time-input-24__seg min-h-0 min-w-0 flex-1 border-0 bg-transparent py-0 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

  const bumpHour = (delta: number) => {
    const h = parseInt(digitsOnly(hour, 2) || "0", 10) || 0;
    const nh = (h + delta + 24) % 24;
    const ns = String(nh).padStart(2, "0");
    setHour(ns);
    tryEmitHm(ns, minute, value, onChange);
  };

  const bumpMinute = (delta: number) => {
    const m = parseInt(digitsOnly(minute, 2) || "0", 10) || 0;
    const nm = (m + delta + 60) % 60;
    const ns = String(nm).padStart(2, "0");
    setMinute(ns);
    tryEmitHm(hour, ns, value, onChange);
  };

  const onHourKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      bumpHour(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      bumpHour(-1);
    } else if (e.key === ":" || e.key === ".") {
      e.preventDefault();
      minuteRef.current?.focus();
      minuteRef.current?.select();
    } else if (
      e.key === "ArrowRight" &&
      e.currentTarget.selectionStart === e.currentTarget.value.length
    ) {
      minuteRef.current?.focus();
      minuteRef.current?.select();
    }
  };

  const onMinuteKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      bumpMinute(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      bumpMinute(-1);
    } else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) {
      e.preventDefault();
      const el = hourRef.current;
      el?.focus();
      if (el) requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
    } else if (e.key === "Backspace" && e.currentTarget.value === "") {
      e.preventDefault();
      hourRef.current?.focus();
      hourRef.current?.select();
    }
  };

  const focusMinuteAfterHour = () => {
    minuteRef.current?.focus();
    minuteRef.current?.select();
  };

  return (
    <div
      ref={rootRef}
      role="group"
      dir="ltr"
      className={wrapperClass}
      style={style}
      aria-label={ariaLabel}
    >
      <input
        {...rest}
        ref={hourRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={2}
        dir="ltr"
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel} — שעה` : "Hour (00–23)"}
        placeholder={compact ? "" : "HH"}
        title={
          compact
            ? undefined
            : "שעה בפורמט 24 שעות; חצים למעלה/למטה, לחיצה כפולה לבחירה"
        }
        className={segClass}
        value={hour}
        onPaste={handlePaste}
        onFocus={(e) => {
          insideRef.current = true;
          e.currentTarget.select();
          onFocus?.(e);
        }}
        onBlur={scheduleBlurCommit}
        onChange={(e) => {
          const next = digitsOnly(e.target.value, 2);
          setHour(next);
          if (next.length === 2) {
            const n = parseInt(next, 10);
            if (n <= 23) {
              tryEmitHm(next, minute, value, onChange);
              focusMinuteAfterHour();
            }
          } else if (next.length === 1) {
            const n = parseInt(next, 10);
            if (n > 2) {
              const padded = String(n).padStart(2, "0");
              setHour(padded);
              tryEmitHm(padded, minute, value, onChange);
              focusMinuteAfterHour();
            }
          }
        }}
        onKeyDown={onHourKeyDown}
      />
      <span
        className={
          compact
            ? "mx-[-1px] shrink-0 select-none text-[10px] leading-none text-ink/60"
            : "shrink-0 select-none text-ink/60"
        }
        aria-hidden
      >
        :
      </span>
      <input
        ref={minuteRef}
        id={id ? `${id}-minutes` : undefined}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={2}
        dir="ltr"
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel} — דקות` : "Minutes (00–59)"}
        placeholder={compact ? "" : "mm"}
        title={compact ? undefined : "דקות; חצים למעלה/למטה"}
        className={segClass}
        value={minute}
        onPaste={handlePaste}
        onFocus={(e) => {
          insideRef.current = true;
          e.currentTarget.select();
        }}
        onBlur={scheduleBlurCommit}
        onChange={(e) => {
          const next = digitsOnly(e.target.value, 2);
          setMinute(next);
          if (next.length === 2) {
            const n = parseInt(next, 10);
            if (n <= 59) tryEmitHm(hour, next, value, onChange);
          }
        }}
        onKeyDown={onMinuteKeyDown}
      />
    </div>
  );
}
