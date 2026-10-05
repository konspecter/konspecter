import { useSyncExternalStore } from "react";
import type { EditorMode, Theme } from "../../domain/settings/settings";
import { MarkdownIcon, MoonIcon, SunIcon, TextIcon } from "@konspecter/ui/icons";
import { t } from "../i18n/i18n";
import { formatKeys, SHORTCUTS } from "../app/shortcuts";

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
      className="icon-button"
      aria-label={t("topbar.darkTheme")}
      aria-pressed={dark}
      title={dark ? t("topbar.toLight") : t("topbar.toDark")}
      onClick={onToggle}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** One button: pressed while notes show their Markdown source; the icon shows the other mode. */
export function ModeToggle({
  mode,
  onChange,
}: {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
}) {
  const markdown = mode === "markdown";
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={t("topbar.markdown")}
      aria-pressed={markdown}
      title={`${markdown ? t("topbar.toText") : t("topbar.toMarkdown")} (${formatKeys(SHORTCUTS.editorMode.keys)})`}
      onClick={() => {
        onChange(markdown ? "text" : "markdown");
      }}
    >
      {markdown ? <TextIcon /> : <MarkdownIcon />}
    </button>
  );
}
