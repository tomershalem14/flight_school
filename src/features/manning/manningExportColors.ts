/** Normalize `#RGB` / `#RRGGBB` / `RRGGBB` to 6 hex digits (no `#`). */
export function normalizeHex6(input: string): string {
  const s = String(input ?? "").trim().replace(/^#/, "");
  if (s.length === 3) {
    return s
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (s.length === 6) return s.toUpperCase();
  if (s.length === 8) return s.slice(-6).toUpperCase();
  return "7BA3B5";
}

function hexToRgb(hex6: string): { r: number; g: number; b: number } {
  const h = normalizeHex6(hex6);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex6(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.min(255, Math.max(0, Math.round(n)))
      .toString(16)
      .toUpperCase()
      .padStart(2, "0");
  return `${c(r)}${c(g)}${c(b)}`;
}

/** Light tint (mix toward white), similar to UI `#RRGGBB22` overlay. */
export function tintWindowColor(hex: string, mix = 0.14): string {
  const { r, g, b } = hexToRgb(hex);
  const t = 1 - mix;
  return rgbToHex6(255 * (1 - t) + r * t, 255 * (1 - t) + g * t, 255 * (1 - t) + b * t);
}

/** `xlsx-js-style` expects `FF` + `RRGGBB`. */
export function excelRgb(hex: string): string {
  return `FF${normalizeHex6(hex)}`;
}
