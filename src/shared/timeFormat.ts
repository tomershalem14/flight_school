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
