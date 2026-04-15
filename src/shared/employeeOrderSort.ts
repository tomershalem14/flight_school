import type { JsonObject } from "./api";

function parseEmployeeKind(v: unknown): string {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (s === "admin" || s === "regular" || s === "extra" || s === "reserve") return s;
  return "regular";
}

function itemEmployeeId(row: JsonObject): number {
  return Number(row.employee_id ?? row.employeeId ?? 0);
}

function itemSortIndex(row: JsonObject): number {
  return Number(row.sort_index ?? row.sortIndex ?? 0);
}

export function itemHidden(row: JsonObject): boolean {
  const v = row.hidden ?? row.Hidden;
  if (v === true) return true;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "0" && v !== "";
  return false;
}

/** Rows from `get_employee_order_preset` → `items`. Employees with `hidden` are omitted when this preset is active. */
export function sortEmployeesByActivePreset(
  employees: JsonObject[],
  presetItems: JsonObject[] | null | undefined,
): JsonObject[] {
  if (!presetItems?.length) return [...employees];

  const hiddenIds = new Set<number>();
  const orderMap = new Map<number, number>();
  for (const row of presetItems) {
    const id = itemEmployeeId(row);
    if (itemHidden(row)) hiddenIds.add(id);
    orderMap.set(id, itemSortIndex(row));
  }

  const pool = employees.filter((e) => !hiddenIds.has(Number(e.id)));

  const regular = pool.filter((e) => parseEmployeeKind(e.employee_type) === "regular");
  const inPreset = regular.filter((e) => orderMap.has(Number(e.id)));
  const notInPreset = regular.filter((e) => !orderMap.has(Number(e.id)));

  inPreset.sort(
    (a, b) => (orderMap.get(Number(a.id)) ?? 0) - (orderMap.get(Number(b.id)) ?? 0),
  );

  const defaultPos = new Map(pool.map((e, i) => [Number(e.id), i]));
  notInPreset.sort(
    (a, b) => (defaultPos.get(Number(a.id)) ?? 0) - (defaultPos.get(Number(b.id)) ?? 0),
  );

  const orderedRegular = [...inPreset, ...notInPreset];
  const rid = new Set(orderedRegular.map((e) => Number(e.id)));
  return [...orderedRegular, ...pool.filter((e) => !rid.has(Number(e.id)))];
}

export function activePresetIdFromList(presets: JsonObject[]): number | null {
  for (const p of presets) {
    const v = p.is_active ?? p.isActive;
    if (v === true || v === 1 || v === "1") return Number(p.id);
  }
  return null;
}
