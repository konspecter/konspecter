#!/usr/bin/env node
// Renders the app icon — the Konspecter owl, a friendly orange and brown owl holding an
// ancient scroll — for every platform, each in its own system's style, from the SVG
// drawn below. Chromium (from the e2e tests' Playwright) rasterizes the SVG;
// the Tauri CLI packs the macOS .icns and the Windows .ico.
//
//   pnpm icons
//
// Outputs (committed, so builds need none of this):
//   apps/desktop/src-tauri/icons/   macOS: squircle with margin and shadow (PNGs, .icns);
//                                   Windows: rounded square (.ico)
//   apps/web/public/                favicon.svg, PWA icons (any + maskable), Apple touch icon
//   apps/mobile/android/.../res/    adaptive icon (foreground; the gradient background is
//                                   drawable/ic_launcher_background.xml), themed-icon
//                                   monochrome layer, legacy square and round icons, splashes
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "tests", "package.json"));
const { chromium } = require("@playwright/test");

// --- The art (1024 × 1024) ---------------------------------------------------

// The palette: warm cream for the plate and face, orange plumage, brown for the
// outlines, red for the beak, aged parchment and dark wood for the scroll. The style is
// a simple, friendly flat mascot with one fine outline weight and few shapes.
const COLORS = { top: "#fff8ee", bottom: "#fde3c6" };
const INK = "#3d2416";
const LINE = 14;

const BODY =
  "M312 246C330 300 336 322 356 336C400 318 452 310 512 310C572 310 624 318 668 336C688 322 694 300 712 246C760 300 786 390 786 500C786 680 670 830 512 830C354 830 238 680 238 500C238 390 264 300 312 246Z";
const FACE =
  "M512 384C476 352 432 342 392 350C330 362 290 414 290 476C290 548 344 598 412 598C452 598 488 582 512 558C536 582 572 598 612 598C680 598 734 548 734 476C734 414 694 362 632 350C592 342 548 352 512 384Z";
const BEAK = "M478 560Q512 540 546 560L526 626Q512 648 498 626Z";
const EYES = [412, 612];

// The scroll the owl holds, an ancient one: a parchment sheet with wavy edges unrolled
// between two rolls, each on a wooden rod whose knobs show above and below, and three
// lines of old handwriting.
const SHEET =
  "M340 692C400 680 452 704 512 692C572 680 624 704 684 692V816C624 828 572 804 512 816C452 828 400 804 340 816Z";
const ROLL_X = [320, 704];
const ROLL = { rx: 30, ry: 11, top: 682, bottom: 826 };
/** A rolled end: a cylinder, its top face drawn by ROLL_TOPS. */
const ROLLS = ROLL_X.map(
  (x) =>
    `M${x - ROLL.rx} ${ROLL.top}V${ROLL.bottom}A${ROLL.rx} ${ROLL.ry} 0 0 0 ${x + ROLL.rx} ${ROLL.bottom}V${ROLL.top}A${ROLL.rx} ${ROLL.ry} 0 0 0 ${x - ROLL.rx} ${ROLL.top}Z`,
).join("");
const ROLL_TOPS = ROLL_X.map(
  (x) =>
    `M${x - ROLL.rx} ${ROLL.top}A${ROLL.rx} ${ROLL.ry} 0 1 0 ${x + ROLL.rx} ${ROLL.top}A${ROLL.rx} ${ROLL.ry} 0 1 0 ${x - ROLL.rx} ${ROLL.top}Z`,
).join("");
/** The rolled-up parchment seen end on: a curl inside each top face. */
const CURLS = ROLL_X.map((x) => `M${x - 14} ${ROLL.top}A14 5 0 1 0 ${x + 8} ${ROLL.top - 3}`).join(
  "",
);
/** The wooden rods: a rounded knob above and below each roll. */
const RODS = ROLL_X.map((x) => `M${x - 13} 660a13 13 0 0 1 26 0V852a13 13 0 0 1 -26 0Z`).join("");
/** Handwriting: rows of short wavy words. */
const WRITING = [
  [732, [388, 438, 470, 540, 574, 636]],
  [758, [388, 462, 494, 560, 592, 636]],
  [784, [388, 452, 484, 544]],
]
  .map(([y, xs]) => {
    const words = [];
    for (let i = 0; i < xs.length; i += 2) {
      const steps = Math.round((xs[i + 1] - xs[i]) / 16);
      words.push(`M${xs[i]} ${y}q4 -7 8 0${"t8 0".repeat(steps * 2 - 1)}`);
    }
    return words.join("");
  })
  .join("");

const DEFS = `
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${COLORS.top}"/><stop offset="1" stop-color="${COLORS.bottom}"/>
  </linearGradient>
  <mask id="silhouette" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
    <path d="${BODY}" fill="#fff"/>
    ${EYES.map((x) => `<circle cx="${x}" cy="476" r="72" fill="#000"/><circle cx="${x}" cy="482" r="34" fill="#fff"/>`).join("")}
    <path d="${BEAK}" fill="#000"/>
    <g fill="#fff" stroke="#000" stroke-width="${LINE}" stroke-linejoin="round">
      <path d="${RODS}"/><path d="${SHEET}"/><path d="${ROLLS}"/><path d="${ROLL_TOPS}"/>
    </g>
    <path d="${CURLS}${WRITING}" fill="none" stroke="#000" stroke-width="8" stroke-linecap="round"/>
  </mask>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
    <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#6b3a17" flood-opacity="0.28"/>
  </filter>`;

/** One eye: a big amber iris, a dark pupil and a catch-light. */
const eye = (x) => `
    <circle cx="${x}" cy="476" r="72" fill="#f59e2a" stroke-width="10"/>
    <circle cx="${x}" cy="482" r="44" fill="${INK}" stroke="none"/>
    <circle cx="${x + 16}" cy="464" r="16" fill="#ffffff" stroke="none"/>`;

/** The owl, about 550 × 610, centred on (512, 554): flat fills, one outline weight. */
const OWL = `
  <g stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round" stroke-linecap="round">
    <path fill="#d9722f" d="${BODY}"/>
    <path fill="#fde2bd" d="${FACE}"/>
    ${EYES.map(eye).join("")}
    <path fill="#e2472b" stroke-width="10" d="${BEAK}"/>
    <path fill="#8e4322" d="${RODS}"/>
    <path fill="#f3dca8" d="${SHEET}"/>
    <path fill="none" stroke="#9a5a32" stroke-width="7" d="${WRITING}"/>
    <path fill="#e2c07e" d="${ROLLS}"/>
    <path fill="#f3dca8" d="${ROLL_TOPS}"/>
    <path fill="none" stroke="#b07f45" stroke-width="7" d="${CURLS}"/>
  </g>`;

/** A superellipse (|x|ⁿ + |y|ⁿ = 1): the continuous-corner shape of macOS and iOS icons. */
function squircle(cx, cy, half, n = 5, steps = 256) {
  const points = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = cx + half * Math.sign(cos) * Math.abs(cos) ** (2 / n);
    const y = cy + half * Math.sign(sin) * Math.abs(sin) ** (2 / n);
    points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `M${points.join("L")}Z`;
}

/** The owl scaled by `scale` about its centre and moved to (x, y). */
const owlAt = (scale, x = 512, y = 512) =>
  `<g transform="translate(${x} ${y}) scale(${scale}) translate(-512 -554)">${OWL}</g>`;

const svg = (body, size = 1024) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><defs>${DEFS}</defs>${body}</svg>`;

const VARIANTS = {
  // macOS (Big Sur and later): a squircle on the 824 px grid, with margin and shadow.
  macos: svg(`
    <g filter="url(#shadow)"><path d="${squircle(512, 512, 412)}" fill="url(#bg)"/></g>
    <path d="${squircle(512, 512, 412)}" fill="none" stroke="#f1cfa8" stroke-width="2"/>
    ${owlAt(0.98, 512, 520)}`),
  // Windows: a rounded square filling the tile, no shadow.
  windows: svg(`
    <rect x="16" y="16" width="992" height="992" rx="150" fill="url(#bg)"/>
    ${owlAt(1.12, 512, 520)}`),
  // iOS and the Apple touch icon: a full square; the system rounds it.
  ios: svg(`<rect width="1024" height="1024" fill="url(#bg)"/>${owlAt(1.16, 512, 520)}`),
  // The favicon: the squircle filling its box.
  favicon: svg(`<path d="${squircle(512, 512, 512)}" fill="url(#bg)"/>${owlAt(1.16, 512, 520)}`),
  // PWA, maskable: full bleed, the owl inside the 80% safe zone.
  maskable: svg(`<rect width="1024" height="1024" fill="url(#bg)"/>${owlAt(0.96, 512, 520)}`),
  // Android adaptive icon foreground: transparent, the owl within the 66 dp safe circle.
  androidForeground: svg(owlAt(0.82, 512, 520)),
  // Android before adaptive icons: a rounded square and a circle.
  // Android 13 themed icons: one colour, which the system tints; eyes, beak and scroll cut out.
  androidMonochrome: svg(
    `<g transform="translate(512 520) scale(0.82) translate(-512 -554)"><rect width="1024" height="1024" fill="#fff" mask="url(#silhouette)"/></g>`,
  ),
  androidLegacy: svg(`
    <rect x="80" y="80" width="864" height="864" rx="150" fill="url(#bg)"/>${owlAt(1, 512, 520)}`),
  androidRound: svg(`<circle cx="512" cy="512" r="440" fill="url(#bg)"/>${owlAt(0.94, 512, 520)}`),
};

/** A splash screen: the owl centred on the gradient, sized to the shorter side. */
function splash(width, height) {
  const size = Math.min(width, height) * 0.5;
  const scale = size / 600;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><defs>${DEFS}</defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <g transform="translate(${width / 2} ${height / 2}) scale(${scale}) translate(-512 -554)">${OWL}</g></svg>`;
}

// --- Rendering -----------------------------------------------------------------

const browser = await chromium.launch();
async function png(markup, path, width, height = width) {
  const page = await browser.newPage({ viewport: { width, height } });
  const sized = markup.replace("<svg ", `<svg width="${width}" height="${height}" `);
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${sized}</body></html>`,
  );
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, omitBackground: true });
  await page.close();
}

const work = mkdtempSync(join(tmpdir(), "konspecter-icons-"));
try {
  // Desktop: the Tauri CLI makes every size and the .icns/.ico from a 1024 px PNG.
  const desktopIcons = join(root, "apps/desktop/src-tauri/icons");
  const tauri = (source, output) =>
    execFileSync(
      "pnpm",
      ["--filter", "@konspecter/desktop", "exec", "tauri", "icon", source, "-o", output],
      {
        cwd: root,
        stdio: "ignore",
      },
    );
  await png(VARIANTS.macos, join(work, "macos.png"), 1024);
  await png(VARIANTS.windows, join(work, "windows.png"), 1024);
  tauri(join(work, "macos.png"), join(work, "macos"));
  tauri(join(work, "windows.png"), join(work, "windows"));
  for (const name of [
    "32x32.png",
    "64x64.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.png",
    "icon.icns",
  ]) {
    copyFileSync(join(work, "macos", name), join(desktopIcons, name));
  }
  copyFileSync(join(work, "windows", "icon.ico"), join(desktopIcons, "icon.ico"));

  // Web.
  const web = join(root, "apps/web/public");
  writeFileSync(join(web, "favicon.svg"), `${VARIANTS.favicon}\n`);
  await png(VARIANTS.macos, join(web, "icon-192.png"), 192);
  await png(VARIANTS.macos, join(web, "icon-512.png"), 512);
  await png(VARIANTS.maskable, join(web, "icon-maskable-512.png"), 512);
  await png(VARIANTS.ios, join(web, "apple-touch-icon.png"), 180);

  // Android.
  const res = join(root, "apps/mobile/android/app/src/main/res");
  // Density: icon scale, and the portrait splash size Capacitor generated.
  const densities = {
    mdpi: [1, 320, 480],
    hdpi: [1.5, 480, 800],
    xhdpi: [2, 720, 1280],
    xxhdpi: [3, 960, 1600],
    xxxhdpi: [4, 1280, 1920],
  };
  for (const [density, [factor, short, long]] of Object.entries(densities)) {
    const mipmap = join(res, `mipmap-${density}`);
    await png(VARIANTS.androidForeground, join(mipmap, "ic_launcher_foreground.png"), 108 * factor);
    await png(VARIANTS.androidMonochrome, join(mipmap, "ic_launcher_monochrome.png"), 108 * factor);
    await png(VARIANTS.androidLegacy, join(mipmap, "ic_launcher.png"), 48 * factor);
    await png(VARIANTS.androidRound, join(mipmap, "ic_launcher_round.png"), 48 * factor);
    await png(splash(short, long), join(res, `drawable-port-${density}/splash.png`), short, long);
    await png(splash(long, short), join(res, `drawable-land-${density}/splash.png`), long, short);
  }
  await png(splash(480, 320), join(res, "drawable/splash.png"), 480, 320);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
console.log("Icons rendered.");
