/** Week starts Sunday (inclusive Sun–Sat for `week_start` strings). */
export function getSunday(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** @deprecated Prefer `getSunday` for week boundaries; kept for non-week callers. */
export function getMonday(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Display-only: `dd/mm/yy` (local calendar date). */
export function formatDdMmYy(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  return `${day}/${m}/${yy}`;
}

export const DAYS_HE = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
] as const;

/** Gregorian civil year for a Sunday-starting week, using that week’s Saturday (Sun…Sat). */
export function civilYearForSundayWeek(weekStartSunday: Date): number {
  return addDays(weekStartSunday, 6).getFullYear();
}

/**
 * Ordinal week index within that civil year: week 1 begins on the Sunday of the week
 * that contains Jan 1 (i.e. `getSunday(new Date(Y, 0, 1))`). `Y` is derived from the week’s Saturday.
 */
export function weekOrdinalInCivilYear(weekStartSunday: Date): number {
  const Y = civilYearForSundayWeek(weekStartSunday);
  const firstSunday = getSunday(new Date(Y, 0, 1));
  const diffDays = Math.round(
    (weekStartSunday.getTime() - firstSunday.getTime()) / 86_400_000,
  );
  return 1 + Math.floor(diffDays / 7);
}

/** `19/4` style (no leading zeros). */
export function formatDmSlashed(d: Date): string {
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/** Sunday–Saturday as `d/m–d/m` (no year). */
export function formatWeeklyAppBarRange(weekStartSunday: Date): string {
  const sat = addDays(weekStartSunday, 6);
  return `${formatDmSlashed(weekStartSunday)}–${formatDmSlashed(sat)}`;
}

/** App bar: `שבוע X, d/m–d/m`. */
export function formatWeeklyAppBarTitle(weekStartSunday: Date): string {
  const x = weekOrdinalInCivilYear(weekStartSunday);
  const range = formatWeeklyAppBarRange(weekStartSunday);
  return `שבוע ${x}, ${range}`;
}
