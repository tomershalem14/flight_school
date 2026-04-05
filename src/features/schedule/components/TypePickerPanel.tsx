import type { JsonObject } from "../../../shared/api";
import { typeId } from "../helpers/scheduleShiftModel";
import type { TypePickerState } from "../helpers/scheduleTypes";

export function TypePickerPanel({
  picker,
  onClose,
  typesAvailableForPicker,
  totalTypesCount,
  createIsPending,
  onPickShiftType,
}: {
  picker: TypePickerState;
  onClose: () => void;
  typesAvailableForPicker: JsonObject[];
  totalTypesCount: number;
  createIsPending: boolean;
  onPickShiftType: (shiftType: JsonObject) => void;
}) {
  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default bg-transparent"
        aria-label="סגור"
        onClick={onClose}
      />
      <div
        className="fixed z-50 max-h-[min(320px,70vh)] w-[280px] overflow-y-auto rounded-card border border-line bg-surface p-3 shadow-airy"
        style={{ top: picker.top, left: picker.left }}
        role="menu"
      >
        <div className="mb-2 border-b border-line pb-2 text-sm font-semibold text-ink">
          {picker.employeeName}
          <div className="text-xs font-normal text-muted">
            {picker.start} – {picker.end}
          </div>
        </div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">
          סוג משמרת
        </div>
        <ul className="mt-1 space-y-1">
          {typesAvailableForPicker.map((t) => {
            const tid = typeId(t);
            const col = String(t.color ?? "#7BA3B5");
            return (
              <li key={tid}>
                <button
                  type="button"
                  disabled={createIsPending}
                  className="flex w-full items-center gap-2 rounded-pill px-2 py-2 text-start text-sm hover:bg-background disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => onPickShiftType(t)}
                >
                  <span
                    className="size-3 shrink-0 rounded-pill"
                    style={{ backgroundColor: col }}
                  />
                  <span className="font-medium text-ink">{String(t.name)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {totalTypesCount === 0 && (
          <p className="text-sm text-muted">אין סוגי משמרת ליום זה.</p>
        )}
        {totalTypesCount > 0 && typesAvailableForPicker.length === 0 && (
          <p className="text-sm text-muted">הכל מאויש</p>
        )}
      </div>
    </>
  );
}
