import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import * as api from "../../../shared/api";

export function RemoteRegInline({ weekStr }: { weekStr: string }) {
  const [url, setUrl] = useState("");
  const qc = useQueryClient();
  const { data: cfg } = useQuery({
    queryKey: ["sheet_config"],
    queryFn: api.getSheetConfig,
  });
  const regs = useQuery({
    queryKey: ["remote_regs", weekStr],
    queryFn: () => api.getRemoteRegistrations(weekStr),
  });

  useEffect(() => {
    if (cfg?.sheet_url) setUrl(cfg.sheet_url);
  }, [cfg?.sheet_url]);

  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-airy">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-heading font-bold text-ink">רישום מרחוק</span>
        <button
          type="button"
          className="rounded-pill border border-line px-3 py-1 text-sm hover:bg-background"
          onClick={() => regs.refetch()}
        >
          רענן
        </button>
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        <input
          dir="ltr"
          className="min-w-[200px] flex-1 text-sm"
          placeholder="Google Sheet URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          className="rounded-pill border border-line px-3 py-2 text-sm"
          onClick={async () => {
            await api.saveSheetConfig(url);
            qc.invalidateQueries({ queryKey: ["sheet_config"] });
          }}
        >
          שמור
        </button>
        <button
          type="button"
          className="rounded-pill border border-line px-3 py-2 text-sm"
          onClick={async () => {
            await api.sheetPoll();
            regs.refetch();
          }}
        >
          משוך
        </button>
      </div>
      <div className="max-h-40 space-y-1 overflow-y-auto text-sm">
        {(regs.data ?? []).map((r) => (
          <div
            key={String(r.id)}
            className="flex flex-wrap gap-2 rounded-pill bg-background px-3 py-1 text-ink"
          >
            <span>{String(r.employee_name)}</span>
            <span className="text-muted">{String(r.shift_date)}</span>
            <span className="text-muted">{String(r.status)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
