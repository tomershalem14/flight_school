import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import * as api from "../../shared/api";
import type { JsonObject } from "../../shared/api";
import { DEFAULT_SHIFT_TYPE_PASTEL_HEX } from "../../shared/pastelPalette";
import { PastelSwatchGridDropdown } from "../../shared/PastelSwatchGridDropdown";

const PAGE_SIZE = 10;
/** Narrow column for two icon buttons (edit + deactivate). */
const ACTIONS_COL_CSS = "5.5rem";
const DATA_COL_CSS = `calc((100% - ${ACTIONS_COL_CSS}) / 5)`;
const SYLLABUS_DATA_COL = `calc((100% - ${ACTIONS_COL_CSS}) / 8)`;
type ManagementTab = "employees" | "roles" | "syllabi";

type EmployeeKind = "admin" | "regular" | "extra" | "reserve";

const EMPLOYEE_KIND_OPTIONS: { value: EmployeeKind; label: string }[] = [
  { value: "admin", label: "הנהלה" },
  { value: "regular", label: "סדיר" },
  { value: "extra", label: 'הצ"ח' },
  { value: "reserve", label: "מילואים" },
];

const EMPLOYEE_KIND_LABELS: Record<EmployeeKind, string> = {
  admin: "הנהלה",
  regular: "סדיר",
  extra: 'הצ"ח',
  reserve: "מילואים",
};

function parseEmployeeKind(v: unknown): EmployeeKind {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (s === "admin" || s === "regular" || s === "extra" || s === "reserve") {
    return s;
  }
  return "regular";
}

function rowIsAffiliationLeader(e: JsonObject): boolean {
  const v = e.affiliation_leader;
  if (v === true) return true;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "0" && v !== "";
  return false;
}

function employeeRowToModal(e: JsonObject): JsonObject {
  const kind = parseEmployeeKind(e.employee_type);
  return {
    id: Number(e.id),
    name: String(e.name ?? ""),
    phone: e.phone != null ? String(e.phone) : "",
    role_id: Number(e.role_id),
    employee_type: kind,
    affiliation:
      kind === "regular" && e.affiliation != null ? String(e.affiliation) : "",
    affiliation_leader: rowIsAffiliationLeader(e),
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

const DEFAULT_ROLE_HEX = "#3B82F6";

function RoleColorDot({ color }: { color: string }) {
  const c = color.trim() || DEFAULT_ROLE_HEX;
  return (
    <span
      className="size-2.5 shrink-0 rounded-full border border-line shadow-sm ring-1 ring-black/10"
      style={{ backgroundColor: c }}
      aria-hidden
    />
  );
}

function nameCellWithRoleDot(name: string, roleColor: string) {
  return (
    <span className="inline-flex max-w-full items-center justify-center gap-2">
      <RoleColorDot color={roleColor} />
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}

function syllabusMinutesLabel(n: number): string {
  return `${n} דק'`;
}

export function ManagementView() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<ManagementTab>("employees");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [empModal, setEmpModal] = useState<JsonObject | null>(null);
  const [roleDraft, setRoleDraft] = useState<JsonObject | null>(null);
  const [roleSwatchOpen, setRoleSwatchOpen] = useState(false);
  const [syllabusSearch, setSyllabusSearch] = useState("");
  const [syllabusPage, setSyllabusPage] = useState(1);
  const [presetDraft, setPresetDraft] = useState<JsonObject | null>(null);

  const { data: employeesRaw = [] } = useQuery({
    queryKey: ["employees", "management"],
    queryFn: () => api.getEmployees(false),
  });
  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: api.getRoles,
  });

  const { data: syllabusRaw = [] } = useQuery({
    queryKey: ["syllabus_presets"],
    queryFn: () => api.getSyllabusPresets(),
  });

  const employees = useMemo(() => employeesRaw as JsonObject[], [employeesRaw]);
  const syllabi = useMemo(() => syllabusRaw as JsonObject[], [syllabusRaw]);

  const syllabusFiltered = useMemo(() => {
    const q = syllabusSearch.trim().toLowerCase();
    if (!q) return syllabi;
    return syllabi.filter((p) => String(p.name ?? "").toLowerCase().includes(q));
  }, [syllabi, syllabusSearch]);

  useEffect(() => {
    setSyllabusPage(1);
  }, [syllabusSearch, syllabi.length]);

  const syllabusTotal = syllabusFiltered.length;
  const syllabusPageCount = Math.max(1, Math.ceil(syllabusTotal / PAGE_SIZE));
  const syllabusSafePage = Math.min(syllabusPage, syllabusPageCount);
  const syllabusSlice = useMemo(() => {
    const start = (syllabusSafePage - 1) * PAGE_SIZE;
    return syllabusFiltered.slice(start, start + PAGE_SIZE);
  }, [syllabusFiltered, syllabusSafePage]);

  useEffect(() => {
    if (syllabusPage !== syllabusSafePage) setSyllabusPage(syllabusSafePage);
  }, [syllabusPage, syllabusSafePage]);

  const filtered = useMemo(() => {
    const activeOnly = showInactive
      ? employees
      : employees.filter((e) => rowIsActive(e));
    const q = search.trim().toLowerCase();
    if (!q) return activeOnly;
    return activeOnly.filter((e) => {
      const name = String(e.name ?? "").toLowerCase();
      const phone = String(e.phone ?? "").toLowerCase();
      const aff = String(e.affiliation ?? "").toLowerCase();
      const kind = parseEmployeeKind(e.employee_type);
      return (
        name.includes(q) ||
        phone.includes(q) ||
        (kind === "regular" && aff.includes(q))
      );
    });
  }, [employees, search, showInactive]);

  useEffect(() => {
    setPage(1);
  }, [search, showInactive, employees.length]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageSlice = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    if (!roleDraft) setRoleSwatchOpen(false);
  }, [roleDraft]);

  const saveEmpMut = useMutation({
    mutationFn: async (m: JsonObject) => {
      const rawId = m.id;
      const id =
        rawId != null && rawId !== "" && !Number.isNaN(Number(rawId)) ? Number(rawId) : 0;
      const name = String(m.name ?? "").trim();
      const phoneTrim = String(m.phone ?? "").trim();
      const roleId = Number(m.role_id);
      if (!name) throw new Error("נא להזין שם");
      if (!Number.isFinite(roleId)) throw new Error("נא לבחור דרג");
      const employee_type = parseEmployeeKind(m.employee_type);
      const affTrim =
        employee_type === "regular" ? String(m.affiliation ?? "").trim() : "";
      const payload = {
        name,
        phone: phoneTrim === "" ? null : phoneTrim,
        role_id: roleId,
        employee_type,
        affiliation: employee_type === "regular" ? affTrim || null : null,
        affiliation_leader:
          employee_type === "regular" &&
          affTrim !== "" &&
          Boolean(m.affiliation_leader),
        notes: String(m.notes ?? "").trim() || null,
      };
      if (id > 0) return api.updateEmployee(id, payload);
      return api.createEmployee({
        name: payload.name,
        phone: payload.phone,
        role_id: payload.role_id,
        employee_type: payload.employee_type,
        affiliation: payload.affiliation,
        affiliation_leader: payload.affiliation_leader,
        notes: payload.notes,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      setEmpModal(null);
    },
  });

  const deleteEmpMut = useMutation({
    mutationFn: (empId: number) => api.deleteEmployee(empId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
  });

  const reactivateEmpMut = useMutation({
    mutationFn: (empId: number) => api.reactivateEmployee(empId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
  });

  const employeeActionPending =
    deleteEmpMut.isPending || reactivateEmpMut.isPending;

  const saveRoleMut = useMutation({
    mutationFn: async () => {
      if (!roleDraft) return;
      const roleLevel = Number(roleDraft.role_level ?? 0);
      const level = Number.isFinite(roleLevel) ? roleLevel : 0;
      if (!roleDraft.id) {
        return api.createRole({
          name: String(roleDraft.name ?? ""),
          role_level: level,
          color: String(roleDraft.color ?? "#3B82F6"),
        });
      }
      return api.updateRole(Number(roleDraft.id), {
        name: String(roleDraft.name ?? ""),
        role_level: level,
        color: String(roleDraft.color ?? "#3B82F6"),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      setRoleDraft(null);
    },
  });

  const deleteRoleMut = useMutation({
    mutationFn: (rid: number) => api.deleteRole(rid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      setRoleDraft(null);
    },
  });

  const savePresetMut = useMutation({
    mutationFn: async () => {
      if (!presetDraft) return;
      const locked = Number(presetDraft.system_locked ?? presetDraft.systemLocked) === 1;
      if (locked) throw new Error("סילבוס מערכת לא ניתן לעריכה");
      const rawId = presetDraft.id;
      const id =
        rawId != null && rawId !== "" && !Number.isNaN(Number(rawId)) ? Number(rawId) : 0;
      const name = String(presetDraft.name ?? "").trim();
      if (!name) throw new Error("נא להזין שם");
      const maxInRow = Math.max(1, Number(presetDraft.max_in_row ?? 1));
      const roleVal = presetDraft.min_role_id;
      const min_role_id =
        roleVal === "" || roleVal == null ? null : Number(roleVal);
      const body: JsonObject = {
        name,
        min_role_id,
        duration_minutes: Number(presetDraft.duration_minutes ?? 60),
        prep_minutes: Number(presetDraft.prep_minutes ?? 0),
        rest_minutes: Number(presetDraft.rest_minutes ?? 0),
        max_in_row: maxInRow,
        joint_prep: Boolean(presetDraft.joint_prep),
        joint_rest: Boolean(presetDraft.joint_rest),
        notes: String(presetDraft.notes ?? "").trim() || null,
      };
      if (id > 0) return api.updateSyllabusPreset(id, body);
      return api.createSyllabusPreset(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["syllabus_presets"] });
      qc.invalidateQueries({ queryKey: ["shift_windows"] });
      // Duration change (and delete) mark shifts `up_to_date = 0` on the server; refetch so schedule/board show stale immediately.
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
      setPresetDraft(null);
    },
  });

  const deletePresetMut = useMutation({
    mutationFn: (pid: number) => api.deleteSyllabusPreset(pid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["syllabus_presets"] });
      qc.invalidateQueries({ queryKey: ["shift_windows"] });
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["violations"] });
    },
  });

  function rowIsSystemPreset(p: JsonObject): boolean {
    const v = p.system_locked ?? p.systemLocked;
    if (v === true) return true;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") return v !== "0" && v !== "";
    return false;
  }

  const openNewEmployee = () => {
    setEmpModal({
      name: "",
      phone: "",
      role_id: roles[0] ? Number(roles[0].id) : 1,
      employee_type: "regular" satisfies EmployeeKind,
      affiliation: "",
      affiliation_leader: false,
      notes: "",
    });
  };

  const rangeStart = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, total);
  const syllabusRangeStart =
    syllabusTotal === 0 ? 0 : (syllabusSafePage - 1) * PAGE_SIZE + 1;
  const syllabusRangeEnd = Math.min(syllabusSafePage * PAGE_SIZE, syllabusTotal);

  return (
    <div
      id="app"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <header className="sticky top-0 z-30 flex gap-3 border-b border-line bg-surface/95 px-4 pb-0 shadow-airy backdrop-blur-sm">
        <div className="flex min-h-[4.25rem] min-w-0 flex-1 flex-col pt-3">
          <div className="flex h-14 min-h-14 flex-col justify-between">
            <h1 className="m-0 shrink-0 font-heading text-lg font-bold leading-tight text-ink">
              ניהול
            </h1>
            <div
              role="tablist"
              aria-label="מקטעי ניהול"
              className="flex shrink-0 items-end gap-6"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "employees"}
                className={`border-b-2 pb-1.5 text-sm font-heading font-semibold leading-none transition-colors ${
                  tab === "employees"
                    ? "border-primary text-primary"
                    : "border-line text-muted hover:border-primary/50 hover:text-primary"
                }`}
                onClick={() => setTab("employees")}
              >
                מפעילים
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "roles"}
                className={`border-b-2 pb-1.5 text-sm font-heading font-semibold leading-none transition-colors ${
                  tab === "roles"
                    ? "border-primary text-primary"
                    : "border-line text-muted hover:border-primary/50 hover:text-primary"
                }`}
                onClick={() => setTab("roles")}
              >
                דרגים
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "syllabi"}
                className={`border-b-2 pb-1.5 text-sm font-heading font-semibold leading-none transition-colors ${
                  tab === "syllabi"
                    ? "border-primary text-primary"
                    : "border-line text-muted hover:border-primary/50 hover:text-primary"
                }`}
                onClick={() => setTab("syllabi")}
              >
                סילבוסים
              </button>
            </div>
          </div>
        </div>
        <div className="flex min-h-[4.25rem] shrink-0 items-center">
            {tab === "employees" ? (
              <button
                type="button"
                className="rounded-pill bg-primary px-3 py-1.5 text-sm font-heading font-bold text-white shadow-sm hover:opacity-90"
                onClick={openNewEmployee}
              >
                + מפעיל
              </button>
            ) : tab === "roles" ? (
              <button
                type="button"
                className="rounded-pill bg-primary px-3 py-1.5 text-sm font-heading font-bold text-white shadow-sm hover:opacity-90"
                onClick={() =>
                  setRoleDraft({
                    name: "",
                    role_level: 0,
                    color: "#3B82F6",
                  })
                }
              >
                + דרג
              </button>
            ) : (
              <button
                type="button"
                className="rounded-pill bg-primary px-3 py-1.5 text-sm font-heading font-bold text-white shadow-sm hover:opacity-90"
                onClick={() =>
                  setPresetDraft({
                    name: "",
                    min_role_id: "",
                    duration_minutes: 60,
                    prep_minutes: 30,
                    rest_minutes: 45,
                    max_in_row: 2,
                    joint_prep: true,
                    joint_rest: false,
                    notes: "",
                  })
                }
              >
                + סילבוס
              </button>
            )}
        </div>
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
        <div className="flex w-full min-w-0 flex-col gap-4">
        {tab === "employees" && (
          <div className="flex flex-col gap-4">
            <div className="flex w-full max-w-none overflow-hidden rounded-pill border border-line bg-surface shadow-sm">
              <div className="relative min-w-0 flex-1">
                <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted">
                  ⌕
                </span>
                <input
                  id="mgmt-emp-search"
                  type="search"
                  placeholder="חיפוש מפעילים…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="חיפוש מפעילים"
                />
              </div>
              <label
                htmlFor="mgmt-show-inactive"
                className="flex shrink-0 cursor-pointer items-center gap-2 border-s border-line px-3 py-2.5 text-sm text-ink"
              >
                <input
                  id="mgmt-show-inactive"
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="size-4 shrink-0 rounded border-line text-primary focus:ring-2 focus:ring-primary/30"
                  aria-label="הצג מושבתים"
                />
                הצג מושבתים
              </label>
            </div>

            <div className="overflow-hidden rounded-card border border-line bg-surface shadow-airy">
              <div className="overflow-x-auto">
                <table className="table-fixed w-full border-collapse text-center text-sm">
                  <colgroup>
                    <col style={{ width: DATA_COL_CSS }} />
                    <col style={{ width: DATA_COL_CSS }} />
                    <col style={{ width: DATA_COL_CSS }} />
                    <col style={{ width: DATA_COL_CSS }} />
                    <col style={{ width: DATA_COL_CSS }} />
                    <col style={{ width: ACTIONS_COL_CSS }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-line bg-background/60">
                      <th className="min-w-0 px-4 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        שם
                      </th>
                      <th className="min-w-0 px-4 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        דרג
                      </th>
                      <th className="min-w-0 px-4 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        טלפון
                      </th>
                      <th className="min-w-0 px-4 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        שיוך
                      </th>
                      <th className="min-w-0 px-4 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        אוכלוסיה
                      </th>
                      <th className="px-1 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        פעולות
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageSlice.map((e) => {
                      const eid = Number(e.id);
                      const name = String(e.name ?? "");
                      const aff = String(e.affiliation ?? "").trim();
                      const active = rowIsActive(e);
                      const kind = parseEmployeeKind(e.employee_type);
                      return (
                        <tr
                          key={eid}
                          className={`border-b border-line last:border-0 ${
                            active
                              ? "hover:bg-background/40"
                              : "bg-muted/15 hover:bg-muted/25"
                          }`}
                        >
                          <td className="min-w-0 px-4 py-3 text-ink">
                            {nameCellWithRoleDot(
                              name,
                              String(e.role_color ?? DEFAULT_ROLE_HEX),
                            )}
                          </td>
                          <td className="min-w-0 truncate px-4 py-3 text-ink">
                            {String(e.role_name ?? "")}
                          </td>
                          <td className="min-w-0 truncate px-4 py-3 font-mono text-ink" dir="ltr">
                            {String(e.phone ?? "") || "—"}
                          </td>
                          <td
                            className={`min-w-0 truncate px-4 py-3 text-ink ${
                              kind === "regular" &&
                              aff &&
                              rowIsAffiliationLeader(e)
                                ? "font-bold"
                                : ""
                            }`}
                          >
                            {kind === "regular" ? aff || "—" : "—"}
                          </td>
                          <td className="min-w-0 truncate px-4 py-3 text-ink">
                            {EMPLOYEE_KIND_LABELS[kind]}
                          </td>
                          <td className="px-1 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-background text-ink hover:bg-background/80"
                                aria-label="ערוך"
                                onClick={() => setEmpModal(employeeRowToModal(e))}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  strokeWidth={1.5}
                                  stroke="currentColor"
                                  className="size-4"
                                  aria-hidden
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"
                                  />
                                </svg>
                              </button>
                              {active ? (
                                <button
                                  type="button"
                                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-background text-peach-4 hover:bg-peach-1/40"
                                  aria-label="השבת"
                                  disabled={employeeActionPending}
                                  onClick={() => deleteEmpMut.mutate(eid)}
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    strokeWidth={1.5}
                                    stroke="currentColor"
                                    className="size-4"
                                    aria-hidden
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                                  </svg>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-background text-primary hover:bg-primary/10"
                                  aria-label="הפעל מחדש"
                                  disabled={employeeActionPending}
                                  onClick={() => reactivateEmpMut.mutate(eid)}
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    strokeWidth={1.5}
                                    stroke="currentColor"
                                    className="size-4"
                                    aria-hidden
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 6 6v9"
                                    />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-xs text-muted">
                <span className="uppercase tracking-wide">
                  מציג {rangeStart}–{rangeEnd} מתוך {total} מפעילים
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-full border border-line bg-background text-ink hover:bg-background/80 disabled:opacity-40"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="עמוד קודם"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-full border border-line bg-background text-ink hover:bg-background/80 disabled:opacity-40"
                    disabled={safePage >= pageCount}
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    aria-label="עמוד הבא"
                  >
                    ›
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "syllabi" && (
          <div className="flex flex-col gap-4">
            <div className="flex w-full max-w-none overflow-hidden rounded-pill border border-line bg-surface shadow-sm">
              <div className="relative min-w-0 flex-1">
                <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted">
                  ⌕
                </span>
                <input
                  type="search"
                  placeholder="חיפוש סילבוסים…"
                  value={syllabusSearch}
                  onChange={(e) => setSyllabusSearch(e.target.value)}
                  aria-label="חיפוש סילבוסים"
                />
              </div>
            </div>
            <div className="overflow-hidden rounded-card border border-line bg-surface shadow-airy">
              <div className="overflow-x-auto">
                <table className="table-fixed w-full border-collapse text-center text-sm">
                  <colgroup>
                    <col style={{ width: SYLLABUS_DATA_COL }} />
                    <col style={{ width: SYLLABUS_DATA_COL }} />
                    <col style={{ width: SYLLABUS_DATA_COL }} />
                    <col style={{ width: SYLLABUS_DATA_COL }} />
                    <col style={{ width: SYLLABUS_DATA_COL }} />
                    <col style={{ width: SYLLABUS_DATA_COL }} />
                    <col style={{ width: SYLLABUS_DATA_COL }} />
                    <col style={{ width: SYLLABUS_DATA_COL }} />
                    <col style={{ width: ACTIONS_COL_CSS }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-line bg-background/60">
                      <th className="min-w-0 px-2 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        שם
                      </th>
                      <th className="min-w-0 px-2 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        דרג מינ׳
                      </th>
                      <th className="min-w-0 px-2 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        משך
                      </th>
                      <th className="min-w-0 px-2 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        תדריך
                      </th>
                      <th className="min-w-0 px-2 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        תחקיר
                      </th>
                      <th className="min-w-0 px-2 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        מקס׳ ברצף
                      </th>
                      <th className="min-w-0 px-2 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        תדריך משותף
                      </th>
                      <th className="min-w-0 px-2 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        תחקיר משותף
                      </th>
                      <th className="px-1 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                        פעולות
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {syllabusSlice.map((p) => {
                      const pid = Number(p.id);
                      const locked = rowIsSystemPreset(p);
                      return (
                        <tr
                          key={pid}
                          className="border-b border-line last:border-0 hover:bg-background/40"
                        >
                          <td className="min-w-0 px-2 py-3 text-start font-medium text-ink">
                            {String(p.name ?? "")}
                          </td>
                          <td className="min-w-0 truncate px-2 py-3 text-ink">
                            {String(p.min_role_name ?? "—")}
                          </td>
                          <td className="min-w-0 px-2 py-3 tabular-nums text-ink">
                            {syllabusMinutesLabel(Number(p.duration_minutes ?? 0))}
                          </td>
                          <td className="min-w-0 px-2 py-3 tabular-nums text-ink">
                            {syllabusMinutesLabel(Number(p.prep_minutes ?? 0))}
                          </td>
                          <td className="min-w-0 px-2 py-3 tabular-nums text-ink">
                            {syllabusMinutesLabel(Number(p.rest_minutes ?? 0))}
                          </td>
                          <td className="min-w-0 px-2 py-3 tabular-nums text-ink">
                            {Math.max(1, Number(p.max_in_row ?? 1))}
                          </td>
                          <td className="min-w-0 px-2 py-3 text-ink">
                            {Number(p.joint_prep ?? 0) !== 0 ? "כן" : "לא"}
                          </td>
                          <td className="min-w-0 px-2 py-3 text-ink">
                            {Number(p.joint_rest ?? 0) !== 0 ? "כן" : "לא"}
                          </td>
                          <td className="px-1 py-3">
                            {locked ? (
                              <span className="text-xs text-muted">—</span>
                            ) : (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-background text-ink hover:bg-background/80"
                                  aria-label="ערוך"
                                  onClick={() => setPresetDraft({ ...p })}
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    strokeWidth={1.5}
                                    stroke="currentColor"
                                    className="size-4"
                                    aria-hidden
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"
                                    />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-background text-peach-4 hover:bg-peach-1/40"
                                  aria-label="מחק סילבוס"
                                  disabled={deletePresetMut.isPending}
                                  onClick={() => deletePresetMut.mutate(pid)}
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    strokeWidth={1.5}
                                    stroke="currentColor"
                                    className="size-4"
                                    aria-hidden
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                                  </svg>
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-xs text-muted">
                <span className="uppercase tracking-wide">
                  מציג {syllabusRangeStart}–{syllabusRangeEnd} מתוך {syllabusTotal} סילבוסים
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-full border border-line bg-background text-ink hover:bg-background/80 disabled:opacity-40"
                    disabled={syllabusSafePage <= 1}
                    onClick={() => setSyllabusPage((pg) => Math.max(1, pg - 1))}
                    aria-label="עמוד קודם"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-full border border-line bg-background text-ink hover:bg-background/80 disabled:opacity-40"
                    disabled={syllabusSafePage >= syllabusPageCount}
                    onClick={() =>
                      setSyllabusPage((pg) => Math.min(syllabusPageCount, pg + 1))
                    }
                    aria-label="עמוד הבא"
                  >
                    ›
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "roles" && (
          <div className="overflow-hidden rounded-card border border-line bg-surface shadow-airy">
            <div className="overflow-x-auto">
              <table className="table-fixed w-full border-collapse text-center text-sm">
                <colgroup>
                  <col style={{ width: DATA_COL_CSS }} />
                  <col style={{ width: DATA_COL_CSS }} />
                  <col style={{ width: DATA_COL_CSS }} />
                  <col style={{ width: DATA_COL_CSS }} />
                  <col style={{ width: DATA_COL_CSS }} />
                  <col style={{ width: ACTIONS_COL_CSS }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-line bg-background/60">
                    <th className="min-w-0 px-4 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                      שם
                    </th>
                    <th className="min-w-0 px-4 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                      רמה
                    </th>
                    <th colSpan={3} className="min-w-0 px-4 py-3" aria-hidden />
                    <th className="px-1 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                      פעולות
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr
                      key={String(r.id)}
                      className="border-b border-line last:border-0 hover:bg-background/40"
                    >
                      <td className="min-w-0 px-4 py-3 text-ink">
                        {nameCellWithRoleDot(
                          String(r.name),
                          String(r.color ?? DEFAULT_ROLE_HEX),
                        )}
                      </td>
                      <td className="min-w-0 truncate px-4 py-3 text-ink">
                        {Number(r.role_level ?? 0)}
                      </td>
                      <td className="min-w-0 truncate px-4 py-3 text-ink" aria-hidden />
                      <td className="min-w-0 truncate px-4 py-3 text-ink" aria-hidden />
                      <td className="min-w-0 truncate px-4 py-3 text-ink" aria-hidden />
                      <td className="px-1 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-background text-ink hover:bg-background/80"
                            aria-label="ערוך"
                            onClick={() => setRoleDraft({ ...r })}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                              className="size-4"
                              aria-hidden
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-background text-peach-4 hover:bg-peach-1/40"
                            aria-label="מחק דרג"
                            disabled={roles.length <= 1 || deleteRoleMut.isPending}
                            onClick={() => deleteRoleMut.mutate(Number(r.id))}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                              className="size-4"
                              aria-hidden
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </div>
      </div>

      {empModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => setEmpModal(null)}
        >
          <div
            className="flex w-full max-w-md flex-col rounded-card border border-line bg-surface shadow-airy"
            role="dialog"
            aria-modal="true"
            aria-labelledby="emp-modal-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 id="emp-modal-title" className="font-heading text-lg font-bold text-ink">
                {Number(empModal.id) > 0 ? "עריכת מפעיל" : "מפעיל חדש"}
              </h2>
              <button
                type="button"
                className="rounded-pill px-2 text-muted hover:bg-background hover:text-ink"
                onClick={() => setEmpModal(null)}
              >
                ✕
              </button>
            </div>
            <div className="max-h-[min(70vh,480px)] space-y-3 overflow-y-auto px-4 py-4">
              <div className="form-row">
                <label className="text-sm font-semibold text-ink">שם</label>
                <input
                  value={String(empModal.name ?? "")}
                  onChange={(ev) => setEmpModal({ ...empModal, name: ev.target.value })}
                />
              </div>
              <div className="form-row">
                <label className="text-sm font-semibold text-ink">טלפון</label>
                <input
                  dir="ltr"
                  value={String(empModal.phone ?? "")}
                  onChange={(ev) => setEmpModal({ ...empModal, phone: ev.target.value })}
                />
              </div>
              <div className="form-row">
                <label className="text-sm font-semibold text-ink">דרג</label>
                <select
                  value={String(empModal.role_id ?? "")}
                  onChange={(ev) =>
                    setEmpModal({ ...empModal, role_id: Number(ev.target.value) })
                  }
                >
                  {roles.map((r) => (
                    <option key={String(r.id)} value={String(r.id)}>
                      {String(r.name)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label className="text-sm font-semibold text-ink" htmlFor="emp-modal-type">
                  אוכלוסיה
                </label>
                <select
                  id="emp-modal-type"
                  value={String(empModal.employee_type ?? "regular")}
                  onChange={(ev) => {
                    const next = parseEmployeeKind(ev.target.value);
                    setEmpModal({
                      ...empModal,
                      employee_type: next,
                      affiliation: next === "regular" ? String(empModal.affiliation ?? "") : "",
                      affiliation_leader:
                        next === "regular" ? Boolean(empModal.affiliation_leader) : false,
                    });
                  }}
                >
                  {EMPLOYEE_KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {parseEmployeeKind(empModal.employee_type) === "regular" ? (
                <div className="form-row">
                  <label className="text-sm font-semibold text-ink" htmlFor="emp-modal-affiliation">
                    שיוך
                  </label>
                  <div className="flex w-full max-w-none overflow-hidden rounded-pill border border-line bg-surface shadow-sm">
                    <div className="relative min-w-0 flex-1">
                      <input
                        id="emp-modal-affiliation"
                        type="text"
                        autoComplete="off"
                        value={String(empModal.affiliation ?? "")}
                        onChange={(ev) => {
                          const v = ev.target.value;
                          setEmpModal({
                            ...empModal,
                            affiliation: v,
                            affiliation_leader:
                              v.trim() === "" ? false : Boolean(empModal.affiliation_leader),
                          });
                        }}
                      />
                    </div>
                    <label
                      htmlFor="emp-modal-aff-leader"
                      className="flex shrink-0 cursor-pointer items-center gap-2 border-s border-line px-3 py-2.5 text-sm text-ink"
                    >
                      <input
                        id="emp-modal-aff-leader"
                        type="checkbox"
                        checked={Boolean(empModal.affiliation_leader)}
                        onChange={(ev) =>
                          setEmpModal({
                            ...empModal,
                            affiliation_leader: ev.target.checked,
                          })
                        }
                        className="size-4 shrink-0 rounded border-line text-primary focus:ring-2 focus:ring-primary/30"
                        aria-label="מפקד שיוך"
                      />
                      מפקד
                    </label>
                  </div>
                </div>
              ) : null}
              <div className="form-row">
                <label className="text-sm font-semibold text-ink">הערות</label>
                <input
                  value={String(empModal.notes ?? "")}
                  onChange={(ev) => setEmpModal({ ...empModal, notes: ev.target.value })}
                />
              </div>
            </div>
            {saveEmpMut.isError ? (
              <p className="px-4 text-sm text-peach-4">
                {saveEmpMut.error instanceof Error
                  ? saveEmpMut.error.message
                  : String(saveEmpMut.error)}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
              <button
                type="button"
                className="rounded-pill border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-background"
                onClick={() => setEmpModal(null)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="rounded-pill bg-primary px-4 py-2 text-sm font-heading font-bold text-white hover:opacity-90 disabled:opacity-50"
                onClick={() => saveEmpMut.mutate(empModal)}
                disabled={saveEmpMut.isPending}
              >
                שמור
              </button>
            </div>
          </div>
        </div>
      )}

      {presetDraft && !rowIsSystemPreset(presetDraft) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => setPresetDraft(null)}
        >
          <div
            className="flex w-full max-w-md flex-col rounded-card border border-line bg-surface shadow-airy"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preset-modal-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 id="preset-modal-title" className="font-heading text-lg font-bold text-ink">
                {presetDraft.id ? "עריכת סילבוס" : "סילבוס חדש"}
              </h2>
              <button
                type="button"
                className="rounded-pill px-2 text-muted hover:bg-background hover:text-ink"
                onClick={() => setPresetDraft(null)}
              >
                ✕
              </button>
            </div>
            <div className="flex max-h-[min(70vh,480px)] flex-col gap-3 overflow-y-auto px-4 py-4">
              <div className="form-row mb-0">
                <label className="text-sm font-semibold text-ink">שם</label>
                <input
                  value={String(presetDraft.name ?? "")}
                  onChange={(e) => setPresetDraft({ ...presetDraft, name: e.target.value })}
                />
              </div>
              <div className="form-row mb-0">
                <label className="text-sm font-semibold text-ink">דרג מינימלי</label>
                <select
                  value={
                    presetDraft.min_role_id === "" || presetDraft.min_role_id == null
                      ? ""
                      : String(presetDraft.min_role_id)
                  }
                  onChange={(e) =>
                    setPresetDraft({
                      ...presetDraft,
                      min_role_id: e.target.value ? Number(e.target.value) : "",
                    })
                  }
                >
                  <option value="">—</option>
                  {roles.map((r) => (
                    <option key={String(r.id)} value={String(r.id)}>
                      {String(r.name)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="form-row mb-0">
                  <label className="text-sm font-semibold text-ink">משך (דק׳)</label>
                  <input
                    type="number"
                    min={1}
                    className="tabular-nums"
                    value={String(presetDraft.duration_minutes ?? 60)}
                    onChange={(e) =>
                      setPresetDraft({
                        ...presetDraft,
                        duration_minutes: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="form-row mb-0">
                  <label className="text-sm font-semibold text-ink">מקס׳ ברצף</label>
                  <input
                    type="number"
                    min={1}
                    className="tabular-nums"
                    value={String(presetDraft.max_in_row ?? 1)}
                    onChange={(e) =>
                      setPresetDraft({
                        ...presetDraft,
                        max_in_row: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                  />
                </div>
              </div>
              <div className="form-row mb-0">
                <label
                  className="text-sm font-semibold text-ink"
                  htmlFor="preset-modal-prep-mins"
                >
                  תדריך (דק׳)
                </label>
                <div className="flex w-full max-w-none overflow-hidden rounded-pill border border-line bg-surface shadow-sm">
                  <div className="relative min-w-0 flex-1">
                    <input
                      id="preset-modal-prep-mins"
                      type="number"
                      min={0}
                      value={String(presetDraft.prep_minutes ?? 0)}
                      onChange={(e) =>
                        setPresetDraft({
                          ...presetDraft,
                          prep_minutes: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <label
                    htmlFor="preset-modal-joint-prep"
                    className="flex shrink-0 cursor-pointer items-center gap-2 border-s border-line px-3 py-2.5 text-sm text-ink"
                  >
                    <input
                      id="preset-modal-joint-prep"
                      type="checkbox"
                      checked={Boolean(presetDraft.joint_prep)}
                      onChange={(e) =>
                        setPresetDraft({ ...presetDraft, joint_prep: e.target.checked })
                      }
                      className="size-4 shrink-0 rounded border-line text-primary focus:ring-2 focus:ring-primary/30"
                      aria-label="תדריך משותף"
                    />
                    משותף
                  </label>
                </div>
              </div>
              <div className="form-row mb-0">
                <label
                  className="text-sm font-semibold text-ink"
                  htmlFor="preset-modal-rest-mins"
                >
                  תחקיר (דק׳)
                </label>
                <div className="flex w-full max-w-none overflow-hidden rounded-pill border border-line bg-surface shadow-sm">
                  <div className="relative min-w-0 flex-1">
                    <input
                      id="preset-modal-rest-mins"
                      type="number"
                      min={0}
                      value={String(presetDraft.rest_minutes ?? 0)}
                      onChange={(e) =>
                        setPresetDraft({
                          ...presetDraft,
                          rest_minutes: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <label
                    htmlFor="preset-modal-joint-rest"
                    className="flex shrink-0 cursor-pointer items-center gap-2 border-s border-line px-3 py-2.5 text-sm text-ink"
                  >
                    <input
                      id="preset-modal-joint-rest"
                      type="checkbox"
                      checked={Boolean(presetDraft.joint_rest)}
                      onChange={(e) =>
                        setPresetDraft({ ...presetDraft, joint_rest: e.target.checked })
                      }
                      className="size-4 shrink-0 rounded border-line text-primary focus:ring-2 focus:ring-primary/30"
                      aria-label="תחקיר משותף"
                    />
                    משותף
                  </label>
                </div>
              </div>
              <div className="form-row mb-0">
                <label className="text-sm font-semibold text-ink">הערות</label>
                <input
                  value={String(presetDraft.notes ?? "")}
                  onChange={(e) => setPresetDraft({ ...presetDraft, notes: e.target.value })}
                />
              </div>
            </div>
            {savePresetMut.isError ? (
              <p className="px-4 text-sm text-peach-4">
                {savePresetMut.error instanceof Error
                  ? savePresetMut.error.message
                  : String(savePresetMut.error)}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
              <button
                type="button"
                className="rounded-pill border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-background"
                onClick={() => setPresetDraft(null)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="rounded-pill bg-primary px-4 py-2 text-sm font-heading font-bold text-white hover:opacity-90 disabled:opacity-50"
                onClick={() => savePresetMut.mutate()}
                disabled={savePresetMut.isPending}
              >
                שמור
              </button>
            </div>
          </div>
        </div>
      )}

      {roleDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => setRoleDraft(null)}
        >
          <div
            className="flex w-full max-w-md flex-col rounded-card border border-line bg-surface shadow-airy"
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-modal-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <PastelSwatchGridDropdown
                  value={String(roleDraft.color ?? DEFAULT_SHIFT_TYPE_PASTEL_HEX)}
                  onChange={(hex) => setRoleDraft({ ...roleDraft, color: hex })}
                  open={roleSwatchOpen}
                  onOpenChange={setRoleSwatchOpen}
                  trigger="dot"
                />
                <h2
                  id="role-modal-title"
                  className="min-w-0 font-heading text-lg font-bold text-ink"
                >
                  {roleDraft.id ? "עריכת דרג" : "דרג חדש"}
                </h2>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-pill px-2 text-muted hover:bg-background hover:text-ink"
                onClick={() => setRoleDraft(null)}
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <div className="form-row">
                <label className="text-sm font-semibold text-ink">שם</label>
                <input
                  value={String(roleDraft.name ?? "")}
                  onChange={(e) => setRoleDraft({ ...roleDraft, name: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label className="text-sm font-semibold text-ink">רמה</label>
                <input
                  type="number"
                  inputMode="numeric"
                  className="tabular-nums"
                  value={
                    roleDraft.role_level === undefined || roleDraft.role_level === ""
                      ? ""
                      : String(roleDraft.role_level)
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    setRoleDraft({
                      ...roleDraft,
                      role_level: v === "" ? "" : Number(v),
                    });
                  }}
                />
              </div>
            </div>
            {saveRoleMut.isError ? (
              <p className="px-4 text-sm text-peach-4">
                {saveRoleMut.error instanceof Error
                  ? saveRoleMut.error.message
                  : String(saveRoleMut.error)}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
              <button
                type="button"
                className="rounded-pill border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-background"
                onClick={() => setRoleDraft(null)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="rounded-pill bg-primary px-4 py-2 text-sm font-heading font-bold text-white hover:opacity-90 disabled:opacity-50"
                onClick={() => saveRoleMut.mutate()}
                disabled={saveRoleMut.isPending}
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
