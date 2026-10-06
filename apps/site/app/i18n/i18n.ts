import {
  createTranslator,
  type Dictionary as I18nDictionary,
  type Translator,
} from "@konspecter/i18n";
import { useRouteLoaderData } from "react-router";
import { en } from "./en";
import { ru } from "./ru";

/** The site's languages. English is the default (see preferences.server.ts for the choice). */
export const LOCALES = ["en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** Each language by its own name, as the language dropdown lists them. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", ru: "Русский" };

type Messages = typeof en;
/** A translation: every English key, each as text or as plural forms. */
export type Dictionary = I18nDictionary<Messages>;
export type SiteTranslator = Translator<Dictionary>;

const dictionaries: Record<Locale, Dictionary> = { en, ru };

// Translators hold no request state, so one per language serves every request.
const translators = new Map<Locale, SiteTranslator>();

export function translator(locale: Locale): SiteTranslator {
  let found = translators.get(locale);
  if (!found) {
    found = createTranslator(dictionaries[locale], locale);
    translators.set(locale, found);
  }
  return found;
}

/** The page's language, which the root loader decides. */
export function useLocale(): Locale {
  return useRouteLoaderData<{ locale: Locale }>("root")?.locale ?? DEFAULT_LOCALE;
}

/** The translator for the page's language. */
export function useT(): SiteTranslator {
  return translator(useLocale());
}
