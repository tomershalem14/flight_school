import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

const PORTAL_LIST_Z = "z-[200]";

export type AutocompleteFilterMode = "substring" | "substring-ci";

export type AutocompleteEmptyQueryBehavior = "none" | "all" | "firstN";

export type AutocompletePlacement = "above" | "below" | "auto";

type CommonProps<T> = {
  items: T[];
  itemToKey: (item: T) => string;
  itemToLabel: (item: T) => string;
  filterMode?: AutocompleteFilterMode;
  emptyQueryBehavior: AutocompleteEmptyQueryBehavior;
  /** Used when `emptyQueryBehavior` is `firstN`. Defaults to 25. */
  emptyQueryFirstCount?: number;
  placement: AutocompletePlacement;
  /** When true, list is rendered in `document.body` with fixed coordinates. */
  portal?: boolean;
  /** Optional scroll container (e.g. modal body) to reposition the portaled list. */
  scrollContainerRef?: RefObject<HTMLElement | null>;
  inputClassName?: string;
  disabled?: boolean;
  placeholder?: string;
  dir?: "rtl" | "ltr";
  onSelect: (item: T) => void;
  /** Second Escape after list dismissed, or first Escape when list already hidden. */
  onEscape?: () => void;
  /** Fired when the field loses focus to the outside (after robust blur check). */
  onClose?: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  rootClassName?: string;
  autoFocus?: boolean;
  selectTextOnAutoFocus?: boolean;
};

export type AutocompleteComboboxProps<T> =
  | (CommonProps<T> & {
      mode?: "controlled";
      textValue: string;
      onTextValueChange: (v: string) => void;
    })
  | (CommonProps<T> & {
      mode: "selected-preview";
      selectedItem: T | null;
    });

function filterVisibleItems<T>(
  items: T[],
  query: string,
  itemToLabel: (item: T) => string,
  filterMode: AutocompleteFilterMode,
  emptyQueryBehavior: AutocompleteEmptyQueryBehavior,
  emptyQueryFirstCount: number,
): T[] {
  const q = query.trim();
  if (!q) {
    if (emptyQueryBehavior === "none") return [];
    if (emptyQueryBehavior === "all") return items;
    return items.slice(0, Math.max(0, emptyQueryFirstCount));
  }
  const needle = filterMode === "substring-ci" ? q.toLowerCase() : q;
  return items.filter((it) => {
    const label = itemToLabel(it);
    return filterMode === "substring-ci"
      ? label.toLowerCase().includes(needle)
      : label.includes(needle);
  });
}

function mergeInputRef(
  a: RefObject<HTMLInputElement | null> | undefined,
  el: HTMLInputElement | null,
) {
  if (!a) return;
  a.current = el;
}

export function AutocompleteCombobox<T>(props: AutocompleteComboboxProps<T>) {
  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const baseId = uid.replace(/:/g, "");

  const {
    items,
    itemToKey,
    itemToLabel,
    filterMode = "substring",
    emptyQueryBehavior,
    emptyQueryFirstCount = 25,
    placement,
    portal = false,
    scrollContainerRef,
    inputClassName = "",
    disabled = false,
    placeholder,
    dir,
    onSelect,
    onEscape,
    onClose,
    inputRef: inputRefProp,
    rootClassName = "",
    autoFocus = false,
    selectTextOnAutoFocus = false,
  } = props;

  const isPreview = props.mode === "selected-preview";
  const [previewQuery, setPreviewQuery] = useState("");

  const controlledText = isPreview ? "" : props.textValue;
  const onTextValueChange = isPreview ? undefined : props.onTextValueChange;
  const selectedItem = isPreview ? props.selectedItem : null;

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRefInner = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [inputFocused, setInputFocused] = useState(false);

  const visibleItems = useMemo(() => {
    if (isPreview && !inputFocused) return [];
    const qSource = isPreview ? previewQuery : controlledText;
    return filterVisibleItems(
      items,
      qSource,
      itemToLabel,
      filterMode,
      emptyQueryBehavior,
      emptyQueryFirstCount,
    );
  }, [
    items,
    isPreview,
    inputFocused,
    previewQuery,
    controlledText,
    itemToLabel,
    filterMode,
    emptyQueryBehavior,
    emptyQueryFirstCount,
  ]);

  const displayValue = isPreview
    ? inputFocused
      ? previewQuery
      : selectedItem
        ? itemToLabel(selectedItem)
        : ""
    : controlledText;

  const [escapeDismissedPanel, setEscapeDismissedPanel] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [portalPos, setPortalPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    placeAbove: boolean;
  } | null>(null);
  const [autoResolvedBelow, setAutoResolvedBelow] = useState(true);

  const panelOpen =
    inputFocused &&
    visibleItems.length > 0 &&
    !escapeDismissedPanel;

  const shouldRenderList = panelOpen && (!portal || portalPos !== null);

  const visibleKeys = useMemo(
    () => visibleItems.map((it) => itemToKey(it)).join("\0"),
    [visibleItems, itemToKey],
  );

  useEffect(() => {
    setActiveIndex(visibleItems.length === 0 ? -1 : 0);
  }, [visibleKeys, visibleItems.length]);

  useEffect(() => {
    if (!autoFocus || disabled) return;
    const el = inputRefInner.current;
    if (!el) return;
    el.focus();
    if (selectTextOnAutoFocus) el.select();
  }, [autoFocus, disabled, selectTextOnAutoFocus]);

  const updatePortalPos = useCallback(() => {
    if (!portal) return;
    const anchor = rootRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const spaceBelow = window.innerHeight - r.bottom - gap - margin;
    const spaceAbove = r.top - gap - margin;
    let placeAbove = false;
    let maxHeight = 160;
    let top = r.bottom + gap;

    if (placement === "above") {
      placeAbove = true;
      maxHeight = Math.min(160, Math.max(80, spaceAbove));
      top = r.top - gap - maxHeight;
    } else if (placement === "below") {
      placeAbove = false;
      maxHeight = Math.min(160, Math.max(80, spaceBelow));
      top = r.bottom + gap;
    } else {
      const preferBelow = spaceBelow >= 80 || spaceBelow >= spaceAbove;
      if (preferBelow) {
        placeAbove = false;
        maxHeight = Math.min(160, Math.max(80, spaceBelow));
        top = r.bottom + gap;
      } else {
        placeAbove = true;
        maxHeight = Math.min(160, Math.max(80, spaceAbove));
        top = r.top - gap - maxHeight;
      }
    }

    setAutoResolvedBelow(!placeAbove);
    setPortalPos({
      top,
      left: r.left,
      width: r.width,
      maxHeight,
      placeAbove,
    });
  }, [portal, placement]);

  useLayoutEffect(() => {
    if (!portal || !panelOpen || disabled) {
      setPortalPos(null);
      return;
    }
    updatePortalPos();
  }, [portal, panelOpen, disabled, updatePortalPos, visibleItems.length, placement]);

  useLayoutEffect(() => {
    if (portal || placement !== "auto" || !panelOpen || disabled) return;
    const anchor = rootRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const spaceBelow = window.innerHeight - r.bottom - gap - margin;
    const spaceAbove = r.top - gap - margin;
    setAutoResolvedBelow(spaceBelow >= spaceAbove || spaceBelow >= 80);
  }, [portal, placement, panelOpen, disabled, visibleItems.length]);

  useEffect(() => {
    if (!portal || !panelOpen || disabled) return;
    updatePortalPos();
    window.addEventListener("resize", updatePortalPos);
    const scrollEl = scrollContainerRef?.current;
    if (scrollEl) {
      scrollEl.addEventListener("scroll", updatePortalPos, { passive: true });
    }
    return () => {
      window.removeEventListener("resize", updatePortalPos);
      if (scrollEl) {
        scrollEl.removeEventListener("scroll", updatePortalPos);
      }
    };
  }, [portal, panelOpen, disabled, updatePortalPos, scrollContainerRef]);

  useEffect(() => {
    if (!shouldRenderList || activeIndex < 0) return;
    const id = `${baseId}-opt-${itemToKey(visibleItems[activeIndex]!)}`;
    const root = portal ? document.body : listRef.current;
    if (!root) return;
    const node = root.querySelector(`#${CSS.escape(id)}`);
    if (node && "scrollIntoView" in node) {
      (node as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, shouldRenderList, visibleItems, baseId, itemToKey, portal]);

  const commit = useCallback(
    (item: T) => {
      onSelect(item);
      setEscapeDismissedPanel(false);
      if (isPreview) {
        setPreviewQuery("");
        inputRefInner.current?.blur();
      }
    },
    [isPreview, onSelect],
  );

  const onInputBlur = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const root = rootRef.current;
        if (root?.contains(document.activeElement)) return;
        setInputFocused(false);
        setEscapeDismissedPanel(false);
        if (isPreview) {
          setPreviewQuery("");
        }
        onClose?.();
      });
    });
  }, [isPreview, onClose]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setEscapeDismissedPanel(false);
        if (visibleItems.length === 0) return;
        setActiveIndex((i) => {
          const next = i < 0 ? 0 : i + 1;
          return next >= visibleItems.length ? 0 : next;
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setEscapeDismissedPanel(false);
        if (visibleItems.length === 0) return;
        setActiveIndex((i) => {
          const cur = i < 0 ? 0 : i;
          const next = cur - 1;
          return next < 0 ? visibleItems.length - 1 : next;
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (visibleItems.length === 0) return;
        const pick =
          activeIndex >= 0 && activeIndex < visibleItems.length
            ? visibleItems[activeIndex]!
            : visibleItems[0]!;
        commit(pick);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (visibleItems.length > 0 && !escapeDismissedPanel) {
          setEscapeDismissedPanel(true);
          return;
        }
        onEscape?.();
        setEscapeDismissedPanel(false);
      }
    },
    [
      visibleItems,
      activeIndex,
      escapeDismissedPanel,
      commit,
      onEscape,
    ],
  );

  const listInlinePlacement =
    placement === "above"
      ? "bottom-full mb-0.5"
      : placement === "below"
        ? "top-full mt-0.5"
        : autoResolvedBelow
          ? "top-full mt-0.5"
          : "bottom-full mb-0.5";

  const listEl = shouldRenderList ? (
    <ul
      ref={listRef}
      id={listboxId}
      role="listbox"
      className={`autocomplete-panel text-start ${
        portal
          ? `fixed ${PORTAL_LIST_Z} overflow-auto rounded-card py-1`
          : `absolute start-0 z-30 max-h-40 min-w-full overflow-y-auto rounded-md py-0.5 ${listInlinePlacement}`
      }`}
      style={
        portal && portalPos
          ? {
              top: portalPos.top,
              left: portalPos.left,
              width: portalPos.width,
              maxHeight: portalPos.maxHeight,
            }
          : undefined
      }
      onMouseDown={(ev) => ev.preventDefault()}
    >
      {visibleItems.map((item, idx) => {
        const key = itemToKey(item);
        const oid = `${baseId}-opt-${key}`;
        const isActive = idx === activeIndex;
        return (
          <li key={key} role="presentation" className="list-none">
            <div
              id={oid}
              role="option"
              aria-selected={isActive}
              tabIndex={-1}
              className={`autocomplete-option cursor-pointer px-2 py-1 text-start text-xs text-ink ${
                isActive ? "bg-primary/10" : ""
              }`}
              onMouseEnter={() => setActiveIndex(idx)}
              onMouseDown={(ev) => {
                ev.preventDefault();
                commit(item);
              }}
            >
              {itemToLabel(item)}
            </div>
          </li>
        );
      })}
    </ul>
  ) : null;

  return (
    <div ref={rootRef} className={`relative min-w-0 ${rootClassName}`}>
      <input
        ref={(el) => {
          inputRefInner.current = el;
          mergeInputRef(inputRefProp, el);
        }}
        type="text"
        dir={dir}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={panelOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          shouldRenderList && activeIndex >= 0 && visibleItems[activeIndex]
            ? `${baseId}-opt-${itemToKey(visibleItems[activeIndex]!)}`
            : undefined
        }
        className={inputClassName}
        placeholder={placeholder}
        value={displayValue}
        onFocus={() => {
          setInputFocused(true);
          setEscapeDismissedPanel(false);
          if (isPreview) {
            setPreviewQuery("");
          }
        }}
        onChange={(e) => {
          const v = e.target.value;
          setEscapeDismissedPanel(false);
          if (isPreview) {
            setPreviewQuery(v);
          } else {
            onTextValueChange!(v);
          }
        }}
        onBlur={onInputBlur}
        onKeyDown={onKeyDown}
      />
      {portal && listEl && typeof document !== "undefined"
        ? createPortal(listEl, document.body)
        : listEl}
    </div>
  );
}
