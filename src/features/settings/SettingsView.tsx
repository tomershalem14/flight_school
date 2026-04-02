import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import * as api from "../../shared/api";
import type { JsonObject } from "../../shared/api";

export function SettingsView() {
  const qc = useQueryClient();
  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: api.getRoles,
  });

  const [draft, setDraft] = useState<JsonObject | null>(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!draft?.id) {
        return api.createRole({
          name: draft?.name,
          can_fly: Boolean(draft?.can_fly ?? true),
          is_management: Boolean(draft?.is_management ?? false),
          color: draft?.color ?? "#3B82F6",
        });
      }
      return api.updateRole(Number(draft.id), {
        name: draft.name,
        can_fly: Boolean(draft.can_fly),
        is_management: Boolean(draft.is_management),
        color: draft.color,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      setDraft(null);
    },
  });

  return (
    <div className="view-panel">
      <h2>הגדרות — דרגים</h2>
      <button
        type="button"
        className="btn-primary"
        style={{ marginBottom: 16 }}
        onClick={() =>
          setDraft({
            name: "",
            can_fly: true,
            is_management: false,
            color: "#3B82F6",
          })
        }
      >
        + דרג
      </button>
      <table className="data-table">
        <thead>
          <tr>
            <th>שם</th>
            <th>טיסה</th>
            <th>ניהול</th>
            <th>צבע</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={String(r.id)}>
              <td>{String(r.name)}</td>
              <td>{Number(r.can_fly) ? "כן" : "לא"}</td>
              <td>{Number(r.is_management) ? "כן" : "לא"}</td>
              <td>
                <span
                  style={{
                    display: "inline-block",
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    background: String(r.color),
                  }}
                />
              </td>
              <td>
                <button type="button" className="btn-secondary" onClick={() => setDraft({ ...r })}>
                  ערוך
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {draft && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{draft.id ? "עריכת דרג" : "דרג חדש"}</h3>
              <button type="button" className="modal-close" onClick={() => setDraft(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <label>שם</label>
                <input
                  value={String(draft.name ?? "")}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(Number(draft.can_fly))}
                    onChange={(e) => setDraft({ ...draft, can_fly: e.target.checked })}
                  />{" "}
                  יכול לטוס
                </label>
              </div>
              <div className="form-row">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(Number(draft.is_management))}
                    onChange={(e) => setDraft({ ...draft, is_management: e.target.checked })}
                  />{" "}
                  ניהול
                </label>
              </div>
              <div className="form-row">
                <label>צבע</label>
                <input
                  type="color"
                  value={String(draft.color ?? "#3B82F6")}
                  onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
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
