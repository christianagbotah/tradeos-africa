/**
 * useKeyboardShortcuts — global POS keyboard shortcuts.
 *
 * The POS workspace must be fully operable by keyboard. Shortcuts are visible
 * in the UI (sidebar nav hints + cart shortcut row). This hook attaches a
 * single keydown listener and dispatches to a handler map.
 *
 * Focus management: shortcuts MUST NOT fire while the user is typing in an
 * input/textarea/select/contentEditable element. The single exception is Esc,
 * which always fires so a user can dismiss a dialog from any focus state.
 *
 * Default POS map:
 *   F1  — help
 *   F2  — focus product search
 *   F4  — focus customer selector (open)
 *   F9  — charge / open checkout
 *   Esc — close dialog / clear search
 */
import { useEffect } from "react";

export type ShortcutHandler = (event: KeyboardEvent) => void;

export interface ShortcutMap {
  [combo: string]: ShortcutHandler;
}

function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.metaKey) parts.push("meta");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return parts.join("+");
}

/**
 * Returns true when the active element (or the event target) is an editable
 * field — input, textarea, select, or contentEditable. Uses
 * `document.activeElement` so a shortcut cannot fire even if the keydown
 * target was a child of an input (e.g. a portal).
 */
function isEditableTarget(target: EventTarget | null): boolean {
  // Check the event target first; fall back to document.activeElement so we
  // catch focus that moved during the keydown propagation.
  const candidates: (EventTarget | null)[] = [target, typeof document !== "undefined" ? document.activeElement : null];
  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement)) continue;
    const tag = candidate.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || candidate.isContentEditable) {
      return true;
    }
  }
  return false;
}

/**
 * Register a map of keyboard shortcuts. Shortcuts are ignored when the user is
 * typing in an input/textarea/select/contentEditable, EXCEPT for Esc which
 * always fires so dialogs can be dismissed from any focus state.
 *
 * Pass `{ allowInInputs: true }` to fire every shortcut regardless of focus
 * (used rarely — e.g. a captive test harness).
 */
export function useKeyboardShortcuts(
  map: ShortcutMap,
  opts: { enabled?: boolean; allowInInputs?: boolean } = {},
): void {
  const { enabled = true, allowInInputs = false } = opts;
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const combo = comboOf(e);
      const fn = map[combo];
      if (!fn) return;
      const isEscape = e.key === "Escape";
      if (!allowInInputs && isEditableTarget(e.target) && !isEscape) return;
      fn(e);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [map, enabled, allowInInputs]);
}

/** Helper: build the standard POS shortcut map. */
export function buildPosShortcutMap(handlers: {
  onHelp: ShortcutHandler;
  onFocusSearch: ShortcutHandler;
  onOpenCustomer: ShortcutHandler;
  onCharge: ShortcutHandler;
  onClose: ShortcutHandler;
  onClearCart?: ShortcutHandler;
}): ShortcutMap {
  return {
    "F1": handlers.onHelp,
    "F2": handlers.onFocusSearch,
    "F4": handlers.onOpenCustomer,
    "F9": handlers.onCharge,
    "Escape": handlers.onClose,
  };
}
