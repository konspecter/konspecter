import type { TextKey } from "../i18n/i18n";

/**
 * Every keyboard shortcut in the app, in one place: the handlers (Layout and
 * the note page) and the lists shown to the user read the same table.
 *
 * `Mod` is ⌘ on macOS and Ctrl elsewhere. Modifier shortcuts work
 * everywhere, also while typing in an editor; single keys only outside text
 * fields, except Escape, which also works in the editors. Labels are message
 * keys (translated where they are shown).
 */
export const SHORTCUTS = {
  search: { keys: "Mod+P", label: "shortcut.search" },
  allNotes: { keys: "Escape", label: "shortcut.allNotes" },
  newNote: { keys: "Mod+N", label: "shortcut.newNote" },
  settings: { keys: "Mod+,", label: "shortcut.settings" },
  save: { keys: "Mod+S", label: "shortcut.save" },
  toggleSidebar: { keys: "Mod+\\", label: "shortcut.sidebar" },
  editorMode: { keys: "Mod+/", label: "shortcut.editorMode" },
  quickSearch: { keys: "/", label: "shortcut.search" },
  quickNewNote: { keys: "n", label: "shortcut.newNote" },
  help: { keys: "?", label: "shortcut.help" },
} as const satisfies Record<string, { keys: string; label: TextKey }>;

export type ShortcutName = keyof typeof SHORTCUTS;

type NavigatorWithData = Navigator & { userAgentData?: { platform?: string } };

export function isMac(): boolean {
  const nav: NavigatorWithData = navigator;
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform);
}

/** "Mod+P" as the user sees it: "⌘P" on macOS, "Ctrl+P" elsewhere; "Escape" is "Esc". */
export function formatKeys(keys: string, mac = isMac()): string {
  if (keys === "Escape") return "Esc";
  if (!keys.startsWith("Mod+")) return keys;
  const key = keys.slice(4);
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}

/** The physical key, for layouts where ⌘/Ctrl + key reports another character (Cyrillic). */
function keyCode(key: string): string | null {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  const codes: Record<string, string> = { ",": "Comma", "/": "Slash", "\\": "Backslash" };
  return codes[key] ?? null;
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
