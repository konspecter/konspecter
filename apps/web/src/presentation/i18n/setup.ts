import type { Language } from "../../domain/settings/settings";
import { detectLocale, setLocale, t, type Locale } from "./i18n";

function systemLocale(): Locale {
  return detectLocale(navigator.languages.length > 0 ? navigator.languages : [navigator.language]);
}

/**
 * Sets the interface language, the system's or a chosen one, and marks the
 * page with it. Rendered text follows on the next render.
 */
export function applyLanguage(language: Language): void {
  const locale = language === "system" ? systemLocale() : language;
  setLocale(locale);
  document.documentElement.lang = locale;
}

// Imported first by main.tsx, so the system's language is set before anything
// renders; main.tsx applies the saved setting once settings are loaded.
applyLanguage("system");

export { t };
