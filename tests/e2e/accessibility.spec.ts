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
  await page.goto("/conspects/new");
  await page.getByRole("textbox", { name: "Conspect text" }).click();
  await page.keyboard.type("# Accessible note");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Some text with #tag and a list:");
  await expect(page).toHaveURL(/\/conspects\/(?!new$)[^/]+$/, { timeout: 10_000 });
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

    for (const path of ["/", "/?q=note", "/?q=%23tag", "/settings", "/conspects/new", "/nowhere"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await audit(page), path).toEqual([]);
    }
    await page.goto(note);
    const editor = page.getByRole("textbox", { name: "Conspect text" });
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

  for (const path of ["/", "/?q=note", "/settings", "/conspects/new", note]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await overflow(), path).toBeLessThanOrEqual(0);
  }
  // The sidebar starts closed on a phone and covers the screen when opened from the island.
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const island = page.getByRole("navigation", { name: "Main actions" });
  await expect(sidebar).toBeHidden();
  await island.getByRole("button", { name: "Show sidebar" }).click();
  await expect(sidebar).toBeVisible();
  expect((await sidebar.boundingBox())?.width).toBeCloseTo(360, 0);
  await expect(island).toBeVisible();
  expect(await overflow(), "open sidebar").toBeLessThanOrEqual(0);
  // The note's details wait behind their button.
  const details = sidebar.getByRole("button", { name: "Details" });
  await expect(sidebar.getByText("Created")).toBeHidden();
  await details.click();
  await expect(sidebar.getByText("Created")).toBeVisible();
  expect(await audit(page), "open sidebar with details").toEqual([]);
  // The search fills the island, with its close button at the end.
  await island.getByRole("button", { name: "Hide sidebar" }).click();
  await island.getByRole("button", { name: "Search in this conspect" }).click();
  await expect(island.getByRole("searchbox")).toBeFocused();
  expect(await overflow(), "island search").toBeLessThanOrEqual(0);
  expect(await audit(page), "island search").toEqual([]);
  await island.getByRole("button", { name: "Close search" }).click();
  await expect(island.getByRole("searchbox")).toBeHidden();
  // The island stays while the text is edited, and holds the editor's tools.
  await page.getByRole("textbox", { name: "Conspect text" }).click();
  await expect(island).toBeVisible();
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await expect(toolbar).toBeHidden();
  await island.getByRole("button", { name: "Formatting" }).click();
  await expect(toolbar).toBeVisible();
  expect(await overflow(), "island tools").toBeLessThanOrEqual(0);
  expect(await audit(page), "island tools").toEqual([]);
  await toolbar.getByRole("button", { name: "Bold" }).click();
  await expect(toolbar).toBeHidden();
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
    // Up to the scrollbar's room, which is kept even when nothing scrolls (stable layout).
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect((main?.x ?? 0) + (main?.width ?? 0)).toBeCloseTo(clientWidth, 0);
    const sidebar = page.getByRole("complementary", { name: "Sidebar" });
    if (await sidebar.isVisible()) {
      expect((await sidebar.boundingBox())?.height).toBeCloseTo(height, 0);
    }
  }
});

test("the sidebar's panes stay inside it, whatever the titles", async ({ page }) => {
  await page.goto("/conspects/new");
  await page.getByRole("textbox", { name: "Conspect text" }).click();
  await page.keyboard.type("# A conspect title far too long to fit in the sidebar's width at all");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Text #tag");
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const recent = sidebar.getByRole("navigation", { name: "Recent" });
  await expect(recent.getByRole("link", { name: /far too long/ })).toBeVisible();
  const right =
    ((await sidebar.boundingBox())?.x ?? 0) + ((await sidebar.boundingBox())?.width ?? 0);
  for (const name of ["Tags", "Recent", "Details"]) {
    const header = await sidebar.getByRole("button", { name, exact: true }).boundingBox();
    expect((header?.x ?? 0) + (header?.width ?? 0), name).toBeLessThanOrEqual(right);
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
