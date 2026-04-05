import type { DragStartEvent } from "@dnd-kit/core";

export function matrixPillDragSize(
  event: DragStartEvent,
): { width: number; height: number } | null {
  const initial = event.active.rect.current?.initial;
  if (initial && initial.width > 0 && initial.height > 0) {
    return { width: initial.width, height: initial.height };
  }
  const target = event.activatorEvent.target;
  if (target instanceof Element) {
    const pill = target.closest("[data-matrix-pill]");
    if (pill instanceof HTMLElement) {
      const r = pill.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { width: r.width, height: r.height };
    }
  }
  return null;
}
