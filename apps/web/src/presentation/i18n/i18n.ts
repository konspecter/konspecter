import {
  createTranslator,
  detectLocale as detectAmong,
  type Dictionary as I18nDictionary,
  type Params,
  type PluralKey as I18nPluralKey,
  type TextKey as I18nTextKey,
} from "@konspecter/i18n";
import { en } from "./en";
import { ru } from "./ru";

/**
 * The app's interface languages, on the shared engine (@konspecter/i18n).
 * English is the default; the system's preferred languages or the Language
 * setting pick another one (see docs/architecture/i18n.md).
 */
export const LOCALES = ["en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** Each language's name in that language, as the Language setting lists them. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", ru: "Русский" };

type Messages = typeof en;
export type { Params, Plural } from "@konspecter/i18n";
/** Keys of plain messages. */
export type TextKey = I18nTextKey<Messages>;
/** Keys of messages with plural forms. */
export type PluralKey = I18nPluralKey<Messages>;
/** A translation: every English key, each as text or as plural forms. */
export type Dictionary = I18nDictionary<Messages>;

const dictionaries: Record<Locale, Dictionary> = { en, ru };

/** The first of the preferred languages the app speaks ("ru-RU" → ru), else English. */
export function detectLocale(languages: readonly string[]): Locale {
  return detectAmong(languages, LOCALES, DEFAULT_LOCALE);
}

let current: Locale = DEFAULT_LOCALE;
let translator = createTranslator(dictionaries[current], current);

/** Sets the interface language; text rendered afterwards uses it (see `applyLanguage`). */
export function setLocale(locale: Locale): void {
  current = locale;
  translator = createTranslator(dictionaries[locale], locale);
}

export function currentLocale(): Locale {
  return current;
}

/** The message in the current language, with `{name}` placeholders filled in. */
export function t(key: TextKey, params?: Params): string {
  return translator.t(key, params);
}

/** The plural form for `count` in the current language; `{count}` is the formatted number. */
export function tn(key: PluralKey, count: number, params?: Params): string {
  return translator.tn(key, count, params);
}
