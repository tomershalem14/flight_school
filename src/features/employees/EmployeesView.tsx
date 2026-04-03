import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import * as api from "../../shared/api";
import type { JsonObject } from "../../shared/api";

/** Normalize API row into modal state (stable types; drop joined role columns). */
function employeeRowToModal(e: JsonObject): JsonObject {
  return {
    id: Number(e.id),
    name: String(e.name ?? ""),
    phone: e.phone != null ? String(e.phone) : "",
    role_id: Number(e.role_id),
    always_present: Number(e.always_present) === 1 || e.always_present === true,
    affiliation: e.affiliation != null ? String(e.affiliation) : "",
    notes: e.notes != null ? String(e.notes) : "",
  };
}

function rowIsActive(e: JsonObject): boolean {
  const v = e.is_active;
  if (v === true) return true;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "0" && v !== "";
  return false;
}

export function EmployeesView() {
  const qc = useQueryClient();
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => api.getEmployees(true),
  });
  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: api.getRoles,
  });

  const [modal, setModal] = useState<JsonObject | null>(null);

  const saveMut = useMutation({
    mutationFn: async (m: JsonObject) => {
      const rawId = m.id;
      const id =
        rawId != null && rawId !== "" && !Number.isNaN(Number(rawId)) ? Number(rawId) : 0;

      const name = String(m.name ?? "").trim();
      const phoneTrim = String(m.phone ?? "").trim();
      const roleId = Number(m.role_id);
      if (!name) {
        throw new Error("נא להזין שם");
      }
      if (!Number.isFinite(roleId)) {
        throw new Error("נא לבחור דרג");
      }

      const payload = {
        name,
        phone: phoneTrim === "" ? null : phoneTrim,
        role_id: roleId,
        always_present: Boolean(m.always_present),
        affiliation: String(m.affiliation ?? "").trim() || null,
        notes: String(m.notes ?? "").trim() || null,
      };

      if (id > 0) {
        return api.updateEmployee(id, payload);
      }
      return api.createEmployee({
        name: payload.name,
        phone: payload.phone,
        role_id: payload.role_id,
        always_present: payload.always_present,
        affiliation: payload.affiliation,
        notes: payload.notes,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      setModal(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (empId: number) => api.deleteEmployee(empId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
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
              role_id: roles[0] ? Number(roles[0].id) : 1,
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
              <td className="action-btns">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setModal(employeeRowToModal(e));
                  }}
                >
                  ערוך
                </button>
                {rowIsActive(e) ? (
                  <button
                    type="button"
                    className="btn-danger"
                    style={{ marginRight: 8 }}
                    disabled={deleteMut.isPending}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      deleteMut.mutate(Number(e.id));
                    }}
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
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => setModal(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="modal-header">
              <h3>{Number(modal.id) > 0 ? "עריכת מפעיל" : "מפעיל חדש"}</h3>
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
            {saveMut.isError ? (
              <p className="hint" style={{ color: "var(--danger)", padding: "0 20px 8px" }}>
                {saveMut.error instanceof Error ? saveMut.error.message : String(saveMut.error)}
              </p>
            ) : null}
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setModal(null)}>
                ביטול
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => saveMut.mutate(modal)}
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
