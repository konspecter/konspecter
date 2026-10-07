import { createKey, keyToJson } from "@konspecter/crypto";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

/**
 * Local edit → encrypted sync → server → another device, in real browsers
 * against a real server. Needs KONSPECTER_E2E_URL and KONSPECTER_E2E_TOKEN,
 * and the server must allow the origin http://localhost:4174
 * (KONSPECTER_ALLOWED_ORIGINS). Encryption is set up with
 * KONSPECTER_E2E_PASSPHRASE when the account has none; otherwise that must be
 * its passphrase.
 */
const serverUrl = process.env.KONSPECTER_E2E_URL;
const token = process.env.KONSPECTER_E2E_TOKEN;
const passphrase = process.env.KONSPECTER_E2E_PASSPHRASE ?? "konspecter e2e passphrase";
const auth = { Authorization: `Bearer ${token ?? ""}` };

test.skip(!serverUrl || !token, "KONSPECTER_E2E_URL and KONSPECTER_E2E_TOKEN are not set");

async function ensureKey(request: APIRequestContext): Promise<void> {
  const existing = await request.get(`${serverUrl ?? ""}/api/keys`, { headers: auth });
  if (existing.ok()) return;
  const { record } = await createKey(passphrase);
  const created = await request.put(`${serverUrl ?? ""}/api/keys`, {
    headers: auth,
    data: keyToJson(record),
  });
  expect(created.ok()).toBe(true);
}

async function device(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/settings");
  await page.getByLabel("Server URL").fill(serverUrl ?? "");
  await page.getByText("Advanced: connect with an access token").click();
  await page.getByLabel("Access token").fill(token ?? "");
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByLabel("Encryption passphrase").fill(passphrase);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText(/Up to date/)).toBeVisible();
  return page;
}

test("a note written on one device reaches the server and another device", async ({
  browser,
  request,
}) => {
  const title = `Synced ${String(Date.now())}`;
  await ensureKey(request);
  const a = await device(browser);
  await a
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("link", { name: "New conspect" })
    .click();
  await a.getByRole("textbox", { name: "Conspect text" }).click();
  await a.keyboard.type(`# ${title}`);
  await a.keyboard.press("Enter");
  await a.keyboard.type("travels through the server");
  await expect(a).toHaveURL(/\/conspects\/(?!new$)[^/]+$/, { timeout: 10_000 });

  // The server holds the note, but only as ciphertext: no trace of the title.
  await expect(async () => {
    const response = await request.get(`${serverUrl ?? ""}/api/notes`, { headers: auth });
    const { notes } = (await response.json()) as { notes: { content: string }[] };
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((note) => note.content.startsWith("ksp1."))).toBe(true);
    expect(notes.some((note) => note.content.includes(title))).toBe(false);
  }).toPass({ timeout: 15_000 });

  // The other device decrypts it: the title shows among its recent conspects.
  const b = await device(browser);
  await expect(
    b.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: title }),
  ).toBeVisible();
});
