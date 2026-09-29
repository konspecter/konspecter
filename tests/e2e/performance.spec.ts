import { expect, test } from "@playwright/test";

/**
 * Real-browser performance with a large library. Numbers are printed and
 * recorded in docs/performance.md; the budgets only catch big regressions.
 */
const NOTES = 2000;

function note(i: number, kilobytes = 4): string {
  const words = "array list hash map tree set queue stack graph node edge index query cache".split(
    " ",
  );
  let body = `# Note ${String(i)}\n\n#topic${String(i % 20)} #lang${String(i % 7)}\n\n`;
  while (body.length < kilobytes * 1024) {
    body += `${words.map((w, k) => words[(i + k * 7) % words.length] ?? w).join(" ")}. `;
    if (body.length % 700 < 80)
      body += "\n\n```java\nvar cache = new HashMap<String, Integer>();\n```\n\n";
  }
  return body;
}

test("a library of 2,000 notes stays fast", async ({ page }) => {
  test.slow();
  const log = (label: string, ms: number) => {
    console.log(`PERF ${label}: ${ms.toFixed(0)} ms`);
  };

  await page.goto("/settings");
  let start = Date.now();
  await page.getByLabel("Import .md files…").setInputFiles([
    ...Array.from({ length: NOTES }, (_, i) => ({
      name: `note-${String(i)}.md`,
      mimeType: "text/markdown",
      buffer: Buffer.from(note(i)),
    })),
    { name: "huge.md", mimeType: "text/markdown", buffer: Buffer.from(note(99999, 200)) },
  ]);
  await expect(
    page.getByText(`Imported ${(NOTES + 1).toLocaleString("en")} conspects.`),
  ).toBeVisible({
    timeout: 120_000,
  });
  log(`import ${String(NOTES + 1)} files through the UI`, Date.now() - start);

  start = Date.now();
  await page.goto("/");
  await expect(page.locator(".note-results > li")).toHaveCount(NOTES + 1, { timeout: 30_000 });
  const startup = Date.now() - start;
  log(`cold start to a catalog of ${String(NOTES + 1)} notes`, startup);
  expect(startup).toBeLessThan(5000);

  start = Date.now();
  await page.getByRole("searchbox", { name: "Search conspects" }).fill("hash");
  await expect(page.locator(".note-results mark").first()).toBeVisible();
  const firstSearch = Date.now() - start;
  log("first search (index warmed while idle)", firstSearch);

  start = Date.now();
  // The tag becomes a chip in the search box once a space follows it.
  await page.getByRole("searchbox", { name: "Search conspects" }).fill("#topic3 queue");
  await expect(page.getByRole("list", { name: "Tag filters" })).toBeVisible();
  await expect(page.locator(".note-results mark").first()).toBeVisible();
  log("next search", Date.now() - start);
  expect(firstSearch).toBeLessThan(10_000);

  await page.goto("/");
  await page
    .getByRole("list", { name: "Conspects" })
    .getByRole("link", { name: "Note 1", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Conspect text" })).toBeVisible();
  start = Date.now();
  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("link", { name: "Note 2", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Conspect text" })).toContainText("Note 2");
  const open = Date.now() - start;
  log("switch to another note (editor ready)", open);
  expect(open).toBeLessThan(1000);

  start = Date.now();
  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("link", { name: "Note 99999" })
    .click();
  await expect(page.getByRole("textbox", { name: "Conspect text" })).toContainText("Note 99999");
  const render = Date.now() - start;
  log("open a 200 KB note in the editor", render);
  expect(render).toBeLessThan(5000);

  // Typing stays immediate in the large note; saving runs behind it.
  const editor = page.getByRole("textbox", { name: "Conspect text" });
  await editor.click();
  start = Date.now();
  await page.keyboard.type("typing in a large note");
  const typing = Date.now() - start;
  log("type 22 characters in the 200 KB note", typing);
  await expect(page.getByRole("img", { name: "Everything is stored on this device" })).toBeVisible({
    timeout: 10_000,
  });
});
