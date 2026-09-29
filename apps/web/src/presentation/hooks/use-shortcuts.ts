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
 * Handles shortcuts from the registry (app/shortcuts.ts) for as long as the
 * component is mounted. Modifier shortcuts are caught before editors and the
 * browser see them (no print dialog on Ctrl+P); single keys are ignored while
 * typing.
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
        if (!keys.startsWith("Mod+") && isTyping(event.target)) return;
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
