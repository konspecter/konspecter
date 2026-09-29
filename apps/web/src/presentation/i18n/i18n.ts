import { en } from "./en";
import { ru } from "./ru";

/**
 * The interface languages. English is the default; the system's preferred
 * languages pick another one (see docs/architecture/i18n.md).
 */
export const LOCALES = ["en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Plural forms, chosen by `Intl.PluralRules`: English uses one/other, Russian one/few/many. */
export type Plural = {
  readonly one: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
};

type Messages = typeof en;
/** Keys of plain messages. */
export type TextKey = {
  [K in keyof Messages]: Messages[K] extends string ? K : never;
}[keyof Messages];
/** Keys of messages with plural forms. */
export type PluralKey = Exclude<keyof Messages, TextKey>;
/** A translation: every English key, each as text or as plural forms. */
export type Dictionary = {
  readonly [K in keyof Messages]: Messages[K] extends string ? string : Plural;
};

const dictionaries: Record<Locale, Dictionary> = { en, ru };

/** The first of the preferred languages the app speaks ("ru-RU" → ru), else English. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split("-")[0];
    const match = LOCALES.find((locale) => locale === base);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

let current: Locale = DEFAULT_LOCALE;

/** Sets the interface language; call before rendering (the app does not switch while running). */
export function setLocale(locale: Locale): void {
  current = locale;
}

export function currentLocale(): Locale {
  return current;
}

export type Params = Readonly<Record<string, string | number>>;

function fill(template: string, params: Params | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

/** The message in the current language, with `{name}` placeholders filled in. */
export function t(key: TextKey, params?: Params): string {
  return fill(dictionaries[current][key], params);
}

/** The plural form for `count` in the current language; `{count}` is the formatted number. */
export function tn(key: PluralKey, count: number, params?: Params): string {
  const forms: Plural = dictionaries[current][key];
  const category = new Intl.PluralRules(current).select(count);
  const template =
    (category === "one" || category === "few" || category === "many"
      ? forms[category]
      : undefined) ?? forms.other;
  return fill(template, { count: new Intl.NumberFormat(current).format(count), ...params });
}
