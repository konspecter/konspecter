import { detectLocale, setLocale, t } from "./i18n";

/**
 * Picks the interface language from the system's preferred languages and
 * marks the page with it. Imported first by main.tsx, so it runs before
 * anything renders.
 */
const locale = detectLocale(
  navigator.languages.length > 0 ? navigator.languages : [navigator.language],
);
setLocale(locale);
document.documentElement.lang = locale;

export { t };
