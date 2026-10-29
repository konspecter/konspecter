import { expect, test } from "@playwright/test";

// A laptop and a phone: the source editor sets its lines differently on each.
const SCREENS = [
  { width: 1280, height: 900 },
  { width: 390, height: 800 },
];

/** A long code block, then paragraphs that wrap. */
const NOTE = [
  "# Selection",
  "",
  "```js",
  ...Array.from({ length: 150 }, (_, index) => `line(${String(index)});`),
  "```",
  "",
  ...Array.from({ length: 8 }, (_, index) => [
    `Paragraph ${String(index)} of plain text, long enough to wrap onto another line here.`,
    "",
  ]).flat(),
].join("\n");

test.describe("Markdown mode", () => {
  for (const screen of SCREENS) {
    test(`draws the selection over the text it selects at ${String(screen.width)}×${String(screen.height)}`, async ({
      page,
    }) => {
      await page.setViewportSize(screen);
      await page.goto("/conspects/new");
      await page.getByRole("banner").getByRole("button", { name: "Markdown" }).click();
      await page.getByRole("textbox", { name: "Markdown" }).click();
      await page.keyboard.insertText(NOTE);

      const line = (text: string) => page.locator(".cm-line", { hasText: text });
      await line("Paragraph 3 of").scrollIntoViewIfNeeded();
      // CodeMirror draws only the lines near the window: the first it draws is
      // code now, and code lines are set in from the block's edges.
      await expect(page.locator(".cm-content .cm-line").first()).toHaveClass(/cm-code-line/);
      await line("Paragraph 2 of").click({ position: { x: 1, y: 5 } });
      await line("Paragraph 5 of").click({ position: { x: 40, y: 5 }, modifiers: ["Shift"] });
      await expect(page.locator(".cm-selectionBackground").first()).toBeAttached();

      const { text, band } = await page.evaluate(() => {
        const lines = [...document.querySelectorAll(".cm-line")].filter((element) =>
          element.textContent.startsWith("Paragraph"),
        );
        const left = Math.min(
          ...lines.map((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return range.getClientRects()[0]?.left ?? Infinity;
          }),
        );
        const right = Math.max(
          ...lines.map(
            (element) =>
              element.getBoundingClientRect().right -
              Number.parseFloat(getComputedStyle(element).paddingRight),
          ),
        );
        // The band across the whole lines between the selection's first and last.
        const drawn = [...document.querySelectorAll(".cm-selectionBackground")]
          .map((element) => element.getBoundingClientRect())
          .sort((a, b) => b.height - a.height)[0];
        return {
          text: { left, right },
          band: drawn ? { left: drawn.left, right: drawn.right } : null,
        };
      });
      expect(band).not.toBeNull();
      expect(band?.left).toBeCloseTo(text.left, 0);
      expect(band?.right).toBeCloseTo(text.right, 0);
    });
  }
});

/** The contrast ratio of two CSS colours ("rgb(…)"), as WCAG defines it. */
function contrast(a: string, b: string): number {
  const luminance = (color: string) => {
    const [r = 0, g = 0, bl = 0] = (color.match(/[\d.]+/g) ?? []).map(Number);
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(bl);
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

test.describe("the cursor", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`stands out from the editor in the ${colorScheme} theme, in either mode`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/conspects/new");
      await page.getByRole("textbox", { name: "Conspect text" }).click();
      await page.keyboard.type("Some text");
      const background = () =>
        page.evaluate(() => {
          let element: Element | null = document.querySelector(".note-editor");
          while (element) {
            const color = getComputedStyle(element).backgroundColor;
            if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
            element = element.parentElement;
          }
          return getComputedStyle(document.body).backgroundColor;
        });

      const caret = await page
        .locator(".text-editor-content")
        .evaluate((element) => getComputedStyle(element).caretColor);
      expect(contrast(caret, await background())).toBeGreaterThan(4.5);

      await page.getByRole("banner").getByRole("button", { name: "Markdown" }).click();
      await page.getByRole("textbox", { name: "Markdown" }).click();
      const cursor = page.locator(".cm-cursor-primary");
      await expect(cursor).toBeAttached();
      const drawn = await cursor.evaluate((element) => getComputedStyle(element).borderLeftColor);
      expect(contrast(drawn, await background())).toBeGreaterThan(4.5);
    });
  }

  test("is wider on a touch screen", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 800 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto("/conspects/new");
    await page.getByRole("banner").getByRole("button", { name: "Markdown" }).click();
    await page.getByRole("textbox", { name: "Markdown" }).click();
    const cursor = page.locator(".cm-cursor-primary");
    await expect(cursor).toBeAttached();
    expect(await cursor.evaluate((element) => getComputedStyle(element).borderLeftWidth)).toBe(
      "2px",
    );
    await context.close();
  });
});
