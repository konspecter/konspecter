import { isPinKey, type PinKey } from "../../domain/document/document";
import type { TextKey } from "../i18n/i18n";

/**
 * Every keyboard shortcut in the app, in one place: the handlers (Layout and
 * the note page) and the lists shown to the user read the same table.
 *
 * `Mod` is ⌘ on macOS and Ctrl elsewhere, `Alt` is ⌥, and `Digit` any of
 * 1…0. Modifier shortcuts work
 * everywhere, also while typing in an editor, unless they are `outsideText`
 * (in text ⌘←/⌘→ go to the line's ends, Ctrl+←/→ by words); single keys only
 * outside text fields. Escape is never ours: it closes dialogs and lets go
 * of form fields. Labels are message keys (translated where they are shown).
 */
export const SHORTCUTS = {
  search: { keys: "Mod+P", label: "shortcut.search" },
  find: { keys: "Mod+F", label: "shortcut.find" },
  newNote: { keys: "Mod+N", label: "shortcut.newNote" },
  settings: { keys: "Mod+,", label: "shortcut.settings" },
  save: { keys: "Mod+S", label: "shortcut.save" },
  toggleSidebar: { keys: "Mod+\\", label: "shortcut.sidebar" },
  editorMode: { keys: "Mod+/", label: "shortcut.editorMode" },
  back: { keys: "Mod+ArrowLeft", label: "shortcut.back", outsideText: true },
  forward: { keys: "Mod+ArrowRight", label: "shortcut.forward", outsideText: true },
  previousRecent: { keys: "Mod+Alt+ArrowLeft", label: "shortcut.previousRecent" },
  nextRecent: { keys: "Mod+Alt+ArrowRight", label: "shortcut.nextRecent" },
  // As StarCraft's unit groups: one chord puts the open note on a digit, the other goes to it.
  pinNote: { keys: "Mod+Alt+Digit", label: "shortcut.pinNote" },
  openPinned: { keys: "Mod+Digit", label: "shortcut.openPinned" },
  quickSearch: { keys: "/", label: "shortcut.search" },
  quickNewNote: { keys: "n", label: "shortcut.newNote" },
  help: { keys: "?", label: "shortcut.help" },
} as const satisfies Record<string, { keys: string; label: TextKey; outsideText?: boolean }>;

export type ShortcutName = keyof typeof SHORTCUTS;

/**
 * The shortcuts as the user reads them: one row per action, with every key
 * that does it ("Mod+P" and "/" both search), in the table's order; only
 * those named in `only` when given.
 */
export function shortcutGroups(
  only?: readonly ShortcutName[],
): { label: TextKey; keys: string[] }[] {
  const groups = new Map<TextKey, string[]>();
  for (const [name, { keys, label }] of Object.entries(SHORTCUTS)) {
    if (only && !only.includes(name as ShortcutName)) continue;
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

/** "Mod+Alt+ArrowLeft" as its parts: whether it has Alt, and the key. */
function modifierKeys(keys: string): { alt: boolean; key: string } {
  const rest = keys.slice(4);
  return rest.startsWith("Alt+") ? { alt: true, key: rest.slice(4) } : { alt: false, key: rest };
}

/**
 * "Mod+P" as the user sees it: "⌘P" on macOS, "Ctrl+P" elsewhere; arrow
 * keys are arrows ("⌘←", "⌥⌘←", "Ctrl+Alt+←"), and a
 * digit is "1…0" ("⌘1…0", "Ctrl+Alt+1…0").
 */
export function formatKeys(keys: string, mac = isMac()): string {
  if (!keys.startsWith("Mod+")) return keys;
  const { alt, key } = modifierKeys(keys);
  const shown = key === "Digit" ? "1…0" : (ARROWS[key] ?? key);
  if (mac) return `${alt ? "⌥" : ""}⌘${shown}`;
  return `Ctrl+${alt ? "Alt+" : ""}${shown}`;
}

/** The physical key, for layouts where ⌘/Ctrl + key reports another character (Cyrillic). */
function keyCode(key: string): string | null {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  const codes: Record<string, string> = { ",": "Comma", "/": "Slash", "\\": "Backslash" };
  return codes[key] ?? null;
}

/**
 * The digit of a key press (1…0, `Digit`), by the physical key (the top row
 * or the keypad), so layouts that type other characters there (AZERTY, or
 * ⌥ with a digit on macOS) pin and open too.
 */
export function pinKeyOf(event: KeyboardEvent): PinKey | null {
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code)?.[1];
  return digit !== undefined && isPinKey(digit) ? digit : null;
}

/** Whether `event` is the shortcut `keys` ("Mod+P", "Mod+Alt+ArrowLeft", "Mod+Digit", "?"). */
export function matchesShortcut(keys: string, event: KeyboardEvent, mac = isMac()): boolean {
  if (keys.startsWith("Mod+")) {
    const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    const { alt, key: name } = modifierKeys(keys);
    if (!mod || event.altKey !== alt || event.shiftKey) return false;
    // AltGr (Ctrl+Alt to Windows) with a digit types a character on many layouts: `{` on German.
    if (name === "Digit") return pinKeyOf(event) !== null && !event.getModifierState("AltGraph");
    const key = name.toLowerCase();
    return event.key.toLowerCase() === key || event.code === keyCode(key);
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key === keys;
}
