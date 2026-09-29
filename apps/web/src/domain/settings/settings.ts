import type { ReadingPositionMode } from "../reading/reading";

export type Theme = "system" | "light" | "dark";
export type EditorMode = "text" | "markdown";

export type Settings = {
  readonly theme: Theme;
  readonly defaultEditor: EditorMode;
  /** Multiplier for reading and editing text. */
  readonly fontScale: number;
  readonly readingPosition: ReadingPositionMode;
};

export const FONT_SCALES = [0.9, 1, 1.15, 1.3] as const;

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  defaultEditor: "text",
  fontScale: 1,
  readingPosition: "restore",
};

function oneOf<T extends string | number>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/**
 * Validates stored settings field by field: an unknown or invalid value falls
 * back to its default without discarding the other settings.
 */
export function parseSettings(value: unknown): Settings {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    theme: oneOf(record.theme, ["system", "light", "dark"], DEFAULT_SETTINGS.theme),
    defaultEditor: oneOf(
      record.defaultEditor,
      ["text", "markdown"],
      DEFAULT_SETTINGS.defaultEditor,
    ),
    fontScale: oneOf(record.fontScale, FONT_SCALES, DEFAULT_SETTINGS.fontScale),
    readingPosition: oneOf(
      record.readingPosition,
      ["restore", "ask", "off"],
      DEFAULT_SETTINGS.readingPosition,
    ),
  };
}
