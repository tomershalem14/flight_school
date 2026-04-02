import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as api from "../../shared/api";

export function RegisterPage() {
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const { data, isError, error } = useQuery({
    queryKey: ["reg_form", token],
    queryFn: () => api.getRegForm(token),
    enabled: Boolean(token),
  });

  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      setStart(String(d.start_time ?? ""));
      setEnd(String(d.end_time ?? ""));
    }
  }, [data]);

  const submitMut = useMutation({
    mutationFn: () =>
      api.submitRegistration({
        token,
        start_time: start,
        end_time: end,
      }),
  });

  if (!token) {
    return <p style={{ padding: 24 }}>חסר פרמטר t בכתובת.</p>;
  }
  if (isError) {
    return (
      <p style={{ padding: 24, color: "#f87171" }}>
        {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  if (!data) {
    return <p style={{ padding: 24 }}>טוען…</p>;
  }

  const row = data as Record<string, unknown>;

  if (submitMut.isSuccess) {
    return <p style={{ padding: 24 }}>הרישום נשלח בהצלחה. תודה!</p>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 480, margin: "0 auto" }}>
      <h1>רישום משמרת</h1>
      <p>
        {String(row.employee_name)} — {String(row.shift_date)}
      </p>
      <div className="form-row">
        <label>שעת התחלה</label>
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
      </div>
      <div className="form-row">
        <label>שעת סיום</label>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <button
        type="button"
        className="btn-primary"
        style={{ marginTop: 16 }}
        disabled={submitMut.isPending}
        onClick={() => submitMut.mutate()}
      >
        שלח
      </button>
    </div>
  );
}
