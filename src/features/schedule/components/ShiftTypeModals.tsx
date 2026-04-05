import type { UseMutationResult } from "@tanstack/react-query";
import type { RefObject } from "react";
import type { JsonObject } from "../../../shared/api";
import { DEFAULT_SHIFT_TYPE_PASTEL_HEX } from "../../../shared/pastelPalette";
import { PastelSwatchGridDropdown } from "../../../shared/PastelSwatchGridDropdown";
import { coverageIsoFromDayAndHm } from "../../../shared/timeFormat";
import { buildShiftWindowPayload } from "../helpers/scheduleShiftModel";
import { ShiftWindowDraftFormFields } from "./ShiftWindowDraftFormFields";

export function ShiftTypeEditorModal({
  shiftTypeDraft,
  setShiftTypeDraft,
  presets,
  dateStr,
  shiftTypeModalBodyRef,
  swatchMenuOpen,
  setSwatchMenuOpen,
  shiftTypeTimeError,
  setShiftTypeTimeError,
  createShiftWindowMut,
  updateShiftWindowMut,
  onClose,
  onRequestDelete,
}: {
  shiftTypeDraft: JsonObject;
  setShiftTypeDraft: (v: JsonObject | null) => void;
  presets: JsonObject[];
  dateStr: string;
  shiftTypeModalBodyRef: RefObject<HTMLDivElement | null>;
  swatchMenuOpen: boolean;
  setSwatchMenuOpen: (v: boolean) => void;
  shiftTypeTimeError: string | null;
  setShiftTypeTimeError: (v: string | null) => void;
  createShiftWindowMut: UseMutationResult<unknown, Error, JsonObject, unknown>;
  updateShiftWindowMut: UseMutationResult<
    unknown,
    Error,
    { id: number; payload: JsonObject },
    unknown
  >;
  onClose: () => void;
  onRequestDelete: (id: number, name: string) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shift-type-modal-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(90vh,640px)] w-full max-w-lg flex-col rounded-card border border-line bg-surface shadow-airy"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <PastelSwatchGridDropdown
              value={String(shiftTypeDraft.color ?? DEFAULT_SHIFT_TYPE_PASTEL_HEX)}
              onChange={(hex) => setShiftTypeDraft({ ...shiftTypeDraft, color: hex })}
              open={swatchMenuOpen}
              onOpenChange={setSwatchMenuOpen}
              trigger="dot"
            />
            <h3
              id="shift-type-modal-title"
              className="min-w-0 font-heading text-lg font-bold text-ink"
            >
              {Number(shiftTypeDraft.id) > 0 ? "עריכת חלון" : "סוג משמרת חדש"}
            </h3>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-pill px-2 text-muted hover:bg-background hover:text-ink"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div
          ref={shiftTypeModalBodyRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
        >
          <ShiftWindowDraftFormFields
            draft={shiftTypeDraft}
            setDraft={(next) => setShiftTypeDraft(next)}
            presets={presets}
            dateStr={dateStr}
            shiftTypeTimeError={shiftTypeTimeError}
            setShiftTypeTimeError={setShiftTypeTimeError}
            scrollContainerRef={shiftTypeModalBodyRef}
            saveErrorMessage={
              createShiftWindowMut.isError
                ? String(
                    (createShiftWindowMut.error as Error)?.message ??
                      createShiftWindowMut.error,
                  )
                : updateShiftWindowMut.isError
                  ? String(
                      (updateShiftWindowMut.error as Error)?.message ??
                        updateShiftWindowMut.error,
                    )
                  : null
            }
          />
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            className="rounded-pill border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-background"
            onClick={onClose}
          >
            ביטול
          </button>
          {Number(shiftTypeDraft.id) > 0 ? (
            <button
              type="button"
              className="rounded-pill border border-peach-3/60 bg-peach-1/50 px-4 py-2 text-sm font-semibold text-ink hover:bg-peach-1/70"
              onClick={() => {
                const id = Number(shiftTypeDraft.id);
                const name = String(shiftTypeDraft.name ?? "");
                setShiftTypeDraft(null);
                onRequestDelete(id, name);
              }}
            >
              מחק
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-pill bg-primary px-4 py-2 text-sm font-heading font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            disabled={
              createShiftWindowMut.isPending ||
              updateShiftWindowMut.isPending ||
              !String(shiftTypeDraft.name ?? "").trim()
            }
            onClick={() => {
              const d = shiftTypeDraft;
              const startHm = String(d.coverage_start_time ?? "06:00");
              const endHm = String(d.coverage_end_time ?? "21:00");
              const covStart = coverageIsoFromDayAndHm(dateStr, startHm);
              const covEnd = coverageIsoFromDayAndHm(dateStr, endHm, true);
              if (new Date(covEnd).getTime() <= new Date(covStart).getTime()) {
                setShiftTypeTimeError(
                  "שעת הסיום חייבת להיות אחרי שעת ההתחלה (00:00 = חצות ביום המחרת)",
                );
                return;
              }
              setShiftTypeTimeError(null);
              const payload = buildShiftWindowPayload(d, dateStr);
              const editId = Number(d.id);
              if (editId > 0) {
                updateShiftWindowMut.mutate({ id: editId, payload });
              } else {
                createShiftWindowMut.mutate(payload);
              }
            }}
          >
            שמור
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeleteShiftTypeConfirmDialog({
  confirm,
  onClose,
  deleteShiftWindowMut,
}: {
  confirm: { id: number; name: string } | null;
  onClose: () => void;
  deleteShiftWindowMut: UseMutationResult<unknown, Error, number, unknown>;
}) {
  if (!confirm) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-shift-type-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-card border border-line bg-surface p-0 shadow-airy"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-4 py-3">
          <h3 id="delete-shift-type-title" className="font-heading text-lg font-bold text-ink">
            למחוק סוג משמרת?
          </h3>
        </div>
        <div className="space-y-2 px-4 py-4 text-sm text-ink">
          <p>
            האם למחוק את <span className="font-semibold">{confirm.name}</span>?
          </p>
          <p className="text-muted">
            פעולה זו תמחק גם את כל המשמרות המשויכות לסוג זה (בכל התאריכים). לא ניתן לבטל.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            className="rounded-pill border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-background"
            onClick={onClose}
          >
            ביטול
          </button>
          <button
            type="button"
            className="rounded-pill bg-peach-3 px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
            disabled={deleteShiftWindowMut.isPending}
            onClick={() => deleteShiftWindowMut.mutate(confirm.id)}
          >
            מחק
          </button>
        </div>
      </div>
    </div>
  );
}
