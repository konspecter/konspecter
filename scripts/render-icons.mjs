#!/usr/bin/env node
// Renders the app icon — the Konspecter bookmark: a slanted, woven # (tags, Markdown
// headings) whose one stroke is a red bookmark ribbon (the app remembers where you
// stopped) — for every platform, each in its own system's style, from the SVG below.
// Chromium (from the e2e tests' Playwright) rasterizes the SVG; the Tauri CLI packs the
// macOS .icns and the Windows .ico. The master artwork is in logo/ at the repository root.
//
//   pnpm icons
//
// macOS 26 draws an Icon Composer icon at whatever size it shows it, so it stays sharp
// where a bitmap would be scaled (the app switcher). Compiling one takes Xcode 26's
// actool, so the script runs on a Mac with Xcode 26 selected (xcode-select).
//
// Outputs (committed, so builds need none of this):
//   apps/desktop/src-tauri/icons/   macOS 26: Icon.icon (Icon Composer: the plate as a fill,
//                                   the mark as glass layers) and Assets.car, compiled
//                                   from it; macOS 11–15: squircle with margin and shadow
//                                   (PNGs, .icns); Windows: rounded square (.ico)
//   apps/web/public/                favicon.svg, PWA icons (any + maskable), Apple touch icon
//   apps/site/public/               favicon.svg and the header's logo.svg / logo-dark.svg
//                                   (no plate), Apple touch icon
//   apps/server/internal/mail/      logo.png: the emails' logo (rounded square, 48 px at 2x)
//   apps/mobile/android/.../res/    adaptive icon (foreground; the graphite background is
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

// The palette: a graphite plate, white strokes, a memory-red ribbon.
const COLORS = { top: "#2a2f37", bottom: "#1a1d22", strokes: "#ffffff", ribbon: "#e5484d" };
/** The strokes on a light page. */
const GRAPHITE = "#1f2328";

// The mark: the strokes of the # cross over and under each other, slanted 15°; the ribbon
// is wider than the strokes and hangs below the # in a notch. The # is centred on
// (512, 512), the ribbon is not, and the farthest point of the mark (the ribbon's tip) is
// 512 from the centre, so at `scale` the whole mark fits a circle of radius 512 × scale.
// SMALL is the cut for 16–32 px (the favicons): heavier strokes, wider gaps.
const MARK = {
  strokes:
    "M307.2 426.1 L337.2 314.1 L236.4 314.1 L206.4 426.1 Z M863.7 426.1 L893.7 314.1 L509 314.1 L479 426.1 Z M411.1 568 L514.2 183.4 L402.1 183.4 L299.1 568 Z M488.8 709.9 L518.9 597.9 L160.3 597.9 L130.3 709.9 Z M787.6 709.9 L817.6 597.9 L742.9 597.9 L712.9 709.9 Z M226 840.6 L338 840.6 L365.1 739.8 L253 739.8 Z",
  ribbon:
    "M659.8 183.4 L632.8 284.2 L797.1 284.2 L824.1 183.4 Z M545.8 915.3 L602 1012.4 L751.1 456 L586.8 456 L437.7 1012.4 Z",
};
const SMALL = {
  strokes:
    "M291.1 541.9 L433 541.9 L529.1 183.4 L387.2 183.4 Z M315.1 299.1 L240.4 299.1 L202.4 441 L277.1 441 Z M859.6 441 L897.7 299.1 L539.2 299.1 L501.1 441 Z M455 724.9 L493 583 L164.4 583 L126.3 724.9 Z M783.6 724.9 L821.6 583 L776.8 583 L738.8 724.9 Z M211.1 840.6 L353 840.6 L373 765.9 L231.1 765.9 Z",
  ribbon:
    "M641.1 183.4 L621.1 258.1 L822.8 258.1 L842.8 183.4 Z M545.8 915.3 L620.7 1012.4 L762.7 482.1 L561.1 482.1 L419 1012.4 Z",
};

const DEFS = `
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${COLORS.top}"/><stop offset="1" stop-color="${COLORS.bottom}"/>
  </linearGradient>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
    <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000000" flood-opacity="0.3"/>
  </filter>`;

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

/** The mark scaled by `scale` about the centre of its # and moved to (x, y). */
const markAt = (scale, { x = 512, y = 512, art = MARK, strokes = COLORS.strokes, mono } = {}) =>
  `<g transform="translate(${x} ${y}) scale(${scale}) translate(-512 -512)">
    <path class="strokes" fill="${mono ?? strokes}" d="${art.strokes}"/>
    <path fill="${mono ?? COLORS.ribbon}" d="${art.ribbon}"/></g>`;

const svg = (body, size = 1024) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><defs>${DEFS}</defs>${body}</svg>`;

const VARIANTS = {
  // macOS (Big Sur and later): a squircle on the 824 px grid, with margin and shadow.
  macos: svg(`
    <g filter="url(#shadow)"><path d="${squircle(512, 512, 412)}" fill="url(#bg)"/></g>
    <path d="${squircle(512, 512, 412)}" fill="none" stroke="#3a404a" stroke-width="2"/>
    ${markAt(0.62)}`),
  // Windows: a rounded square filling the tile, no shadow.
  windows: svg(`
    <rect x="16" y="16" width="992" height="992" rx="150" fill="url(#bg)"/>${markAt(0.72)}`),
  // iOS and the Apple touch icon: a full square; the system rounds it.
  ios: svg(`<rect width="1024" height="1024" fill="url(#bg)"/>${markAt(0.72)}`),
  // The favicon: the squircle filling its box, with the small-size cut.
  favicon: svg(
    `<path d="${squircle(512, 512, 512)}" fill="url(#bg)"/>${markAt(0.84, { art: SMALL })}`,
  ),
  // PWA, maskable: full bleed, the mark inside the 80% safe circle.
  maskable: svg(`<rect width="1024" height="1024" fill="url(#bg)"/>${markAt(0.76)}`),
  // Android adaptive icon foreground: transparent, the mark within the 66 dp safe circle.
  androidForeground: svg(markAt(0.58)),
  // Android 13 themed icons: one colour, which the system tints.
  androidMonochrome: svg(markAt(0.58, { mono: "#ffffff" })),
  // Android before adaptive icons: a rounded square and a circle.
  androidLegacy: svg(`
    <rect x="80" y="80" width="864" height="864" rx="150" fill="url(#bg)"/>${markAt(0.66)}`),
  androidRound: svg(`<circle cx="512" cy="512" r="440" fill="url(#bg)"/>${markAt(0.78)}`),
  // The account site: no plate. Its favicon follows the system's scheme; the header shows
  // the light or the dark logo by the site's theme (site.css).
  siteFavicon: svg(`
    <style>@media (prefers-color-scheme: dark) { .strokes { fill: #ffffff } }</style>
    ${markAt(0.98, { art: SMALL, strokes: GRAPHITE })}`),
  siteLogo: svg(markAt(0.98, { strokes: GRAPHITE })),
  siteLogoDark: svg(markAt(0.98)),
};

/** A splash screen: the mark centred on the graphite plate, sized to the shorter side. */
function splash(width, height) {
  const scale = (Math.min(width, height) * 0.4) / 1024;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><defs>${DEFS}</defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    ${markAt(scale, { x: width / 2, y: height / 2 })}</svg>`;
}

// macOS 26: an Icon Composer icon. The system draws the plate (the fill), its edge and
// shadow, and lights the layers as glass; the mark keeps its size on the plate of the
// .icns (0.62 of the 824 px squircle is 0.77 of the full canvas).
const GLASS_SCALE = (0.62 * 1024) / 824;
/** A path of absolute M/L points scaled about the centre of the #, the transform baked in. */
const scaled = (d, scale) =>
  d.replace(/(-?[\d.]+) (-?[\d.]+)/g, (_, x, y) =>
    [x, y].map((v) => (512 + (Number(v) - 512) * scale).toFixed(1)).join(" "),
  );
const layer = (d, fill) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><path fill="${fill}" d="${scaled(d, GLASS_SCALE)}"/></svg>\n`;
const srgb = (hex) =>
  `srgb:${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(",")},1.00000`;
const ICON_COMPOSER = {
  "icon.json": `${JSON.stringify(
    {
      fill: {
        "linear-gradient": [srgb(COLORS.top), srgb(COLORS.bottom)],
        orientation: { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: 1 } },
      },
      groups: [
        {
          layers: [
            { "image-name": "strokes.svg", name: "strokes" },
            { "image-name": "ribbon.svg", name: "ribbon" },
          ],
        },
      ],
      "supported-platforms": { circles: ["watchOS"], squares: "shared" },
    },
    null,
    2,
  )}\n`,
  "Assets/strokes.svg": layer(MARK.strokes, COLORS.strokes),
  "Assets/ribbon.svg": layer(MARK.ribbon, COLORS.ribbon),
};

/** The major version of Xcode's actool, or 0 without Xcode. */
function actoolVersion() {
  try {
    const out = execFileSync(
      "xcrun",
      ["actool", "--version", "--output-format", "human-readable-text"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return Number(/short-bundle-version: (\d+)/.exec(out)?.[1] ?? 0);
  } catch {
    return 0;
  }
}

if (actoolVersion() < 26) {
  console.error(
    "The macOS icon (Assets.car) needs Xcode 26 or later: install it and select it with xcode-select.",
  );
  process.exit(1);
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

  // macOS 26: the Icon Composer source and Assets.car, compiled as the Tauri bundler would
  // compile it (the bundler takes the .car as it is, so release builds need no Xcode 26).
  const iconComposer = join(desktopIcons, "Icon.icon");
  rmSync(iconComposer, { recursive: true, force: true });
  for (const [name, content] of Object.entries(ICON_COMPOSER)) {
    mkdirSync(dirname(join(iconComposer, name)), { recursive: true });
    writeFileSync(join(iconComposer, name), content);
  }
  const car = join(work, "car");
  mkdirSync(car);
  execFileSync(
    "xcrun",
    [
      "actool",
      iconComposer,
      "--compile",
      car,
      "--output-format",
      "human-readable-text",
      "--notices",
      "--warnings",
      "--output-partial-info-plist",
      join(car, "Info.plist"),
      "--app-icon",
      "Icon",
      "--include-all-app-icons",
      "--enable-on-demand-resources",
      "NO",
      "--development-region",
      "en",
      "--target-device",
      "mac",
      "--minimum-deployment-target",
      "26.0",
      "--platform",
      "macosx",
    ],
    { stdio: "inherit" },
  );
  copyFileSync(join(car, "Assets.car"), join(desktopIcons, "Assets.car"));

  // Web.
  const web = join(root, "apps/web/public");
  writeFileSync(join(web, "favicon.svg"), `${VARIANTS.favicon}\n`);
  await png(VARIANTS.macos, join(web, "icon-192.png"), 192);
  await png(VARIANTS.macos, join(web, "icon-512.png"), 512);
  await png(VARIANTS.maskable, join(web, "icon-maskable-512.png"), 512);
  await png(VARIANTS.ios, join(web, "apple-touch-icon.png"), 180);

  // The account site: its own transparent favicon and header logos, the app's touch icon.
  const site = join(root, "apps/site/public");
  writeFileSync(join(site, "favicon.svg"), `${VARIANTS.siteFavicon}\n`);
  writeFileSync(join(site, "logo.svg"), `${VARIANTS.siteLogo}\n`);
  writeFileSync(join(site, "logo-dark.svg"), `${VARIANTS.siteLogoDark}\n`);
  copyFileSync(join(web, "apple-touch-icon.png"), join(site, "apple-touch-icon.png"));

  // The server's emails: a small PNG, since mail apps show no SVG.
  await png(VARIANTS.windows, join(root, "apps/server/internal/mail/logo.png"), 96);

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
