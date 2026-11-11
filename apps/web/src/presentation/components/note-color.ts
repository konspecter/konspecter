import type { CSSProperties } from "react";
import { noteColor } from "../../domain/document/document";

/**
 * A note's colour: the frontmatter's `color`, or else a pastel whose hue the
 * note's id picks, so each note keeps its colour without one being written.
 * The pastel's saturation and lightness come from the theme (app.css).
 */

/** A hue from 0 to 359 from the id's characters (FNV-1a). */
export function defaultHue(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0) % 360;
}

/**
 * The CSS custom properties that paint a note's colour: `--cover-hue` for the
 * default pastel, and with a colour of its own `--cover-color` and the
 * `--cover-ink` that reads on it.
 */
export function colorStyle(id: string, color: string | null): CSSProperties {
  const style: Record<string, string | number> = { "--cover-hue": defaultHue(id) };
  if (color !== null) {
    style["--cover-color"] = color;
    style["--cover-ink"] = inkOn(color);
  }
  return style;
}

/** Dark or light text, whichever contrasts more with `color` (WCAG relative luminance). */
export function inkOn(color: string): string {
  const luminance = relativeLuminance(color);
  const againstBlack = (luminance + 0.05) / 0.05;
  const againstWhite = 1.05 / (luminance + 0.05);
  return againstBlack >= againstWhite ? "rgb(0 0 0 / 62%)" : "rgb(255 255 255 / 90%)";
}

function relativeLuminance(color: string): number {
  const [red, green, blue] = channels(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function channels(color: string): [number, number, number] {
  const hex = noteColor(color) ?? "#000000";
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** `#rrggbb` of a hue (degrees), saturation and lightness (0 to 1). */
export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    const value = lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** The hue (degrees), saturation and lightness (0 to 1) of a `#rrggbb` colour. */
export function hexToHsl(color: string): { hue: number; saturation: number; lightness: number } {
  const [red, green, blue] = channels(color).map((value) => value / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0, lightness };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const sector =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return { hue: (sector * 60 + 360) % 360, saturation, lightness };
}

/** How many colours the picker keeps under its spectrum. */
export const RECENT_COLORS = 9;

/** The colours picked last, per device in localStorage, newest first. */
const RECENT_KEY = "konspecter.recentColors";

export function recentColors(storage: Storage = localStorage): string[] {
  try {
    const saved: unknown = JSON.parse(storage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(saved)) return [];
    const colors = saved.flatMap((item) => (typeof item === "string" ? [noteColor(item)] : []));
    return [...new Set(colors.filter((color): color is string => color !== null))].slice(
      0,
      RECENT_COLORS,
    );
  } catch {
    return [];
  }
}

/** Puts `color` first among the recent colours (once), dropping the oldest past nine. */
export function rememberColor(color: string, storage: Storage = localStorage): string[] {
  const colors = [color, ...recentColors(storage).filter((recent) => recent !== color)].slice(
    0,
    RECENT_COLORS,
  );
  try {
    storage.setItem(RECENT_KEY, JSON.stringify(colors));
  } catch {
    // A per-device convenience.
  }
  return colors;
}
