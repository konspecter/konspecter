import type { TextKey } from "../i18n/i18n";

/**
 * Every keyboard shortcut in the app, in one place: the handlers (Layout and
 * the note page) and the lists shown to the user read the same table.
 *
 * `Mod` is ⌘ on macOS and Ctrl elsewhere. Modifier shortcuts work
 * everywhere, also while typing in an editor, unless they are `outsideText`
 * (in text ⌘←/⌘→ go to the line's ends, Ctrl+←/→ by words); single keys only
 * outside text fields, except Escape, which also works in the editors. Labels
 * are message keys (translated where they are shown).
 */
export const SHORTCUTS = {
  search: { keys: "Mod+P", label: "shortcut.search" },
  find: { keys: "Mod+F", label: "shortcut.find" },
  allNotes: { keys: "Escape", label: "shortcut.allNotes" },
  newNote: { keys: "Mod+N", label: "shortcut.newNote" },
  settings: { keys: "Mod+,", label: "shortcut.settings" },
  save: { keys: "Mod+S", label: "shortcut.save" },
  toggleSidebar: { keys: "Mod+\\", label: "shortcut.sidebar" },
  editorMode: { keys: "Mod+/", label: "shortcut.editorMode" },
  back: { keys: "Mod+ArrowLeft", label: "shortcut.back", outsideText: true },
  forward: { keys: "Mod+ArrowRight", label: "shortcut.forward", outsideText: true },
  quickSearch: { keys: "/", label: "shortcut.search" },
  quickNewNote: { keys: "n", label: "shortcut.newNote" },
  help: { keys: "?", label: "shortcut.help" },
} as const satisfies Record<string, { keys: string; label: TextKey; outsideText?: boolean }>;

export type ShortcutName = keyof typeof SHORTCUTS;

/**
 * The shortcuts as the user reads them: one row per action, with every key
 * that does it ("Mod+P" and "/" both search), in the table's order.
 */
export function shortcutGroups(): { label: TextKey; keys: string[] }[] {
  const groups = new Map<TextKey, string[]>();
  for (const { keys, label } of Object.values(SHORTCUTS)) {
    groups.set(label, [...(groups.get(label) ?? []), keys]);
  }
  return [...groups].map(([label, keys]) => ({ label, keys }));
}

type NavigatorWithData = Navigator & { userAgentData?: { platform?: string } };

export function isMac(): boolean {
  const nav: NavigatorWithData = navigator;
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform);
}

const ARROWS: Readonly<Record<string, string>> = { ArrowLeft: "←", ArrowRight: "→" };

/**
 * "Mod+P" as the user sees it: "⌘P" on macOS, "Ctrl+P" elsewhere; "Escape"
 * is "Esc", and arrow keys are arrows ("⌘←").
 */
export function formatKeys(keys: string, mac = isMac()): string {
  if (keys === "Escape") return "Esc";
  if (!keys.startsWith("Mod+")) return keys;
  const key = keys.slice(4);
  const shown = ARROWS[key] ?? key;
  return mac ? `⌘${shown}` : `Ctrl+${shown}`;
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
