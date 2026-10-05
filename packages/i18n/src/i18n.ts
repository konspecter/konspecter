/**
 * Message lookup for Konspecter's interfaces (the app and the account site).
 * Each interface owns its dictionaries; the source language's dictionary
 * defines the keys, and every translation must have them all (`Dictionary`).
 * A translator is a value, not global state, so a server can render many
 * languages at once.
 */

/** Plural forms, chosen by `Intl.PluralRules`: English uses one/other, Russian one/few/many. */
export type Plural = {
  readonly one: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
};

/** The source dictionary's shape: each message is text or plural forms. */
export type Messages = Readonly<Record<string, string | Plural>>;

/** Keys of plain messages. */
export type TextKey<M extends Messages> = {
  [K in keyof M & string]: M[K] extends string ? K : never;
}[keyof M & string];

/** Keys of messages with plural forms. */
export type PluralKey<M extends Messages> = Exclude<keyof M & string, TextKey<M>>;

/** A translation of `M`: every key, each as text or as plural forms. */
export type Dictionary<M extends Messages> = {
  readonly [K in keyof M]: M[K] extends string ? string : Plural;
};

/** Values for `{name}` placeholders. */
export type Params = Readonly<Record<string, string | number>>;

/** The first of the preferred languages that is one of `locales` ("ru-RU" → ru), else `fallback`. */
export function detectLocale<L extends string>(
  languages: readonly string[],
  locales: readonly L[],
  fallback: L,
): L {
  for (const language of languages) {
    const base = language.trim().toLowerCase().split(/[-_;]/)[0];
    const match = locales.find((locale) => locale === base);
    if (match) return match;
  }
  return fallback;
}

/** `{name}` placeholders filled from `params`; unknown ones stay as written. */
export function fill(template: string, params: Params | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

/** Functions, not methods: `const { t, tn } = translator` is fine. */
export interface Translator<M extends Messages> {
  readonly locale: string;
  /** The message, with `{name}` placeholders filled in. */
  readonly t: (key: TextKey<M>, params?: Params) => string;
  /** The plural form for `count`; `{count}` is the number formatted for the language. */
  readonly tn: (key: PluralKey<M>, count: number, params?: Params) => string;
}

/** A translator for one language; `dictionary` is the source one or a `Dictionary` of it. */
export function createTranslator<M extends Messages>(dictionary: M, locale: string): Translator<M> {
  const plurals = new Intl.PluralRules(locale);
  const numbers = new Intl.NumberFormat(locale);
  return {
    locale,
    t(key, params) {
      return fill(dictionary[key] as string, params);
    },
    tn(key, count, params) {
      const forms = dictionary[key] as Plural;
      const category = plurals.select(count);
      const template =
        (category === "one" || category === "few" || category === "many"
          ? forms[category]
          : undefined) ?? forms.other;
      return fill(template, { count: numbers.format(count), ...params });
    },
  };
}
