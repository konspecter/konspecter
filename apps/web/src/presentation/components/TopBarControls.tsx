import { useSyncExternalStore } from "react";
import type { EditorMode, Theme } from "../../domain/settings/settings";
import { MoonIcon, SunIcon } from "./icons";

const DARK = "(prefers-color-scheme: dark)";

function subscribeScheme(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(DARK);
  query.addEventListener("change", listener);
  return () => {
    query.removeEventListener("change", listener);
  };
}

function systemDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK).matches;
}

/** Whether the page is dark: the chosen theme, or the system's for "system". */
export function useDarkTheme(theme: Theme): boolean {
  const system = useSyncExternalStore(subscribeScheme, systemDark);
  return theme === "system" ? system : theme === "dark";
}

export function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label="Dark theme"
      aria-pressed={dark}
      title={dark ? "Switch to the light theme" : "Switch to the dark theme"}
      onClick={onToggle}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

const MODES: readonly (readonly [EditorMode, string])[] = [
  ["text", "Text"],
  ["markdown", "Markdown"],
];

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
}) {
  return (
    <div className="mode-toggle" role="group" aria-label="Editor mode">
      {MODES.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className="mode-button"
          aria-pressed={mode === value}
          onClick={() => {
            onChange(value);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
