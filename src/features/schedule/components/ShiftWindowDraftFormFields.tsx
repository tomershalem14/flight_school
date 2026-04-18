import { useMemo, type RefObject } from "react";
import type { JsonObject } from "../../../shared/api";
import { presetDurationById, validSegmentStartTimes } from "../../../shared/manningHours";
import { formatTimeForInput } from "../../../shared/timeFormat";
import {
  coverageEndIsNextDayMidnight,
  resyncWindowSegmentStartTimes,
} from "../helpers/scheduleShiftModel";
import type { WindowSegmentDraft } from "../helpers/scheduleTypes";
import { SyllabusPresetCombo } from "./SyllabusPresetCombo";

function FormErrorBanner({ children }: { children: string }) {
  return (
    <p className="rounded-card border border-peach-3/50 bg-peach-1/40 px-3 py-2 text-sm text-ink">
      {children}
    </p>
  );
}

export function ShiftWindowDraftFormFields({
  draft,
  setDraft,
  presets,
  dateStr,
  shiftTypeTimeError,
  setShiftTypeTimeError,
  saveErrorMessage,
  scrollContainerRef,
}: {
  draft: JsonObject;
  setDraft: (next: JsonObject) => void;
  presets: JsonObject[];
  dateStr: string;
  shiftTypeTimeError: string | null;
  setShiftTypeTimeError: (v: string | null) => void;
  saveErrorMessage: string | null;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}) {
  const segments = (draft.segments as WindowSegmentDraft[]) ?? [];
  const durs = useMemo(() => presetDurationById(presets), [presets]);
  const covStart = formatTimeForInput(String(draft.coverage_start_time ?? "06:00")) || "06:00";
  const covEnd = formatTimeForInput(String(draft.coverage_end_time ?? "21:00")) || "21:00";
  const endNext = coverageEndIsNextDayMidnight(covEnd);

  return (
    <>
      {saveErrorMessage ? <FormErrorBanner>{saveErrorMessage}</FormErrorBanner> : null}
      {shiftTypeTimeError ? <FormErrorBanner>{shiftTypeTimeError}</FormErrorBanner> : null}
      <div className="form-row">
        <label className="text-sm font-semibold text-ink">שם תצוגה</label>
        <input
          value={String(draft.name ?? "")}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </div>
      <div className="form-row">
        <label className="text-sm font-semibold text-ink">התחלת חלון</label>
        <input
          type="time"
          dir="ltr"
          value={covStart}
          onChange={(e) => {
            setShiftTypeTimeError(null);
            const v = e.target.value;
            const nextSegs = segments.length
              ? segments.map((s, i) =>
                  i === 0
                    ? { ...s, segment_start_time: formatTimeForInput(v) || v }
                    : s,
                )
              : [];
            setDraft(
              resyncWindowSegmentStartTimes(
                {
                  ...draft,
                  coverage_start_time: v,
                  segments: nextSegs,
                },
                dateStr,
                durs,
              ),
            );
          }}
        />
      </div>
      <div className="form-row">
        <label className="text-sm font-semibold text-ink">סיום חלון</label>
        <input
          type="time"
          dir="ltr"
          value={covEnd}
          onChange={(e) => {
            setShiftTypeTimeError(null);
            setDraft(
              resyncWindowSegmentStartTimes(
                { ...draft, coverage_end_time: e.target.value },
                dateStr,
                durs,
              ),
            );
          }}
        />
      </div>
      <div className="form-row">
        <label className="text-sm font-semibold text-ink">הערות</label>
        <input
          value={String(draft.notes ?? "")}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </div>

      <div className="rounded-card border border-line bg-background/50 px-3 py-2">
        <div className="mb-2 text-sm font-semibold text-ink">סילבוסים בחלון</div>
        <div className="grid grid-cols-[3fr_1fr] gap-2 border-b border-line pb-2 text-xs font-bold uppercase tracking-wide text-muted">
          <span className="min-w-0">סילבוס</span>
          <span dir="ltr" className="min-w-0 text-end">
            שעת התחלה
          </span>
        </div>
        <div className="mt-2 space-y-2">
          {segments.map((seg, idx) => {
            const timeOpts =
              idx === 0
                ? [formatTimeForInput(covStart) || covStart]
                : validSegmentStartTimes(
                    dateStr,
                    covStart,
                    covEnd,
                    endNext,
                    segments.slice(0, idx),
                    idx,
                    durs,
                  );
            return (
              <div
                key={`seg-${idx}-${seg.segment_start_time}`}
                className="grid grid-cols-[3fr_1fr] items-end gap-2"
              >
                <div className="min-w-0">
                  <SyllabusPresetCombo
                    presets={presets}
                    valueId={Number(seg.syllabus_preset_id)}
                    scrollContainerRef={scrollContainerRef}
                    onPick={(id) => {
                      const next = segments.map((s, j) =>
                        j === idx ? { ...s, syllabus_preset_id: id } : s,
                      );
                      setDraft(
                        resyncWindowSegmentStartTimes(
                          { ...draft, segments: next },
                          dateStr,
                          durs,
                        ),
                      );
                    }}
                  />
                </div>
                <div className="min-w-0">
                  <select
                    dir="ltr"
                    className="w-full min-w-0 text-center text-sm"
                    disabled={idx === 0}
                    value={(() => {
                      const cur =
                        idx === 0
                          ? formatTimeForInput(covStart) || covStart
                          : formatTimeForInput(seg.segment_start_time) || timeOpts[0] || "";
                      return timeOpts.includes(cur) ? cur : (timeOpts[0] ?? cur);
                    })()}
                    onChange={(e) => {
                      if (idx === 0) return;
                      const next = segments.map((s, j) =>
                        j === idx ? { ...s, segment_start_time: e.target.value } : s,
                      );
                      setDraft(
                        resyncWindowSegmentStartTimes(
                          { ...draft, segments: next },
                          dateStr,
                          durs,
                        ),
                      );
                    }}
                  >
                    {timeOpts.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-pill border border-line bg-background px-3 py-1.5 text-sm font-semibold text-ink hover:border-primary/40"
            onClick={() => {
              if (segments.length === 0) return;
              const last = segments[segments.length - 1];
              const opts = validSegmentStartTimes(
                dateStr,
                covStart,
                covEnd,
                endNext,
                segments,
                segments.length,
                durs,
              );
              const nextTime = opts[0];
              if (!nextTime) {
                window.alert("אין זמן התחלה חוקי נוסף לפני סיום החלון.");
                return;
              }
              setDraft(
                resyncWindowSegmentStartTimes(
                  {
                    ...draft,
                    segments: [
                      ...segments,
                      {
                        syllabus_preset_id: last.syllabus_preset_id,
                        segment_start_time: nextTime,
                      },
                    ],
                  },
                  dateStr,
                  durs,
                ),
              );
            }}
          >
            + הוסף סילבוס
          </button>
          {segments.length > 1 ? (
            <button
              type="button"
              className="rounded-pill border border-line px-3 py-1.5 text-sm text-muted hover:bg-peach-1/30"
              onClick={() =>
                setDraft(
                  resyncWindowSegmentStartTimes(
                    { ...draft, segments: segments.slice(0, -1) },
                    dateStr,
                    durs,
                  ),
                )
              }
            >
              הסר שורה אחרונה
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
