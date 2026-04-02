import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "../../app/store";
import { formatYmd, getMonday } from "../../shared/dates";
import * as api from "../../shared/api";

export function ReportsView() {
  const reportWeekStart = useAppStore((s) => s.reportWeekStart);
  const setReportWeekStart = useAppStore((s) => s.setReportWeekStart);
  const weekStr = formatYmd(getMonday(reportWeekStart));

  const { data: shiftCount = [] } = useQuery({
    queryKey: ["shift_count", weekStr],
    queryFn: () => api.getShiftCountReport(weekStr),
  });
  const { data: workload = [] } = useQuery({
    queryKey: ["workload", weekStr],
    queryFn: () => api.getWorkloadReport(weekStr),
  });

  return (
    <div className="view-panel">
      <h2>דוחות</h2>
      <div className="form-row" style={{ marginBottom: 16 }}>
        <label>שבוע (יום ראשון)</label>
        <input
          type="date"
          value={weekStr}
          onChange={(e) =>
            setReportWeekStart(getMonday(new Date(e.target.value + "T12:00:00")))
          }
        />
      </div>
      <h3>מעקב משמרות</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>מפעיל</th>
            <th>סוג</th>
            <th>כמות</th>
          </tr>
        </thead>
        <tbody>
          {shiftCount.map((row, i) => (
            <tr key={i}>
              <td>{String(row.emp_name)}</td>
              <td>{String(row.type_name)}</td>
              <td>{String(row.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ marginTop: 24 }}>עומסים</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>מפעיל</th>
            <th>משמרות</th>
            <th>שעות</th>
            <th>סטטוס</th>
          </tr>
        </thead>
        <tbody>
          {workload.map((w) => (
            <tr key={String(w.employee_id)}>
              <td>{String(w.employee_name)}</td>
              <td>{String(w.total_shifts)}</td>
              <td>{String(w.total_hours)}</td>
              <td>{String(w.color)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
