import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAppStore } from "./store";
import { ScheduleView } from "../features/schedule/ScheduleView";
import { FlightBoardView } from "../features/flightBoard/FlightBoardView";
import { EmployeesView } from "../features/employees/EmployeesView";
import { ReportsView } from "../features/reports/ReportsView";
import { SettingsView } from "../features/settings/SettingsView";
import { RegisterPage } from "../features/remoteRegistration/RegisterPage";
import "./App.css";

function MainApp() {
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);

  return (
    <>
      <header className="app-header">
        <div className="header-right">
          <span className="logo">לוח טיסות</span>
          <span className="subtitle">בית ספר למפעילי כטמ״מ</span>
        </div>
        <nav className="header-nav">
          {(
            [
              ["flightboard", "לוח טיסות"],
              ["schedule", "מטריצה"],
              ["employees", "מפעילים"],
              ["reports", "דוחות"],
              ["settings", "הגדרות"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`nav-btn ${activeView === id ? "active" : ""}`}
              onClick={() => setActiveView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main id="app" className="main-content">
        {activeView === "flightboard" && <FlightBoardView />}
        {activeView === "schedule" && <ScheduleView />}
        {activeView === "employees" && <EmployeesView />}
        {activeView === "reports" && <ReportsView />}
        {activeView === "settings" && <SettingsView />}
      </main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<MainApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
