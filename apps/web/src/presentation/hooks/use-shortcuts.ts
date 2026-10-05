import { useEffect, useRef } from "react";
import { matchesShortcut, SHORTCUTS, type ShortcutName } from "../app/shortcuts";

export type ShortcutHandlers = Partial<Record<ShortcutName, () => void>>;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable='true'], .cm-editor") !== null
  );
}

/**
 * Whether Escape belongs to something else here: an open dialog closes, a form
 * field (the search box, CodeMirror's go-to-line field) lets go of the focus.
 * In the editors themselves it is ours.
 */
function escapeTaken(target: EventTarget | null): boolean {
  if (document.querySelector("[aria-modal='true']") !== null) return true;
  return target instanceof HTMLElement && target.closest("input, textarea, select") !== null;
}

function blocked(name: ShortcutName, target: EventTarget | null): boolean {
  const shortcut: { keys: string; outsideText?: boolean } = SHORTCUTS[name];
  const { keys } = shortcut;
  if (keys.startsWith("Mod+")) return shortcut.outsideText === true && isTyping(target);
  return keys === "Escape" ? escapeTaken(target) : isTyping(target);
}

/**
 * Handles shortcuts from the registry (app/shortcuts.ts) for as long as the
 * component is mounted. Modifier shortcuts are caught before editors and the
 * browser see them (no print dialog on Ctrl+P), except those that are
 * `outsideText` while typing; single keys are ignored while typing, and
 * Escape wherever something else uses it.
 */
export function useShortcuts(handlers: ShortcutHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      for (const [name, handler] of Object.entries(latest.current)) {
        const { keys } = SHORTCUTS[name as ShortcutName];
        if (!matchesShortcut(keys, event)) continue;
        if (blocked(name as ShortcutName, event.target)) return;
        // Ours alone: an editor's own binding for the keys (CodeMirror's Mod-/) does not run.
        event.preventDefault();
        event.stopPropagation();
        handler();
        return;
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, []);
}
