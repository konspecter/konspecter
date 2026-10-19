import { expect, test } from "@playwright/test";

/** The logo's box in index.html: its viewBox. */
const ASPECT = 771.4 / 837;

// Portrait and landscape phones, a tablet, a laptop and an ultrawide screen.
const SCREENS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 2400, height: 1080 },
];

test.describe("splash screen", () => {
  for (const screen of SCREENS) {
    test(`the logo keeps its shape and a ninth of the area at ${String(screen.width)}×${String(screen.height)}`, async ({
      page,
    }) => {
      await page.setViewportSize(screen);
      // The scripts and styles never arrive: the splash must paint without them.
      await page.route("**/assets/**", () => undefined);
      await page.goto("/", { waitUntil: "commit" });

      const splash = page.getByRole("progressbar", { name: "Konspecter" });
      await expect(splash).toBeVisible();
      // A slow start: the logo fades in after 150 ms.
      await expect(splash.locator(".splash-logo")).toHaveCSS("opacity", "1");
      const logo = await splash.locator(".splash-logo").boundingBox();
      if (!logo) throw new Error("The logo has no box");
      expect(logo.width / logo.height).toBeCloseTo(ASPECT, 2);
      const share = (logo.width * logo.height) / (screen.width * screen.height);
      expect(share).toBeGreaterThan(0.99 / 9);
      expect(share).toBeLessThan(1.01 / 9);
      // Centred, with the version right under it, on the screen.
      expect(logo.x + logo.width / 2).toBeCloseTo(screen.width / 2, 0);
      expect(logo.y + logo.height / 2).toBeCloseTo(screen.height / 2, 0);
      const version = await splash.getByText(/^\d+\.\d+\.\d+/).boundingBox();
      if (!version) throw new Error("The version has no box");
      expect(version.y).toBeGreaterThan(logo.y + logo.height);
      expect(version.y + version.height).toBeLessThan(screen.height);
    });
  }

  test("goes once the app has started", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#splash")).toHaveCount(0);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.locator('link[rel="preload"][as="style"]')).toHaveCount(0);
  });
});
