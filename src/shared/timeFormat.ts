import { addDays, formatYmd } from "./dates";

/**
 * End of a 1-hour slot that starts at `hour` (`HH:00`).
 * The 23:00 slot ends at midnight next calendar day (`00:00`), not `24:00` (not parseable server-side).
 */
export function hourSlotEndHm(hour: string): string {
  const nh = (parseInt(hour.slice(0, 2), 10) % 24) + 1;
  if (nh === 24) return "00:00";
  return `${String(nh).padStart(2, "0")}:00`;
}

/** Normalize API time strings to `HH:mm` for `<input type="time" />` (empty stays empty). */
export function formatTimeForInput(value: string): string {
  const t = String(value ?? "").trim();
  if (!t) return "";
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?/.exec(t);
  if (!m) return "";
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10) || 0));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10) || 0));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Extract `HH:mm` from DB coverage ISO strings like `YYYY-MM-DDTHH:mm:ss` (fallback `00:00`). */
export function coverageIsoToHm(iso: string): string {
  const s = String(iso ?? "").trim();
  if (!s) return "00:00";
  const tIdx = s.indexOf("T");
  const rest = tIdx >= 0 ? s.slice(tIdx + 1) : s;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?/.exec(rest);
  if (!m) return "00:00";
  return formatTimeForInput(`${m[1]}:${m[2]}`) || "00:00";
}

/** When `isEnd`, 00:00 means midnight at the start of the next calendar day. */
export function coverageIsoFromDayAndHm(
  dateStr: string,
  hm: string,
  isEnd = false,
): string {
  const fallback = isEnd ? "21:00" : "06:00";
  const normalized = formatTimeForInput(String(hm ?? "").trim()) || fallback;
  const m = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (!m) {
    return `${dateStr}T${fallback}:00`;
  }
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const hh = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  let dayStr = dateStr;
  if (isEnd && h === 0 && min === 0) {
    const ymdParts = dateStr.split("-").map(Number);
    const base = new Date(ymdParts[0], ymdParts[1] - 1, ymdParts[2]);
    dayStr = formatYmd(addDays(base, 1));
  }
  return `${dayStr}T${hh}:${mm}:00`;
}
