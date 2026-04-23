import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import * as api from "../../shared/api";
import type { JsonObject } from "../../shared/api";
import { activePresetIdFromList, itemHidden } from "../../shared/employeeOrderSort";
import { errorMessageFromUnknown } from "../../shared/errorMessage";
import { DEFAULT_SHIFT_TYPE_PASTEL_HEX } from "../../shared/pastelPalette";
import { PastelSwatchGridDropdown } from "../../shared/PastelSwatchGridDropdown";
import { TimeInput24 } from "../../shared/TimeInput24";

/** Narrow column for two icon buttons (edit + deactivate). */
const ACTIONS_COL_CSS = "5.5rem";
const DATA_COL_CSS = `calc((100% - ${ACTIONS_COL_CSS}) / 5)`;
const SYLLABUS_DATA_COL = `calc((100% - ${ACTIONS_COL_CSS}) / 8)`;
/** Matches `size-8` + horizontal padding in star column (`px-2`). */
const ORDER_TAB_STAR_W = "3rem";
const ORDER_PRESET_NAME_COL = `calc(100% - ${ORDER_TAB_STAR_W} - ${ACTIONS_COL_CSS})`;
type ManagementTab = "employees" | "roles" | "syllabi" | "employee_orders" | "rules";

/** Placeholder copy for rules section dividers (replace per section when copy is ready). */
const RULES_SECTION_NOTES = {
  afterRest: "הגדרה של כמה זמן מנוחה מקבל מדריך בין טיסות ובין תחקירים לתדריכים, ההתייחסות היא למחמיר מביניהם.",
  afterWorkday: "הגדרה של מה יום העבודה הארוך ביותר שניתן להגדיר למדריך בשעות מתחילת אירוע ראשון ועד סוף אירוע אחרון.",
  afterTimes: "הגדרה של מה נחשב מוקדם ומה נחשב מאוחר. בשימוש לוידוא שמדריך לא מגיע מוקדם אחרי שהוא נשאר מאוחר, ובנוסף לאכיפת החוקים השבועיים.",
  footer: "הגדרה של מספר ימים בשבוע שמותר למדריך להגיע מוקדם, מאוחר או בשעות קצה בכלל.",
} as const;

const RULES_LABEL_CLASS =
  "max-w-[13rem] min-w-0 self-center text-right text-sm font-semibold text-ink";

type GlobalRulesDraft = {
  rest_between_shifts: number;
  rest_between_outer: number;
  /** Hours (API / server use hours on the wire; DB stores minutes). */
  max_workday: number;
  early_time: string;
  late_time: string;
  max_late_days: number;
  max_early_days: number;
  max_days_extreme: number;
};

const DEFAULT_GLOBAL_RULES: GlobalRulesDraft = {
  rest_between_shifts: 0,
  rest_between_outer: 0,
  max_workday: 12,
  early_time: "06:00",
  late_time: "22:00",
  max_late_days: 0,
  max_early_days: 0,
  max_days_extreme: 0,
};

/** Full-width note + bar (sibling of field grids, not inside a narrow grid). */
function RulesSectionDivider({ note }: { note: ReactNode }) {
  return (
    <div className="w-full min-w-0 space-y-2 pt-3" role="separator">
      <p className="text-xs leading-relaxed text-muted">{note}</p>
      <div className="h-[2px] w-full shrink-0 rounded-full bg-ink/25" aria-hidden />
    </div>
  );
}

/** Label + input rows, aligned to the inline-start edge (physical right under dir=rtl). */
function RulesFieldsGrid({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full min-w-0 justify-start">
      <div className="grid w-max max-w-full grid-cols-1 justify-items-start gap-y-2 sm:grid-cols-[minmax(0,13rem)_minmax(12rem,22rem)] sm:gap-x-8 sm:gap-y-3">
        {children}
      </div>
    </div>
  );
}

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

function mergeEmployeeOrderItemsForEdit(
  items: JsonObject[],
  activeRegularEmployees: JsonObject[],
): JsonObject[] {
  const bySort = [...items].sort(
    (a, b) => Number(a.sort_index ?? a.sortIndex ?? 0) - Number(b.sort_index ?? b.sortIndex ?? 0),
  );
  const seen = new Set(
    bySort.map((i) => Number(i.employee_id ?? i.employeeId ?? 0)),
  );
  const rows: JsonObject[] = bySort.map((i) => ({
    employee_id: Number(i.employee_id ?? i.employeeId),
    name: String(i.name ?? ""),
    role_name: String(i.role_name ?? i.roleName ?? ""),
    affiliation: i.affiliation != null ? String(i.affiliation).trim() : "",
    hidden: itemHidden(i),
  }));
  const defaultPos = new Map(
    activeRegularEmployees.map((e, idx) => [Number(e.id), idx]),
  );
  const extras = activeRegularEmployees
    .filter((e) => !seen.has(Number(e.id)))
    .sort(
      (a, b) =>
        (defaultPos.get(Number(a.id)) ?? 0) - (defaultPos.get(Number(b.id)) ?? 0),
    );
  for (const e of extras) {
    rows.push({
      employee_id: Number(e.id),
      name: String(e.name ?? ""),
      role_name: String(e.role_name ?? e.roleName ?? ""),
      affiliation: String(e.affiliation ?? "").trim(),
      hidden: false,
    });
  }
  return rows;
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

type SyllabusRoleDraftRow = {
  /** Stable `syllabus_roles.id` from API; omitted for newly added rows. */
  id?: number;
  name: string;
  role_id: number | "";
  special: string;
};

function normalizePresetDraftFromApi(p: JsonObject): JsonObject {
  const raw = p.syllabus_roles;
  let syllabus_roles: SyllabusRoleDraftRow[];
  if (Array.isArray(raw) && raw.length > 0) {
    syllabus_roles = raw.map((r) => {
      const ro = r as JsonObject;
      const rid = ro.role_id;
      const sid = ro.id;
      const row: SyllabusRoleDraftRow = {
        name: String(ro.name ?? ""),
        role_id:
          rid != null && rid !== "" && !Number.isNaN(Number(rid)) ? Number(rid) : "",
        special: String(ro.special ?? ""),
      };
      if (typeof sid === "number" && Number.isFinite(sid)) row.id = sid;
      return row;
    });
  } else {
    syllabus_roles = [{ name: "", role_id: "", special: "" }];
  }
  return { ...p, syllabus_roles };
}

function syllabusPresetRoleNamesLabel(p: JsonObject): string {
  const raw = p.syllabus_roles;
  if (!Array.isArray(raw)) return "—";
  const names: string[] = [];
  for (const r of raw) {
    const ro = r as JsonObject;
    const n = ro.name != null ? String(ro.name).trim() : "";
    if (n) names.push(n);
  }
  return names.length > 0 ? names.join(", ") : "—";
}

export function ManagementView() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<ManagementTab>("employees");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [empModal, setEmpModal] = useState<JsonObject | null>(null);
  const [roleDraft, setRoleDraft] = useState<JsonObject | null>(null);
  const [roleSwatchOpen, setRoleSwatchOpen] = useState(false);
  const [syllabusSearch, setSyllabusSearch] = useState("");
  const [presetDraft, setPresetDraft] = useState<JsonObject | null>(null);
  const [empOrderModal, setEmpOrderModal] = useState<
    | null
    | { phase: "create"; name: string; rows: JsonObject[] }
    | { phase: "edit"; presetId: number; name: string; rows: JsonObject[] }
  >(null);
  const [empOrderCreateSaving, setEmpOrderCreateSaving] = useState(false);
  const [rulesDraft, setRulesDraft] = useState<GlobalRulesDraft>(DEFAULT_GLOBAL_RULES);

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
  const activeRegularEmployees = useMemo(
    () =>
      employees.filter(
        (e) => rowIsActive(e) && parseEmployeeKind(e.employee_type) === "regular",
      ),
    [employees],
  );
  const syllabi = useMemo(() => syllabusRaw as JsonObject[], [syllabusRaw]);

  const { data: employeeOrdersRaw = [] } = useQuery({
    queryKey: ["employee_order_presets"],
    queryFn: () => api.listEmployeeOrderPresets(),
  });
  const employeeOrders = useMemo(
    () => employeeOrdersRaw as JsonObject[],
    [employeeOrdersRaw],
  );

  const globalRulesQuery = useQuery({
    queryKey: ["global_rules"],
    queryFn: () => api.getGlobalRules(),
    enabled: tab === "rules",
  });

  useEffect(() => {
    const g = globalRulesQuery.data;
    if (!g || tab !== "rules") return;
    setRulesDraft({
      rest_between_shifts: Number(g.rest_between_shifts ?? 0),
      rest_between_outer: Number(g.rest_between_outer ?? 0),
      max_workday: Number(g.max_workday ?? 12),
      early_time: String(g.early_time ?? "06:00").trim() || "06:00",
      late_time: String(g.late_time ?? "22:00").trim() || "22:00",
      max_late_days: Number(g.max_late_days ?? 0),
      max_early_days: Number(g.max_early_days ?? 0),
      max_days_extreme: Number(g.max_days_extreme ?? 0),
    });
  }, [globalRulesQuery.data, tab]);

  const saveGlobalRulesMut = useMutation({
    mutationFn: (payload: GlobalRulesDraft) =>
      api.setGlobalRules({
        rest_between_shifts: Math.trunc(payload.rest_between_shifts),
        rest_between_outer: Math.trunc(payload.rest_between_outer),
        max_workday: Number(payload.max_workday),
        early_time: payload.early_time.trim(),
        late_time: payload.late_time.trim(),
        max_late_days: Math.trunc(payload.max_late_days),
        max_early_days: Math.trunc(payload.max_early_days),
        max_days_extreme: Math.trunc(payload.max_days_extreme),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["global_rules"] });
    },
  });

  const activeEmployeeOrderPresetId = useMemo(
    () => activePresetIdFromList(employeeOrders),
    [employeeOrders],
  );

  const syllabusFiltered = useMemo(() => {
    const q = syllabusSearch.trim().toLowerCase();
    if (!q) return syllabi;
    return syllabi.filter((p) => String(p.name ?? "").toLowerCase().includes(q));
  }, [syllabi, syllabusSearch]);

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

  const total = filtered.length;
  const syllabusTotal = syllabusFiltered.length;

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
      const segs = presetDraft.syllabus_roles as JsonObject[] | undefined;
      const syllabus_roles = Array.isArray(segs)
        ? segs.map((r) => {
            const ro = r as JsonObject;
            const out: {
              id?: number;
              name: string;
              role_id: number | null;
              special: string;
            } = {
              name: String(ro.name ?? ""),
              role_id: ro.role_id === "" || ro.role_id == null ? null : Number(ro.role_id),
              special: String(ro.special ?? ""),
            };
            if (typeof ro.id === "number" && Number.isFinite(ro.id)) out.id = ro.id;
            return out;
          })
        : [{ name: "", role_id: null as number | null, special: "" }];
      const body: JsonObject = {
        name,
        duration_minutes: Number(presetDraft.duration_minutes ?? 60),
        prep_minutes: Number(presetDraft.prep_minutes ?? 0),
        rest_minutes: Number(presetDraft.rest_minutes ?? 0),
        max_in_row: maxInRow,
        joint_prep: Boolean(presetDraft.joint_prep),
        joint_rest: Boolean(presetDraft.joint_rest),
        notes: String(presetDraft.notes ?? "").trim() || null,
        syllabus_roles,
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
      deletePresetMut.reset();
    },
  });

  const setEmployeeOrderActiveMut = useMutation({
    mutationFn: (presetId: number | null) => api.setEmployeeOrderActive(presetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee_order_presets"] });
      qc.invalidateQueries({ queryKey: ["employee_order_preset"] });
    },
  });

  const updateEmployeeOrderMut = useMutation({
    mutationFn: (args: {
      presetId: number;
      name: string;
      items: { employee_id: number; hidden: boolean }[];
    }) =>
      api.updateEmployeeOrderPreset(args.presetId, {
        name: args.name,
        items: args.items,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee_order_presets"] });
      qc.invalidateQueries({ queryKey: ["employee_order_preset"] });
      setEmpOrderModal(null);
    },
    onError: (err) => {
      alert(errorMessageFromUnknown(err));
    },
  });

  const deleteEmployeeOrderMut = useMutation({
    mutationFn: (pid: number) => api.deleteEmployeeOrderPreset(pid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee_order_presets"] });
      qc.invalidateQueries({ queryKey: ["employee_order_preset"] });
    },
    onError: (err) => {
      alert(errorMessageFromUnknown(err));
    },
  });

  async function openEmployeeOrderEdit(presetId: number) {
    try {
      const detail = await api.getEmployeeOrderPreset(presetId);
      const items = (detail.items as JsonObject[] | undefined) ?? [];
      const rows = mergeEmployeeOrderItemsForEdit(items, activeRegularEmployees);
      setEmpOrderModal({
        phase: "edit",
        presetId,
        name: String(detail.name ?? ""),
        rows,
      });
    } catch (e) {
      alert(errorMessageFromUnknown(e));
    }
  }

  useEffect(() => {
    if (!empOrderModal) setEmpOrderCreateSaving(false);
  }, [empOrderModal]);

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

  return (
    <div
      id="app"
      className="flex min-h-0 min-w-0 w-full max-w-none flex-1 flex-col bg-background"
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
              <button
                type="button"
                role="tab"
                aria-selected={tab === "employee_orders"}
                className={`border-b-2 pb-1.5 text-sm font-heading font-semibold leading-none transition-colors ${
                  tab === "employee_orders"
                    ? "border-primary text-primary"
                    : "border-line text-muted hover:border-primary/50 hover:text-primary"
                }`}
                onClick={() => setTab("employee_orders")}
              >
               סידור מטריצה
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "rules"}
                className={`border-b-2 pb-1.5 text-sm font-heading font-semibold leading-none transition-colors ${
                  tab === "rules"
                    ? "border-primary text-primary"
                    : "border-line text-muted hover:border-primary/50 hover:text-primary"
                }`}
                onClick={() => setTab("rules")}
              >
                כללים
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
            ) : tab === "syllabi" ? (
              <button
                type="button"
                className="rounded-pill bg-primary px-3 py-1.5 text-sm font-heading font-bold text-white shadow-sm hover:opacity-90"
                onClick={() =>
                  setPresetDraft({
                    name: "",
                    duration_minutes: 60,
                    prep_minutes: 30,
                    rest_minutes: 45,
                    max_in_row: 2,
                    joint_prep: true,
                    joint_rest: false,
                    notes: "",
                    syllabus_roles: [{ name: "", role_id: "", special: "" } satisfies SyllabusRoleDraftRow],
                  })
                }
              >
                + סילבוס
              </button>
            ) : tab === "employee_orders" ? (
              <button
                type="button"
                className="rounded-pill bg-primary px-3 py-1.5 text-sm font-heading font-bold text-white shadow-sm hover:opacity-90"
                onClick={() =>
                  setEmpOrderModal({
                    phase: "create",
                    name: "",
                    rows: mergeEmployeeOrderItemsForEdit([], activeRegularEmployees),
                  })
                }
              >
                + סדר
              </button>
            ) : null}
        </div>
      </header>

      <div className="min-h-0 min-w-0 w-full max-w-none flex-1 overflow-auto p-4">
        <div className="flex w-full min-w-0 max-w-none flex-col gap-4">
        {tab === "employees" && (
          <div className="flex flex-col gap-4">
            <div className="flex w-full max-w-none overflow-hidden rounded-pill border border-line bg-surface shadow-sm">
              <div className="pill-input-sleeve">
                <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted">
                  ⌕
                </span>
                <input
                  id="mgmt-emp-search"
                  className="input-toolbar-pill input-toolbar-pill--search"
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
                    {filtered.map((e) => {
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
              <div className="border-t border-line px-4 py-3 text-xs text-muted">
                <span className="uppercase tracking-wide">
                  {total} מפעילים
                </span>
              </div>
            </div>
          </div>
        )}

        {tab === "syllabi" && (
          <div className="flex flex-col gap-4">
            {deletePresetMut.isError ? (
              <p className="rounded-card border border-peach-3/50 bg-peach-1/40 px-3 py-2 text-sm text-ink">
                {deletePresetMut.error instanceof Error
                  ? deletePresetMut.error.message
                  : String(deletePresetMut.error)}
              </p>
            ) : null}
            <div className="flex w-full max-w-none overflow-hidden rounded-pill border border-line bg-surface shadow-sm">
              <div className="pill-input-sleeve">
                <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted">
                  ⌕
                </span>
                <input
                  type="search"
                  className="input-toolbar-pill input-toolbar-pill--search"
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
                        תפקידים
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
                    {syllabusFiltered.map((p) => {
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
                          <td
                            className="min-w-0 truncate px-2 py-3 text-ink"
                            title={syllabusPresetRoleNamesLabel(p)}
                          >
                            {syllabusPresetRoleNamesLabel(p)}
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
                                  onClick={() =>
                                    setPresetDraft(normalizePresetDraftFromApi({ ...p }))
                                  }
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
              <div className="border-t border-line px-4 py-3 text-xs text-muted">
                <span className="uppercase tracking-wide">
                  {syllabusTotal} סילבוסים
                </span>
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

        {tab === "employee_orders" && (
          <div className="overflow-hidden rounded-card border border-line bg-surface shadow-airy">
            <div className="overflow-x-auto">
              <table className="table-fixed w-full border-collapse text-start text-sm">
                <colgroup>
                  <col style={{ width: ORDER_PRESET_NAME_COL }} />
                  <col style={{ width: ORDER_TAB_STAR_W }} />
                  <col style={{ width: ACTIONS_COL_CSS }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-line bg-background/60">
                    <th className="min-w-0 px-4 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                      שם
                    </th>
                    <th className="min-w-0 px-2 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                      פעיל
                    </th>
                    <th className="px-1 py-3 font-heading text-xs font-bold uppercase tracking-wide text-muted">
                      פעולות
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line bg-background/20 hover:bg-background/40">
                    <td className="min-w-0 px-4 py-3 text-start font-medium text-ink">
                      ברירת מחדל
                    </td>
                    <td className="px-2 py-3">
                      <button
                        type="button"
                        className={`inline-flex size-8 shrink-0 items-center justify-center text-2xl leading-none transition-opacity hover:opacity-80 disabled:opacity-40 ${
                          activeEmployeeOrderPresetId == null
                            ? "text-primary"
                            : "text-muted"
                        }`}
                        aria-label="קבע כסדר פעיל"
                        disabled={setEmployeeOrderActiveMut.isPending}
                        onClick={() => setEmployeeOrderActiveMut.mutate(null)}
                      >
                        {activeEmployeeOrderPresetId == null ? "★" : "☆"}
                      </button>
                    </td>
                    <td className="px-1 py-3 text-center text-muted">—</td>
                  </tr>
                  {employeeOrders.map((p) => {
                    const pid = Number(p.id);
                    const nm = String(p.name ?? "");
                    const isActiveRow =
                      activeEmployeeOrderPresetId != null &&
                      activeEmployeeOrderPresetId === pid;
                    return (
                      <tr
                        key={pid}
                        className="border-b border-line last:border-0 hover:bg-background/40"
                      >
                        <td className="min-w-0 px-4 py-3 text-start font-medium text-ink">
                          {nm}
                        </td>
                        <td className="px-2 py-3">
                          <button
                            type="button"
                            className={`inline-flex size-8 shrink-0 items-center justify-center text-2xl leading-none transition-opacity hover:opacity-80 disabled:opacity-40 ${
                              isActiveRow ? "text-primary" : "text-muted"
                            }`}
                            aria-label="קבע כסדר פעיל"
                            disabled={setEmployeeOrderActiveMut.isPending}
                            onClick={() => setEmployeeOrderActiveMut.mutate(pid)}
                          >
                            {isActiveRow ? "★" : "☆"}
                          </button>
                        </td>
                        <td className="px-1 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-background text-ink hover:bg-background/80"
                              aria-label="ערוך סדר"
                              onClick={() => void openEmployeeOrderEdit(pid)}
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
                              aria-label="מחק סדר"
                              disabled={deleteEmployeeOrderMut.isPending}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `למחוק את הסדר «${nm}»? פעולה זו אינה הפיכה.`,
                                  )
                                )
                                  return;
                                deleteEmployeeOrderMut.mutate(pid);
                              }}
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
                                  d="M5 12h14"
                                />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "rules" && (
          <div
            className="w-full min-w-0 overflow-hidden rounded-card border border-line bg-surface p-6 text-start shadow-airy"
            dir="rtl"
          >
            {globalRulesQuery.isPending ? (
              <p className="text-sm text-muted">טוען…</p>
            ) : globalRulesQuery.isError ? (
              <p className="text-sm text-peach-4">
                {errorMessageFromUnknown(globalRulesQuery.error)}
              </p>
            ) : (
              <form
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveGlobalRulesMut.mutate(rulesDraft);
                }}
              >
                <RulesFieldsGrid>
                  <label className={RULES_LABEL_CLASS} htmlFor="rule-rest-between">
                    מנוחה בין משמרות (דקות)
                  </label>
                  <input
                    id="rule-rest-between"
                    type="number"
                    min={0}
                    step={1}
                    className="w-full max-w-md"
                    value={
                      Number.isFinite(rulesDraft.rest_between_shifts)
                        ? rulesDraft.rest_between_shifts
                        : 0
                    }
                    onChange={(e) =>
                      setRulesDraft((d) => ({
                        ...d,
                        rest_between_shifts: Number(e.target.value) || 0,
                      }))
                    }
                  />
                  <label className={RULES_LABEL_CLASS} htmlFor="rule-rest-between-outer">
                    מנוחה בין תחקיר לתדריך (דקות)
                  </label>
                  <input
                    id="rule-rest-between-outer"
                    type="number"
                    min={0}
                    step={1}
                    className="w-full max-w-md"
                    value={
                      Number.isFinite(rulesDraft.rest_between_outer)
                        ? rulesDraft.rest_between_outer
                        : 0
                    }
                    onChange={(e) =>
                      setRulesDraft((d) => ({
                        ...d,
                        rest_between_outer: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </RulesFieldsGrid>
                <RulesSectionDivider note={RULES_SECTION_NOTES.afterRest} />
                <RulesFieldsGrid>
                  <label className={RULES_LABEL_CLASS} htmlFor="rule-max-workday">
                    יום עבודה מקסימלי (שעות)
                  </label>
                  <input
                    id="rule-max-workday"
                    type="number"
                    min={0}
                    step="any"
                    className="w-full max-w-md"
                    value={Number.isFinite(rulesDraft.max_workday) ? rulesDraft.max_workday : 0}
                    onChange={(e) =>
                      setRulesDraft((d) => ({
                        ...d,
                        max_workday: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </RulesFieldsGrid>
                <RulesSectionDivider note={RULES_SECTION_NOTES.afterWorkday} />
                <RulesFieldsGrid>
                  <label className={RULES_LABEL_CLASS} htmlFor="rule-early-time">
                    שעה מוקדמת
                  </label>
                  <TimeInput24
                    id="rule-early-time"
                    className="w-full max-w-md"
                    dir="ltr"
                    value={(rulesDraft.early_time || "00:00").slice(0, 5)}
                    onChange={(v) => setRulesDraft((d) => ({ ...d, early_time: v }))}
                  />
                  <label className={RULES_LABEL_CLASS} htmlFor="rule-late-time">
                    שעה מאוחרת
                  </label>
                  <TimeInput24
                    id="rule-late-time"
                    className="w-full max-w-md"
                    dir="ltr"
                    value={(rulesDraft.late_time || "00:00").slice(0, 5)}
                    onChange={(v) => setRulesDraft((d) => ({ ...d, late_time: v }))}
                  />
                </RulesFieldsGrid>
                <RulesSectionDivider note={RULES_SECTION_NOTES.afterTimes} />
                <RulesFieldsGrid>
                  <label className={RULES_LABEL_CLASS} htmlFor="rule-max-late-days">
                    מקסימום ימים מאוחרים
                  </label>
                  <input
                    id="rule-max-late-days"
                    type="number"
                    min={0}
                    step={1}
                    className="w-full max-w-md"
                    value={Number.isFinite(rulesDraft.max_late_days) ? rulesDraft.max_late_days : 0}
                    onChange={(e) =>
                      setRulesDraft((d) => ({
                        ...d,
                        max_late_days: Number(e.target.value) || 0,
                      }))
                    }
                  />
                  <label className={RULES_LABEL_CLASS} htmlFor="rule-max-early-days">
                    מקסימום ימים מוקדמים
                  </label>
                  <input
                    id="rule-max-early-days"
                    type="number"
                    min={0}
                    step={1}
                    className="w-full max-w-md"
                    value={
                      Number.isFinite(rulesDraft.max_early_days) ? rulesDraft.max_early_days : 0
                    }
                    onChange={(e) =>
                      setRulesDraft((d) => ({
                        ...d,
                        max_early_days: Number(e.target.value) || 0,
                      }))
                    }
                  />
                  <label className={RULES_LABEL_CLASS} htmlFor="rule-max-days-extreme">
                    מקסימום ימים בשעות קצה
                  </label>
                  <input
                    id="rule-max-days-extreme"
                    type="number"
                    min={0}
                    step={1}
                    className="w-full max-w-md"
                    value={
                      Number.isFinite(rulesDraft.max_days_extreme)
                        ? rulesDraft.max_days_extreme
                        : 0
                    }
                    onChange={(e) =>
                      setRulesDraft((d) => ({
                        ...d,
                        max_days_extreme: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </RulesFieldsGrid>
                <RulesSectionDivider note={RULES_SECTION_NOTES.footer} />
                {saveGlobalRulesMut.isError ? (
                  <p className="text-sm text-peach-4">
                    {errorMessageFromUnknown(saveGlobalRulesMut.error)}
                  </p>
                ) : null}
                <div className="flex w-full justify-start pt-1">
                  <button
                    type="submit"
                    className="rounded-pill bg-primary px-4 py-2 text-sm font-heading font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                    disabled={saveGlobalRulesMut.isPending}
                  >
                    שמירה
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
        </div>
      </div>

      {empOrderModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => setEmpOrderModal(null)}
        >
          <div
            className="flex w-full max-w-2xl flex-col rounded-card border border-line bg-surface shadow-airy"
            role="dialog"
            aria-modal="true"
            onClick={(ev) => ev.stopPropagation()}
          >
            <>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="font-heading text-lg font-bold text-ink">
                  {empOrderModal.phase === "create" ? "סדר חדש" : "עריכת סדר"}
                </h2>
                <button
                  type="button"
                  className="rounded-pill px-2 text-muted hover:bg-background hover:text-ink"
                  onClick={() => setEmpOrderModal(null)}
                >
                  ✕
                </button>
              </div>
              <div className="flex max-h-[min(75vh,520px)] flex-col gap-3 overflow-y-auto px-4 py-4">
                <div className="form-row mb-0">
                  <label className="text-sm font-semibold text-ink">שם</label>
                  <input
                    value={empOrderModal.name}
                    onChange={(e) =>
                      setEmpOrderModal({ ...empOrderModal, name: e.target.value })
                    }
                    placeholder={
                      empOrderModal.phase === "create"
                        ? "אופציונלי — אם ריק יישמר כ״סדר חדש״"
                        : undefined
                    }
                  />
                </div>
                <div className="overflow-hidden rounded-card border border-line bg-background/50">
                  <table className="w-full border-collapse text-center text-sm">
                    <thead>
                      <tr className="border-b border-line bg-background/60">
                        <th className="px-2 py-2 text-center text-xs font-bold uppercase tracking-wide text-muted">
                          מפעיל
                        </th>
                        <th className="px-2 py-2 text-center text-xs font-bold uppercase tracking-wide text-muted">
                          דרג
                        </th>
                        <th className="px-2 py-2 text-center text-xs font-bold uppercase tracking-wide text-muted">
                          שיוך
                        </th>
                        <th className="w-14 px-1 py-2 text-center text-xs font-bold uppercase tracking-wide text-muted">
                          מוסתר
                        </th>
                        <th className="w-20 px-1 py-2 text-center text-xs font-bold uppercase tracking-wide text-muted">
                          סדר
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {empOrderModal.rows.map((row, idx) => (
                        <tr
                          key={Number(row.employee_id)}
                          className={`border-b border-line ${
                            Boolean(row.hidden) ? "bg-muted/10 opacity-80" : ""
                          }`}
                        >
                          <td className="px-2 py-2 text-center text-ink">
                            {String(row.name ?? "")}
                          </td>
                          <td className="px-2 py-2 text-center text-ink">
                            {String(row.role_name ?? "")}
                          </td>
                          <td className="px-2 py-2 text-center text-ink">
                            {String(row.affiliation ?? "") || "—"}
                          </td>
                          <td className="px-1 py-2 text-center">
                            <button
                              type="button"
                              className={`mx-auto flex size-8 items-center justify-center rounded-md border border-line/80 bg-surface shadow-sm transition-all hover:border-primary/45 hover:bg-primary/8 active:scale-95 disabled:pointer-events-none disabled:opacity-35 ${
                                Boolean(row.hidden) ? "text-muted" : "text-ink"
                              }`}
                              title={
                                Boolean(row.hidden)
                                  ? "מוסתר בלוח — לחץ להצגה"
                                  : "גלוי בלוח — לחץ להסתרה"
                              }
                              aria-label={
                                Boolean(row.hidden)
                                  ? "הצג מפעיל בלוח כשהסדר פעיל"
                                  : "הסתר מפעיל בלוח כשהסדר פעיל"
                              }
                              disabled={
                                updateEmployeeOrderMut.isPending || empOrderCreateSaving
                              }
                              onClick={() => {
                                const next = empOrderModal.rows.map((r, i) =>
                                  i === idx ? { ...r, hidden: !Boolean(r.hidden) } : r,
                                );
                                setEmpOrderModal({ ...empOrderModal, rows: next });
                              }}
                            >
                              {Boolean(row.hidden) ? (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={1.5}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="size-[18px]"
                                  aria-hidden
                                >
                                  <path d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.242 15.053 6.68 17.25 10.5 17.25c.922 0 1.818-.11 2.674-.312M6.228 6.228A10.45 10.45 0 0 1 12 5c4.756 0 8.773 3.162 10.065 7.498M17.742 17.742 21 21M3 3l18 18M9.88 9.88A3 3 0 0 0 12 15a3 3 0 0 0 2.12-5.12" />
                                </svg>
                              ) : (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={1.5}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="size-[18px]"
                                  aria-hidden
                                >
                                  <path d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 5 12 5c4.638 0 8.573 2.607 9.963 6.034a1.01 1.01 0 0 1 0 .639c-1.39 3.427-5.325 6.034-9.963 6.034-4.639 0-8.574-2.607-9.963-6.034z" />
                                  <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                                </svg>
                              )}
                            </button>
                          </td>
                          <td className="px-1 py-2 text-center">
                            <div className="flex flex-row items-center justify-center gap-0.5">
                              <button
                                type="button"
                                className="inline-flex size-7 items-center justify-center rounded-md border border-line/80 bg-surface text-muted shadow-sm transition-all hover:border-primary/45 hover:bg-primary/8 hover:text-primary active:scale-95 disabled:pointer-events-none disabled:opacity-35"
                                aria-label="הזז למעלה"
                                disabled={
                                  idx === 0 ||
                                  updateEmployeeOrderMut.isPending ||
                                  empOrderCreateSaving
                                }
                                onClick={() => {
                                  if (idx === 0) return;
                                  const next = [...empOrderModal.rows];
                                  [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                  setEmpOrderModal({ ...empOrderModal, rows: next });
                                }}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="size-3.5"
                                  aria-hidden
                                >
                                  <path d="M18 15l-6-6-6 6" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="inline-flex size-7 items-center justify-center rounded-md border border-line/80 bg-surface text-muted shadow-sm transition-all hover:border-primary/45 hover:bg-primary/8 hover:text-primary active:scale-95 disabled:pointer-events-none disabled:opacity-35"
                                aria-label="הזז למטה"
                                disabled={
                                  idx >= empOrderModal.rows.length - 1 ||
                                  updateEmployeeOrderMut.isPending ||
                                  empOrderCreateSaving
                                }
                                onClick={() => {
                                  if (idx >= empOrderModal.rows.length - 1) return;
                                  const next = [...empOrderModal.rows];
                                  [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                  setEmpOrderModal({ ...empOrderModal, rows: next });
                                }}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="size-3.5"
                                  aria-hidden
                                >
                                  <path d="M6 9l6 6 6-6" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
                  <button
                    type="button"
                    className="rounded-pill border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-background"
                    onClick={() => setEmpOrderModal(null)}
                  >
                    ביטול
                  </button>
                  <button
                    type="button"
                    className="rounded-pill bg-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
                    disabled={
                      updateEmployeeOrderMut.isPending || empOrderCreateSaving
                    }
                    onClick={async () => {
                      const nameTrim = empOrderModal.name.trim();
                      const itemsPayload = empOrderModal.rows.map((r) => ({
                        employee_id: Number(r.employee_id),
                        hidden: Boolean(r.hidden),
                      }));

                      if (empOrderModal.phase === "create") {
                        const createName = nameTrim || "סדר חדש";
                        setEmpOrderCreateSaving(true);
                        try {
                          const r = await api.createEmployeeOrderPreset(createName);
                          const id = Number(r.id);
                          await api.updateEmployeeOrderPreset(id, {
                            name: nameTrim || createName,
                            items: itemsPayload,
                          });
                          await qc.invalidateQueries({
                            queryKey: ["employee_order_presets"],
                          });
                          await qc.invalidateQueries({
                            queryKey: ["employee_order_preset"],
                          });
                          setEmpOrderModal(null);
                        } catch (e) {
                          alert(errorMessageFromUnknown(e));
                        } finally {
                          setEmpOrderCreateSaving(false);
                        }
                        return;
                      }

                      if (!nameTrim) {
                        alert("נא להזין שם");
                        return;
                      }
                      updateEmployeeOrderMut.mutate({
                        presetId: empOrderModal.presetId,
                        name: nameTrim,
                        items: itemsPayload,
                      });
                    }}
                  >
                    שמור
                  </button>
                </div>
              </div>
            </>
          </div>
        </div>
      ) : null}

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
                    <div className="pill-input-sleeve">
                      <input
                        id="emp-modal-affiliation"
                        className="input-toolbar-pill"
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
            className="flex w-full max-w-2xl flex-col rounded-card border border-line bg-surface shadow-airy"
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
                  <div className="pill-input-sleeve">
                    <input
                      id="preset-modal-prep-mins"
                      className="input-toolbar-pill tabular-nums"
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
                  <div className="pill-input-sleeve">
                    <input
                      id="preset-modal-rest-mins"
                      className="input-toolbar-pill tabular-nums"
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

              <div className="rounded-card border border-line bg-background/50 px-3 py-2">
                <div className="mb-2 text-sm font-semibold text-ink">תפקידי סילבוס</div>
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 border-b border-line pb-2 text-xs font-bold uppercase tracking-wide text-muted">
                  <span className="min-w-0">שם</span>
                  <span className="min-w-0">דרג</span>
                  <span className="min-w-0">מיוחד</span>
                </div>
                <div className="mt-2 space-y-2">
                  {(
                    (presetDraft.syllabus_roles as SyllabusRoleDraftRow[] | undefined) ?? [
                      { name: "", role_id: "", special: "" },
                    ]
                  ).map((row, idx) => (
                    <div
                      key={row.id != null ? `preset-sr-${row.id}` : `preset-sr-new-${idx}`}
                      className="grid grid-cols-[1fr_1fr_1fr] items-end gap-2"
                    >
                      <input
                        className="min-w-0"
                        value={row.name}
                        onChange={(e) => {
                          const rows = [
                            ...(((presetDraft.syllabus_roles as SyllabusRoleDraftRow[]) ?? [
                              { name: "", role_id: "", special: "" },
                            ]) as SyllabusRoleDraftRow[]),
                          ];
                          rows[idx] = { ...rows[idx], name: e.target.value };
                          setPresetDraft({ ...presetDraft, syllabus_roles: rows });
                        }}
                      />
                      <select
                        className="min-w-0"
                        value={row.role_id === "" ? "" : String(row.role_id)}
                        onChange={(e) => {
                          const rows = [
                            ...(((presetDraft.syllabus_roles as SyllabusRoleDraftRow[]) ?? [
                              { name: "", role_id: "", special: "" },
                            ]) as SyllabusRoleDraftRow[]),
                          ];
                          const v = e.target.value;
                          rows[idx] = {
                            ...rows[idx],
                            role_id: v ? Number(v) : "",
                          };
                          setPresetDraft({ ...presetDraft, syllabus_roles: rows });
                        }}
                      >
                        <option value="">—</option>
                        {roles.map((r) => (
                          <option key={String(r.id)} value={String(r.id)}>
                            {String(r.name)}
                          </option>
                        ))}
                      </select>
                      <input
                        className="min-w-0"
                        value={row.special}
                        onChange={(e) => {
                          const rows = [
                            ...(((presetDraft.syllabus_roles as SyllabusRoleDraftRow[]) ?? [
                              { name: "", role_id: "", special: "" },
                            ]) as SyllabusRoleDraftRow[]),
                          ];
                          rows[idx] = { ...rows[idx], special: e.target.value };
                          setPresetDraft({ ...presetDraft, syllabus_roles: rows });
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-pill border border-line bg-background px-3 py-1.5 text-sm font-semibold text-ink hover:border-primary/40"
                    onClick={() => {
                      const rows = [
                        ...(((presetDraft.syllabus_roles as SyllabusRoleDraftRow[]) ?? [
                          { name: "", role_id: "", special: "" },
                        ]) as SyllabusRoleDraftRow[]),
                      ];
                      rows.push({ name: "", role_id: "", special: "" });
                      setPresetDraft({ ...presetDraft, syllabus_roles: rows });
                    }}
                  >
                    + הוסף תפקיד
                  </button>
                  {(
                    (presetDraft.syllabus_roles as SyllabusRoleDraftRow[] | undefined) ?? []
                  ).length > 1 ? (
                    <button
                      type="button"
                      className="rounded-pill border border-line px-3 py-1.5 text-sm text-muted hover:bg-peach-1/30"
                      onClick={() => {
                        const rows = [
                          ...(((presetDraft.syllabus_roles as SyllabusRoleDraftRow[]) ?? [
                            { name: "", role_id: "", special: "" },
                          ]) as SyllabusRoleDraftRow[]),
                        ];
                        setPresetDraft({
                          ...presetDraft,
                          syllabus_roles: rows.slice(0, -1),
                        });
                      }}
                    >
                      הסר שורה אחרונה
                    </button>
                  ) : null}
                </div>
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
