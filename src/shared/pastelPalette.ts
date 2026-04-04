/**
 * Single source for peach / mint / lilac / sky / lemon pastels.
 * Tailwind uses 1=tint … 4=bold (unchanged vs legacy); 5=deep for swatch row + utilities.
 * Shift-type swatch grid: [deep, bold, mid, soft] per column — dark → light (no tint).
 * Each `deep` is one RGB step from `bold` matching the mid→bold delta (same visual pace as soft/mid/bold).
 */
export type PastelFamily = {
  tint: string;
  soft: string;
  mid: string;
  bold: string;
  deep: string;
};

export const pastelFamilies = {
  peach: {
    tint: "#FDF0E9",
    soft: "#FADAC6",
    mid: "#F4B89A",
    bold: "#ED956D",
    deep: "#E67341",
  },
  mint: {
    tint: "#EEF5EA",
    soft: "#D7E6D1",
    mid: "#B3CFAB",
    bold: "#8FB884",
    deep: "#6BA15E",
  },
  lilac: {
    tint: "#F5F1F7",
    soft: "#E6DBEC",
    mid: "#CDB7DB",
    bold: "#B393CA",
    deep: "#9A6FB9",
  },
  sky: {
    tint: "#EDF3F7",
    soft: "#D0E1EC",
    mid: "#A1C3DA",
    bold: "#72A6C9",
    deep: "#4388B8",
  },
  lemon: {
    tint: "#FEF9E6",
    soft: "#FDF0BD",
    mid: "#FCE48B",
    bold: "#FBD759",
    deep: "#FACB27",
  },
} as const satisfies Record<string, PastelFamily>;

export type PastelFamilyName = keyof typeof pastelFamilies;

export function tailwindPastelColors(): Record<
  PastelFamilyName,
  { 1: string; 2: string; 3: string; 4: string; 5: string }
> {
  const names = Object.keys(pastelFamilies) as PastelFamilyName[];
  const out = {} as Record<
    PastelFamilyName,
    { 1: string; 2: string; 3: string; 4: string; 5: string }
  >;
  for (const name of names) {
    const f = pastelFamilies[name];
    out[name] = { 1: f.tint, 2: f.soft, 3: f.mid, 4: f.bold, 5: f.deep };
  }
  return out;
}

/** Columns = families (peach … lemon); rows top→bottom = dark → light (shift-type picker). */
export const PASTEL_SWATCH_COLUMNS: string[][] = (
  Object.keys(pastelFamilies) as PastelFamilyName[]
).map((name) => {
  const f = pastelFamilies[name];
  return [f.deep, f.bold, f.mid, f.soft];
});

/** Default new shift-type color (sky mid). */
export const DEFAULT_SHIFT_TYPE_PASTEL_HEX = pastelFamilies.sky.mid;
