import { expect, test, type Page } from "@playwright/test";

/** Waits until the new note has been stored: the URL changes from /notes/new to its id. */
async function saved(page: Page) {
  await expect(page).toHaveURL(/\/notes\/(?!new$)[^/]+$/, { timeout: 10_000 });
}

async function createNote(page: Page, lines: string[]) {
  await page.goto("/");
  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("link", { name: "New note" })
    .click();
  const editor = page.getByRole("textbox", { name: "Note text" });
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

const list = (page: Page) => page.getByRole("list", { name: "Notes" });

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

  await page.keyboard.press(`${await mod(page)}+p`);
  const search = page.getByRole("searchbox", { name: "Search notes" });
  await expect(search).toBeFocused();
  await expect(list(page).getByRole("link")).toHaveText(["Networking", "Hash maps"]);
  await search.fill("collis");
  await expect(list(page).getByRole("link")).toHaveText(["Hash maps"]);
  await expect(list(page).locator("mark")).toHaveText("collisions");

  await search.fill("#net");
  await expect(list(page).getByRole("link")).toHaveText(["Networking"]);

  const tags = page.getByRole("navigation", { name: "Tags" });
  await tags.getByRole("link", { name: "#java" }).click();
  await expect(list(page).getByRole("link")).toHaveText(["Hash maps"]);
  await expect(search).toHaveValue("#java");
});

test("notes persist in IndexedDB across reloads and render as Markdown", async ({ page }) => {
  await page.goto("/notes/new");
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
  await page.getByRole("banner").getByRole("button", { name: "Text" }).click();
  await expect(page.getByRole("table")).toContainText("sorted");
  await expect(page.locator("pre code.language-java .hljs-keyword").first()).toBeVisible();
  await page.goto("/");
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

  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText(
    "Written before going offline.",
  );
  await createNote(page, ["# Written offline", "Still works."]);
  await page.goto("/");
  await expect(list(page).getByRole("link")).toHaveText(["Written offline", "Offline ready"]);
});

test("HTML in a note cannot run script", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto("/notes/new");
  await page.getByRole("banner").getByRole("button", { name: "Markdown" }).click();
  await page.getByRole("textbox", { name: "Markdown" }).click();
  await page.keyboard.type(
    '# Hostile\n\n<img src="x" onerror="window.pwned=1;alert(1)">\n\n<script>window.pwned=2</script>\n\n[click](javascript:window.pwned=3)\n',
  );
  await saved(page);
  // Text mode shows a note with HTML rendered (and sanitized), not editable as rich text.
  await page.getByRole("banner").getByRole("button", { name: "Text" }).click();

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

test("a conflict keeps both versions (editing while the note changes)", async ({ page }) => {
  await createNote(page, ["# Shared", "original"]);
  const url = page.url();
  const editor = page.getByRole("textbox", { name: "Note text" });
  await page.keyboard.type(" my edit");
  await expect(
    page.getByRole("img", { name: "Everything is stored on this device" }),
  ).toBeVisible();

  // Another tab opens the note and changes it.
  const other = await page.context().newPage();
  await other.goto(url);
  const otherEditor = other.getByRole("textbox", { name: "Note text" });
  await expect(otherEditor).toContainText("my edit");
  await otherEditor.click();
  await other.keyboard.press("ControlOrMeta+End");
  await other.keyboard.type(" other tab's edit");
  await expect(
    other.getByRole("img", { name: "Everything is stored on this device" }),
  ).toBeVisible();

  // This tab still shows its version; editing it now keeps both.
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" again");

  await expect(page.getByText("This is a conflict copy")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText("my edit again");
  await page.getByRole("link", { name: "the original" }).click();
  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText("other tab's edit");
});

test("global shortcuts work from the editor", async ({ page }) => {
  await createNote(page, ["# Shortcuts", "body"]);

  const modifier = await mod(page);
  await page.keyboard.press(`${modifier}+Comma`);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.keyboard.press(`${modifier}+p`);
  await expect(page.getByRole("searchbox", { name: "Search notes" })).toBeFocused();
  await expect(list(page).getByRole("link")).toHaveText(["Shortcuts"]);
});
