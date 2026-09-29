import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** WCAG 2.1 AA checks (axe-core) on every screen, in both themes. */
async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.map(
    (v) => `${v.id} (${String(v.nodes.length)}): ${v.nodes[0]?.target.join(" ") ?? ""}`,
  );
}

async function seed(page: Page) {
  await page.goto("/notes/new");
  await page.getByRole("textbox", { name: "Note text" }).click();
  await page.keyboard.type("# Accessible note");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Some text with #tag and a list:");
  await expect(page).toHaveURL(/\/notes\/(?!new$)[^/]+$/, { timeout: 10_000 });
  await expect(
    page.getByRole("img", { name: "Everything is stored on this device" }),
  ).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  test(`every screen passes WCAG AA checks (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    expect(await audit(page), "empty list").toEqual([]);
    await seed(page);
    const note = page.url();
    expect(await audit(page), "note").toEqual([]);

    for (const path of ["/", "/?q=note", "/?q=%23tag", "/settings", "/notes/new", "/nowhere"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await audit(page), path).toEqual([]);
    }
    await page.goto(note);
    const editor = page.getByRole("textbox", { name: "Note text" });
    await editor.click();
    await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
    expect(await audit(page), "text editor with its toolbar").toEqual([]);
    await page.getByRole("banner").getByRole("button", { name: "Markdown" }).click();
    expect(await audit(page), "markdown editor").toEqual([]);
    await page.getByRole("banner").getByRole("button", { name: "Dark theme" }).click();
    expect(await audit(page), "after toggling the theme").toEqual([]);
  });
}

test("no screen overflows sideways on a phone", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await seed(page);
  const note = page.url();
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  for (const path of ["/", "/?q=note", "/settings", "/notes/new", note]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await overflow(), path).toBeLessThanOrEqual(0);
  }
  // The sidebar starts closed on a phone and slides over the page when opened.
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeHidden();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
  expect(await overflow(), "open sidebar").toBeLessThanOrEqual(0);
  await context.close();
});

test("the layout fills the window at any size", async ({ page }) => {
  for (const [width, height] of [
    [1400, 900],
    [900, 600],
    [700, 500],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const main = await page.locator(".main").boundingBox();
    expect(main?.height, `${String(width)}×${String(height)}`).toBeGreaterThanOrEqual(height);
    expect((main?.x ?? 0) + (main?.width ?? 0)).toBeCloseTo(width, 0);
    const sidebar = page.getByRole("complementary", { name: "Sidebar" });
    if (await sidebar.isVisible()) {
      expect((await sidebar.boundingBox())?.height).toBeCloseTo(height, 0);
    }
  }
});

test("the shortcuts dialog is accessible", async ({ page }) => {
  await page.goto("/");
  // Wait for the app to render (and its shortcut listener to exist).
  await expect(page.getByRole("region", { name: "Welcome to Konspecter" })).toBeVisible();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  expect(await audit(page)).toEqual([]);
});
