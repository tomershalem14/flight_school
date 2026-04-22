import { create } from "zustand";
import { getSunday, formatYmd } from "../shared/dates";

export type AppView = "manning" | "weekly" | "management" | "reports";

export type ManningMode = "matrix" | "board";

interface AppState {
  activeView: AppView;
  setActiveView: (v: AppView) => void;
  manningMode: ManningMode;
  setManningMode: (m: ManningMode) => void;
  /** Calendar day for manning views (week derived from Sunday). */
  currentDay: Date;
  setCurrentDay: (d: Date) => void;
  reportWeekStart: Date;
  setReportWeekStart: (d: Date) => void;
  /** Sunday 00:00 for the weekly availability view. */
  weeklyWeekStart: Date;
  setWeeklyWeekStart: (d: Date) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeView: "manning",
  setActiveView: (activeView) => set({ activeView }),
  manningMode: "matrix",
  setManningMode: (manningMode) => set({ manningMode }),
  currentDay: new Date(),
  setCurrentDay: (currentDay) => set({ currentDay }),
  reportWeekStart: getSunday(new Date()),
  setReportWeekStart: (reportWeekStart) => set({ reportWeekStart }),
  weeklyWeekStart: getSunday(new Date()),
  setWeeklyWeekStart: (weeklyWeekStart) =>
    set({ weeklyWeekStart: getSunday(weeklyWeekStart) }),
}));

export function weekStartString(d: Date): string {
  return formatYmd(getSunday(d));
}
