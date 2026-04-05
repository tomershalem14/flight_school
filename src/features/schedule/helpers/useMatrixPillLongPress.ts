import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { LONG_PRESS_MS, LONG_PRESS_MOVE_PX } from "./scheduleConstants";

export function useMatrixPillLongPress(args: {
  onLongPressDelete: () => void;
  longPressMs?: number;
  moveThresholdPx?: number;
  onPointerDownFirst?: (e: ReactPointerEvent<Element>) => void;
  shouldAbortScheduledDelete?: () => boolean;
}) {
  const {
    onLongPressDelete,
    longPressMs = LONG_PRESS_MS,
    moveThresholdPx = LONG_PRESS_MOVE_PX,
    onPointerDownFirst,
    shouldAbortScheduledDelete,
  } = args;

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    startPos.current = null;
  }, []);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

  const moveThresholdSq = moveThresholdPx * moveThresholdPx;

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLSpanElement>) => {
      onPointerDownFirst?.(e);
      startPos.current = { x: e.clientX, y: e.clientY };
      longPressTimer.current = window.setTimeout(() => {
        longPressTimer.current = null;
        startPos.current = null;
        if (shouldAbortScheduledDelete?.()) return;
        onLongPressDelete();
      }, longPressMs);
    },
    [
      longPressMs,
      onLongPressDelete,
      onPointerDownFirst,
      shouldAbortScheduledDelete,
    ],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLSpanElement>) => {
      const s = startPos.current;
      if (s) {
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (dx * dx + dy * dy > moveThresholdSq) clearLongPress();
      }
    },
    [clearLongPress, moveThresholdSq],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clearLongPress,
    onPointerCancel: clearLongPress,
    clearLongPress,
  };
}
