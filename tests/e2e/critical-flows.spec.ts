import { expect, test, type Page } from "@playwright/test";

/** Waits until the new note has been stored: the URL changes from /conspects/new to its id. */
async function saved(page: Page) {
  await expect(page).toHaveURL(/\/conspects\/(?!new$)[^/]+$/, { timeout: 10_000 });
}

async function createNote(page: Page, lines: string[]) {
  await page.goto("/");
  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("link", { name: "New conspect" })
    .click();
  const editor = page.getByRole("textbox", { name: "Conspect text" });
  await expect(editor).toBeFocused();
  for (const [index, line] of lines.entries()) {
    if (index > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
  await saved(page);
  // Everything typed is stored once the antenna rests.
  await expect(
    page.getByRole("img", { name: "Everything is stored on this device" }),
  ).toBeVisible();
}

const list = (page: Page) => page.getByRole("list", { name: "Conspects" });

/**
 * Opens the list through the app's own link. Loading "/" would not do: the app opens
 * where it was last (presentation/app/last-location.ts).
 */
async function openList(page: Page) {
  await page.getByRole("banner").getByRole("link", { name: "All conspects" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** The modifier the app uses for its shortcuts on this (possibly emulated) platform. */
async function mod(page: Page): Promise<"Meta" | "Control"> {
  const mac = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform);
  });
  return mac ? "Meta" : "Control";
}

test("Markdown → index → search, and Markdown → tags → navigation", async ({ page }) => {
  await createNote(page, ["# Hash maps", "Buckets and collisions #java#collections"]);
  await createNote(page, ["# Networking", "TCP handshakes #net"]);

  await openList(page);
  await page.keyboard.press(`${await mod(page)}+p`);
  const search = page.getByRole("searchbox", { name: "Search conspects" });
  await expect(search).toBeFocused();
  await expect(list(page).getByRole("link")).toHaveText(["Networking", "Hash maps"]);
  await search.fill("collis");
  await expect(list(page).getByRole("link")).toHaveText(["Hash maps"]);
  await expect(list(page).locator("mark")).toHaveText("collisions");

  await search.fill("#net");
  await expect(list(page).getByRole("link")).toHaveText(["Networking"]);

  const tags = page.getByRole("navigation", { name: "Tags" });
  await tags.getByRole("link", { name: "Java" }).click();
  await expect(list(page).getByRole("link")).toHaveText(["Hash maps"]);
  // The tag is a chip in the search box.
  await expect(search).toHaveValue("");
  await expect(page.getByRole("list", { name: "Tag filters" })).toHaveText(/^#java/);
});

test("notes persist in IndexedDB across reloads and render as Markdown", async ({ page }) => {
  await page.goto("/conspects/new");
  await page.getByRole("banner").getByRole("button", { name: "Markdown" }).click();
  await page.getByRole("textbox", { name: "Markdown" }).click();
  await page.keyboard.type(
    "# Persisted\n\n| Map | Order |\n| --- | --- |\n| TreeMap | sorted |\n\n```java\nvar map = new HashMap<>();\n```\n",
  );
  await saved(page);
  await expect(
    page.getByRole("img", { name: "Everything is stored on this device" }),
  ).toBeVisible();

  await page.reload();

  // The mode is remembered; the text view shows the note rendered (it has a table).
  await expect(page.getByRole("textbox", { name: "Markdown" })).toContainText("TreeMap");
  await page.getByRole("banner").getByRole("button", { name: "Markdown", pressed: true }).click();
  await expect(page.getByRole("table")).toContainText("sorted");
  await expect(page.locator("pre code.language-java .hljs-keyword").first()).toBeVisible();
  await openList(page);
  await expect(list(page)).toContainText("Persisted");
});

test("keeps working offline after the first visit", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await createNote(page, ["# Offline ready", "Written before going offline."]);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole("textbox", { name: "Conspect text" })).toContainText(
    "Written before going offline.",
  );
  await createNote(page, ["# Written offline", "Still works."]);
  await openList(page);
  await expect(list(page).getByRole("link")).toHaveText(["Written offline", "Offline ready"]);
});

test("HTML in a note cannot run script", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto("/conspects/new");
  await page.getByRole("banner").getByRole("button", { name: "Markdown" }).click();
  await page.getByRole("textbox", { name: "Markdown" }).click();
  await page.keyboard.type(
    '# Hostile\n\n<img src="x" onerror="window.pwned=1;alert(1)">\n\n<script>window.pwned=2</script>\n\n[click](javascript:window.pwned=3)\n',
  );
  await saved(page);
  // Text mode shows a note with HTML rendered (and sanitized), not editable as rich text.
  await page.getByRole("banner").getByRole("button", { name: "Markdown", pressed: true }).click();

  // The javascript: link lost its href, so it is not even a link any more.
  const rendered = page.locator(".note-editor .markdown");
  await expect(rendered.getByText("click")).toBeVisible();
  await expect(rendered.locator('a[href^="javascript" i]')).toHaveCount(0);
  await expect(rendered.locator("script")).toHaveCount(0);
  await expect(rendered.locator("img[onerror]")).toHaveCount(0);
  await rendered.getByText("click").click();

  // Defense in depth: the production build carries a Content-Security-Policy.
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
  expect(dialogs).toEqual([]);
});

test("the later edit wins (editing while the note changes in another tab)", async ({ page }) => {
  await createNote(page, ["# Shared", "original"]);
  const url = page.url();
  const editor = page.getByRole("textbox", { name: "Conspect text" });
  await page.keyboard.type(" my edit");
  await expect(
    page.getByRole("img", { name: "Everything is stored on this device" }),
  ).toBeVisible();

  // Another tab opens the note and changes it.
  const other = await page.context().newPage();
  await other.goto(url);
  const otherEditor = other.getByRole("textbox", { name: "Conspect text" });
  await expect(otherEditor).toContainText("my edit");
  await otherEditor.getByText("original my edit").click();
  await other.keyboard.press("End");
  await other.keyboard.type(" other tab's edit");
  await expect(
    other.getByRole("img", { name: "Everything is stored on this device" }),
  ).toBeVisible();

  // This tab still shows its version; editing it now is the later write, and it wins.
  await editor.getByText("original my edit").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" again");
  await expect(
    page.getByRole("img", { name: "Everything is stored on this device" }),
  ).toBeVisible();

  await other.reload();
  await expect(otherEditor).toContainText("original my edit again");
  await expect(otherEditor).not.toContainText("other tab's edit");
  await expect(page.getByText(/conflict copy/)).toHaveCount(0);
  await openList(page);
  await expect(list(page).getByRole("link", { name: /Shared/ })).toHaveCount(1);
});

test("global shortcuts work from the editor", async ({ page }) => {
  await createNote(page, ["# Shortcuts", "body"]);

  const modifier = await mod(page);
  await page.keyboard.press(`${modifier}+Comma`);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.keyboard.press(`${modifier}+p`);
  await expect(page.getByRole("searchbox", { name: "Search conspects" })).toBeFocused();
  await expect(list(page).getByRole("link")).toHaveText(["Shortcuts"]);
});

test("typing in Markdown mode through several saves keeps every character", async ({ page }) => {
  await createNote(page, ["# Typing", "start"]);
  await page.keyboard.press(`${await mod(page)}+/`);
  const source = page.getByRole("textbox", { name: "Markdown" });
  await expect(source).toBeFocused();
  await source.getByText("start").click();
  await page.keyboard.press("End");
  // Pauses long enough for saves to run, and write their dates, mid-typing.
  const words = ["alpha", "beta", "gamma", "delta", "epsilon"];
  for (const word of words) {
    await page.keyboard.type(` ${word}`, { delay: 30 });
    await page.waitForTimeout(450);
  }
  await expect(source).toContainText(`start ${words.join(" ")}`);
  // The frontmatter shows the dates the last save wrote.
  await expect(source).toContainText(/updated: \d{4}-\d{2}-\d{2}T/);
});

test("switching modes keeps the caret and the text on screen in a long note", async ({ page }) => {
  await page.goto("/conspects/new");
  await page.getByRole("banner").getByRole("button", { name: "Markdown" }).click();
  const source = page.getByRole("textbox", { name: "Markdown" });
  await source.click();
  const paragraphs = Array.from(
    { length: 80 },
    (_, index) => `Paragraph ${String(index)} has **some** words.`,
  );
  await page.keyboard.insertText(`# Long\n\n${paragraphs.join("\n\n")}\n`);
  await saved(page);

  const modifier = await mod(page);
  // Half way down, the paragraph in the middle of the window (CodeMirror draws only those in view).
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight / 2);
  });
  const middleLine = () =>
    page.evaluate(() => {
      const lines = [...document.querySelectorAll(".cm-line")].filter((element) => {
        const { top, bottom } = element.getBoundingClientRect();
        return top < window.innerHeight / 2 && bottom > window.innerHeight / 3;
      });
      const texts = lines.map((element) => /Paragraph \d+ has/.exec(element.textContent)?.[0]);
      return texts.find((text) => text !== undefined) ?? "";
    });
  await expect.poll(middleLine).not.toBe("");
  const middle = await middleLine();
  const line = (box: typeof source) => box.getByText(middle, { exact: false });
  await line(source).click();
  await page.keyboard.press("End");
  const before = await line(source).boundingBox();

  await page.keyboard.press(`${modifier}+/`);
  const text = page.getByRole("textbox", { name: "Conspect text" });
  await expect(text).toBeFocused();
  const after = await line(text).boundingBox();
  // The paragraph stays where it was on screen, and typing goes on at the caret.
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(12);
  await page.keyboard.type("!");
  await expect(text).toContainText(`${middle} some words.!`);

  await page.keyboard.press(`${modifier}+/`);
  await expect(source).toBeFocused();
  const back = await line(source).boundingBox();
  expect(Math.abs((back?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(12);
  await page.keyboard.type("?");
  await expect(source).toContainText(`${middle} **some** words.!?`);
});
