import { useEffect, useState } from "react";
import * as api from "../../shared/api";

const FB_DATA_KEY = "fb_data";

/**
 * Flight board: legacy stored large JSON in `localStorage`.
 * Desktop persists the same keys via SQLite `ui_kv`.
 */
export function FlightBoardView() {
  const [raw, setRaw] = useState<string>("{}");
  const [status, setStatus] = useState("");

  useEffect(() => {
    (async () => {
      const v = await api.uiKvGet(FB_DATA_KEY);
      setRaw(v ?? "{}");
    })();
  }, []);

  async function save() {
    setStatus("שומר…");
    try {
      await api.uiKvSet(FB_DATA_KEY, raw);
      setStatus("נשמר");
    } catch (e) {
      setStatus(String(e));
    }
  }

  return (
    <div className="view-panel">
      <h2>לוח טיסות</h2>
      <p style={{ color: "var(--text-muted)", marginBottom: 12 }}>
        נתוני הלוח נשמרים כ־JSON במסד הנתונים המקומי (מפתח <code dir="ltr">{FB_DATA_KEY}</code>).
        ניתן להדביק כאן גיבוי מדפדפן או לערוך ידנית.
      </p>
      <textarea
        dir="ltr"
        style={{
          width: "100%",
          minHeight: 280,
          fontFamily: "monospace",
          fontSize: 12,
          background: "var(--surface2)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 8,
        }}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
      />
      <div style={{ marginTop: 8 }}>
        <button type="button" className="btn-primary" onClick={() => void save()}>
          שמור
        </button>
        <span style={{ marginRight: 12, fontSize: "0.85rem" }}>{status}</span>
      </div>
    </div>
  );
}
