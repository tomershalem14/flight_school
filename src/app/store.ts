import { create } from "zustand";
import { getMonday, formatYmd } from "../shared/dates";

export type AppView =
  | "flightboard"
  | "schedule"
  | "employees"
  | "reports"
  | "settings";

interface AppState {
  activeView: AppView;
  setActiveView: (v: AppView) => void;
  /** Calendar day for matrix (any date in the week — we derive week from Monday). */
  currentDay: Date;
  setCurrentDay: (d: Date) => void;
  reportWeekStart: Date;
  setReportWeekStart: (d: Date) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeView: "schedule",
  setActiveView: (activeView) => set({ activeView }),
  currentDay: new Date(),
  setCurrentDay: (currentDay) => set({ currentDay }),
  reportWeekStart: getMonday(new Date()),
  setReportWeekStart: (reportWeekStart) => set({ reportWeekStart }),
}));

export function weekStartString(d: Date): string {
  return formatYmd(getMonday(d));
}
