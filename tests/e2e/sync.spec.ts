import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Local edit → sync → server → another device, in real browsers against a real
 * server. Needs KONSPECTER_E2E_URL and KONSPECTER_E2E_TOKEN, and the server must
 * allow the origin http://localhost:4174 (KONSPECTER_ALLOWED_ORIGINS).
 */
const serverUrl = process.env.KONSPECTER_E2E_URL;
const token = process.env.KONSPECTER_E2E_TOKEN;

test.skip(!serverUrl || !token, "KONSPECTER_E2E_URL and KONSPECTER_E2E_TOKEN are not set");

async function device(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/settings");
  await page.getByLabel("Server URL").fill(serverUrl ?? "");
  await page.getByLabel("Access token").fill(token ?? "");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText(/Up to date/)).toBeVisible();
  return page;
}

test("a note written on one device reaches the server and another device", async ({
  browser,
  request,
}) => {
  const title = `Synced ${String(Date.now())}`;
  const a = await device(browser);
  await a
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("link", { name: "New conspect" })
    .click();
  await a.getByRole("textbox", { name: "Conspect text" }).click();
  await a.keyboard.type(`# ${title}`);
  await a.keyboard.press("Enter");
  await a.keyboard.type("travels through the server");
  await expect(a).toHaveURL(/\/notes\/(?!new$)[^/]+$/, { timeout: 10_000 });

  await expect(async () => {
    const response = await request.get(`${serverUrl ?? ""}/api/notes`, {
      headers: { Authorization: `Bearer ${token ?? ""}` },
    });
    const { notes } = (await response.json()) as { notes: { markdown: string }[] };
    expect(notes.some((note) => note.markdown.includes(title))).toBe(true);
  }).toPass({ timeout: 15_000 });

  const b = await device(browser);
  await b.goto("/");
  await expect(
    b.getByRole("list", { name: "Conspects" }).getByRole("link", { name: title }),
  ).toBeVisible();
});
