/**
 * The splash screen in index.html: the logo, whose red bookmark fills from the bottom as the
 * app starts. Its look is inline there, so it shows at the first paint. A download cannot be
 * measured, so while the scripts load the bookmark fills on a timer; from here on, the stages
 * of the start say how far it is.
 */
const STAGES = {
  /** main.tsx runs: the scripts and the styles have arrived. */
  scripts: 0.6,
  storage: 0.75,
  /** The library is open: the app renders next. */
  library: 0.9,
} as const;

export type StartStage = keyof typeof STAGES;

/** How long the bookmark takes to fill the rest, and the splash to fade (index.html). */
const FILL_MS = 150;
const FADE_MS = 180;

function splashElement(): HTMLElement | null {
  return document.getElementById("splash");
}

function fill(splash: HTMLElement, share: number): void {
  splash.style.setProperty("--splash-progress", String(share));
  splash.setAttribute("aria-valuenow", String(Math.round(share * 100)));
}

export function showStage(stage: StartStage, splash = splashElement()): void {
  if (splash) fill(splash, STAGES[stage]);
}

/**
 * Fills the bookmark, fades the splash out over the rendered app and removes it. A start
 * quicker than the logo's 150 ms delay never shows it: the empty page fades out at once.
 */
export function hideSplash(splash = splashElement()): void {
  if (!splash || splash.dataset.hiding !== undefined) return;
  splash.dataset.hiding = "";
  fill(splash, 1);
  // Still fully transparent: its fade-in (index.html) has not begun.
  const logo = splash.querySelector(".splash-logo");
  const quick = logo !== null && getComputedStyle(logo).opacity === "0";
  if (quick) splash.classList.add("splash-quick");
  setTimeout(
    () => {
      splash.classList.add("splash-out");
      setTimeout(() => {
        splash.remove();
      }, FADE_MS);
    },
    quick ? 0 : FILL_MS,
  );
}

/**
 * The build preloads the app's stylesheets instead of linking them (vite.config.ts): a link
 * in <head> would hold the splash's first paint back until they arrive. This applies them and
 * resolves once they have loaded (or failed), so the app never renders unstyled.
 */
export async function applyStyles(doc: Document = document): Promise<void> {
  const links = doc.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="style"]');
  await Promise.all(
    Array.from(links, (link) => {
      const loaded = new Promise<void>((resolve) => {
        link.addEventListener("load", () => {
          resolve();
        });
        link.addEventListener("error", () => {
          resolve();
        });
      });
      link.rel = "stylesheet";
      return loaded;
    }),
  );
}
