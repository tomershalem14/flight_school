import { useAppStore } from "./store";
import { AppShell } from "./AppShell";
import { ManningLayout } from "../features/manning/ManningLayout";
import { ScheduleView } from "../features/schedule/ScheduleView";
import { FlightBoardView } from "../features/flightBoard/FlightBoardView";
import { ManagementView } from "../features/management/ManagementView";
import { ReportsView } from "../features/reports/ReportsView";
import "./App.css";

function MainApp() {
  const activeView = useAppStore((s) => s.activeView);
  const manningMode = useAppStore((s) => s.manningMode);

  return (
    <AppShell>
      {activeView === "manning" && (
        <ManningLayout>
          {manningMode === "matrix" ? <ScheduleView /> : <FlightBoardView />}
        </ManningLayout>
      )}
      {activeView === "management" && <ManagementView />}
      {activeView === "reports" && (
        <main id="app" className="main-content min-h-0 flex-1 overflow-auto">
          <ReportsView />
        </main>
      )}
    </AppShell>
  );
}

export default function App() {
  return <MainApp />;
}
