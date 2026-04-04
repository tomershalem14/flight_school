import { create } from "zustand";
import { getMonday, formatYmd } from "../shared/dates";

export type AppView = "manning" | "management" | "reports";

export type ManningMode = "matrix" | "board";

interface AppState {
  activeView: AppView;
  setActiveView: (v: AppView) => void;
  manningMode: ManningMode;
  setManningMode: (m: ManningMode) => void;
  /** Calendar day for manning views (week derived from Monday). */
  currentDay: Date;
  setCurrentDay: (d: Date) => void;
  reportWeekStart: Date;
  setReportWeekStart: (d: Date) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeView: "manning",
  setActiveView: (activeView) => set({ activeView }),
  manningMode: "matrix",
  setManningMode: (manningMode) => set({ manningMode }),
  currentDay: new Date(),
  setCurrentDay: (currentDay) => set({ currentDay }),
  reportWeekStart: getMonday(new Date()),
  setReportWeekStart: (reportWeekStart) => set({ reportWeekStart }),
}));

export function weekStartString(d: Date): string {
  return formatYmd(getMonday(d));
}
