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
