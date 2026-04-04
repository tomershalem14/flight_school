/** Normalize to #RRGGBB for inline styles. */
function normalizeHex(input: string): string {
  let s = String(input).trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.length === 3) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (s.length !== 6 || !/^[0-9a-fA-F]+$/.test(s)) {
    return "#7BA3B5";
  }
  return `#${s.toUpperCase()}`;
}

function parseRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHex(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/**
 * Summary-row pills: full type color when available; muted (mixed toward white) when assigned.
 */
export function shiftTypePillColors(hex: string): { base: string; muted: string } {
  const base = normalizeHex(hex);
  const { r, g, b } = parseRgb(base);
  const t = 0.5;
  const mr = r + (255 - r) * t;
  const mg = g + (255 - g) * t;
  const mb = b + (255 - b) * t;
  return { base, muted: toHex(mr, mg, mb) };
}
