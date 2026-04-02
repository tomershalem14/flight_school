import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import * as api from "../../shared/api";
import type { JsonObject } from "../../shared/api";

export function EmployeesView() {
  const qc = useQueryClient();
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => api.getEmployees(false),
  });
  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: api.getRoles,
  });

  const [modal, setModal] = useState<JsonObject | null>(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!modal) return;
      const id = modal.id as number | undefined;
      const payload = {
        name: modal.name,
        phone: modal.phone || null,
        role_id: Number(modal.role_id),
        always_present: Boolean(modal.always_present),
        affiliation: modal.affiliation || null,
        notes: modal.notes || null,
      };
      if (id) return api.updateEmployee(id, payload);
      return api.createEmployee(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      setModal(null);
    },
  });

  return (
    <div className="view-panel">
      <div className="week-bar">
        <h2>מפעילים</h2>
        <div className="spacer" />
        <button
          type="button"
          className="btn-primary"
          onClick={() =>
            setModal({
              name: "",
              phone: "",
              role_id: roles[0] ? roles[0].id : 1,
              always_present: false,
              affiliation: "",
              notes: "",
            })
          }
        >
          + הוסף
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>שם</th>
            <th>טלפון</th>
            <th>דרג</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((e) => (
            <tr key={String(e.id)}>
              <td>{String(e.name)}</td>
              <td dir="ltr">{String(e.phone ?? "")}</td>
              <td>{String(e.role_name ?? "")}</td>
              <td>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setModal({ ...e })}
                >
                  ערוך
                </button>
                {Number(e.is_active) === 1 ? (
                  <button
                    type="button"
                    className="btn-danger"
                    style={{ marginRight: 8 }}
                    onClick={() => api.deleteEmployee(Number(e.id)).then(() => qc.invalidateQueries({ queryKey: ["employees"] }))}
                  >
                    השבת
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{modal.id ? "עריכת מפעיל" : "מפעיל חדש"}</h3>
              <button type="button" className="modal-close" onClick={() => setModal(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <label>שם</label>
                <input
                  value={String(modal.name ?? "")}
                  onChange={(ev) => setModal({ ...modal, name: ev.target.value })}
                />
              </div>
              <div className="form-row">
                <label>טלפון</label>
                <input
                  dir="ltr"
                  value={String(modal.phone ?? "")}
                  onChange={(ev) => setModal({ ...modal, phone: ev.target.value })}
                />
              </div>
              <div className="form-row">
                <label>דרג</label>
                <select
                  value={String(modal.role_id ?? "")}
                  onChange={(ev) => setModal({ ...modal, role_id: Number(ev.target.value) })}
                >
                  {roles.map((r) => (
                    <option key={String(r.id)} value={String(r.id)}>
                      {String(r.name)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(modal.always_present)}
                    onChange={(ev) => setModal({ ...modal, always_present: ev.target.checked })}
                  />{" "}
                  נוכח תמיד
                </label>
              </div>
              <div className="form-row">
                <label>שיוך</label>
                <input
                  value={String(modal.affiliation ?? "")}
                  onChange={(ev) => setModal({ ...modal, affiliation: ev.target.value })}
                />
              </div>
              <div className="form-row">
                <label>הערות</label>
                <input
                  value={String(modal.notes ?? "")}
                  onChange={(ev) => setModal({ ...modal, notes: ev.target.value })}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setModal(null)}>
                ביטול
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
              >
                שמור
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
