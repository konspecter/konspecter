/**
 * Every keyboard shortcut in the app, in one place: the handlers (Layout and
 * the note page) and the lists shown to the user read the same table.
 *
 * `Mod` is ⌘ on macOS and Ctrl elsewhere. Modifier shortcuts work
 * everywhere, also while typing in an editor; single keys only outside text
 * fields.
 */
export const SHORTCUTS = {
  search: { keys: "Mod+P", label: "Search" },
  newNote: { keys: "Mod+N", label: "New note" },
  settings: { keys: "Mod+,", label: "Settings" },
  save: { keys: "Mod+S", label: "Save now (notes also save as you type)" },
  quickSearch: { keys: "/", label: "Search" },
  quickNewNote: { keys: "n", label: "New note" },
  help: { keys: "?", label: "Show these shortcuts" },
} as const;

export type ShortcutName = keyof typeof SHORTCUTS;

type NavigatorWithData = Navigator & { userAgentData?: { platform?: string } };

export function isMac(): boolean {
  const nav: NavigatorWithData = navigator;
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform);
}

/** "Mod+P" as the user sees it: "⌘P" on macOS, "Ctrl+P" elsewhere. */
export function formatKeys(keys: string, mac = isMac()): string {
  if (!keys.startsWith("Mod+")) return keys;
  const key = keys.slice(4);
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}

/** The physical key, for layouts where ⌘/Ctrl + key reports another character (Cyrillic). */
function keyCode(key: string): string | null {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  return key === "," ? "Comma" : key === "/" ? "Slash" : null;
}

/** Whether `event` is the shortcut `keys` ("Mod+P", "?"). */
export function matchesShortcut(keys: string, event: KeyboardEvent, mac = isMac()): boolean {
  if (keys.startsWith("Mod+")) {
    const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (!mod || event.altKey || event.shiftKey) return false;
    const key = keys.slice(4).toLowerCase();
    return event.key.toLowerCase() === key || event.code === keyCode(key);
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key === keys;
}
