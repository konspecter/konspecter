import { readFileSync } from "node:fs";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/** The site session to carry into the app's contexts (cookies; no app storage). */
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

/**
 * The whole account flow in real browsers against a live stack: register on the site by
 * email code, set up encryption, connect the app through the browser and unlock it, check
 * the server holds only ciphertext, pull the note on a second device, disconnect a device
 * on the site (it keeps its notes), and delete the account.
 *
 * Needs, besides the web app this config serves on :4174:
 * - KONSPECTER_E2E_SITE_URL: the account site, whose origin also serves the API (the site's
 *   dev server proxies /api, as Caddy does in production), e.g. http://localhost:5174;
 * - KONSPECTER_E2E_MAIL_LOG: the server's log file, the server running with
 *   KONSPECTER_MAIL_TRANSPORT=log (sign-in codes are read from it);
 * - the server with KONSPECTER_PUBLIC_URL set to the site URL and http://localhost:4174 in
 *   KONSPECTER_ALLOWED_ORIGINS.
 * See docs/testing.md.
 */
const site = process.env.KONSPECTER_E2E_SITE_URL;
const mailLog = process.env.KONSPECTER_E2E_MAIL_LOG;

test.skip(!site || !mailLog, "KONSPECTER_E2E_SITE_URL and KONSPECTER_E2E_MAIL_LOG are not set");
test.setTimeout(120_000);

const email = `e2e-${Date.now().toString(36)}@example.com`;
const password = "a long enough password";
const passphrase = "a passphrase for the e2e run";
// Fixed user agents name the two devices on the site ("Chrome on Windows", "Firefox on Linux").
const laptopAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const phoneAgent = "Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0";

/** The newest sign-in code emailed to the address (read from the server's log). */
async function codeFor(address: string): Promise<string> {
  let code: string | undefined;
  await expect(() => {
    const lines = readFileSync(mailLog ?? "", "utf8").split("\n");
    const line = lines.findLast((l) => l.includes(`to=${address}`));
    code = /text=.*?\b(\d{6})\b/.exec(line ?? "")?.[1];
    expect(code).toBeDefined();
  }).toPass({ timeout: 10_000 });
  return code ?? "";
}

/** The app on a "device": signs in through the browser, approves on the site, unlocks. */
async function connectApp(browser: Browser, userAgent: string, storageState: StorageState) {
  const context = await browser.newContext({ userAgent, storageState });
  const app = await context.newPage();
  await app.goto("/settings");
  await app.getByLabel("Server URL").fill(site ?? "");
  const approval = context.waitForEvent("page");
  await app.getByRole("button", { name: "Sign in with browser" }).click();
  const code = (await app.getByText(/^[B-Z]{4}-[B-Z]{4}$/).textContent()) ?? "";

  // The site's /activate page opened with the code; the signed-in person compares and approves.
  const page = await approval;
  await expect(page.getByLabel(`Code ${code}`)).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: "Device connected" })).toBeVisible();
  await page.close();

  await app.getByLabel("Encryption passphrase").fill(passphrase, { timeout: 20_000 });
  await app.getByRole("button", { name: "Unlock" }).click();
  await expect(app.getByText(/Up to date/)).toBeVisible({ timeout: 15_000 });
  return { context, app };
}

/** A token of a device of the test's own, to look at the server's copy (GET /api/notes). */
async function inspectorToken(request: APIRequestContext, page: Page): Promise<string> {
  const authorized = await request.post(`${site ?? ""}/api/devices/authorize`, {
    data: { name: "Playwright inspector", platform: "other", client_version: "e2e" },
  });
  const { device_code: deviceCode, verification_uri_complete: link } =
    (await authorized.json()) as { device_code: string; verification_uri_complete: string };
  await page.goto(link);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: "Device connected" })).toBeVisible();
  const polled = await request.post(`${site ?? ""}/api/devices/token`, {
    data: { device_code: deviceCode },
  });
  return ((await polled.json()) as { token: string }).token;
}

test("register, encrypt, connect two devices, disconnect one, delete the account", async ({
  browser,
  request,
}) => {
  // 1. Register on the site with a password, confirmed by an email code.
  const person = await browser.newContext();
  const page = await person.newPage();
  await page.goto(`${site ?? ""}/register`);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Code").fill(await codeFor(email));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("link", { name: email })).toBeVisible();

  // 2. Set up encryption: a passphrase, then the recovery key typed back.
  await page.goto(`${site ?? ""}/settings#encryption`);
  await page.getByLabel("New passphrase").fill(passphrase);
  await page.getByLabel("Repeat the passphrase").fill(passphrase);
  await page.getByRole("button", { name: "Set up encryption" }).click();
  const recoveryKey = (await page.getByLabel("Recovery key", { exact: true }).textContent()) ?? "";
  await page.getByLabel("Type the recovery key to confirm you saved it").fill(recoveryKey);
  await page.getByRole("button", { name: "Finish setting up" }).click();
  await expect(page.getByText(/Encryption is set up/)).toBeVisible();
  const session = await person.storageState();

  // 3. Connect the app on a laptop and write a conspect.
  const laptop = await connectApp(browser, laptopAgent, session);
  const title = `Encrypted ${Date.now().toString(36)}`;
  await laptop.app
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("link", { name: "New conspect" })
    .click();
  await laptop.app.getByRole("textbox", { name: "Conspect text" }).click();
  await laptop.app.keyboard.type(`# ${title}`);
  await laptop.app.keyboard.press("Enter");
  await laptop.app.keyboard.type("only ciphertext leaves this device");

  // 4. The server holds it, but only as ciphertext of the account's key.
  const token = await inspectorToken(request, page);
  const auth = { Authorization: `Bearer ${token}` };
  await expect(async () => {
    const response = await request.get(`${site ?? ""}/api/notes`, { headers: auth });
    const { notes } = (await response.json()) as { notes: { content: string }[] };
    expect(notes).toHaveLength(1);
    expect(notes[0]?.content).toMatch(/^ksp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(notes[0]?.content).not.toContain(title);
  }).toPass({ timeout: 15_000 });

  // 5. A second device pulls and decrypts it.
  const phone = await connectApp(browser, phoneAgent, session);
  await expect(
    phone.app.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: title }),
  ).toBeVisible({ timeout: 15_000 });

  // 6. Disconnect the laptop on the site: it says so and keeps the conspect.
  await page.goto(`${site ?? ""}/settings`);
  const devices = page.getByRole("list", { name: "Connected devices" });
  await expect(devices.getByRole("listitem")).toHaveCount(3);
  await page.getByRole("button", { name: "Disconnect Chrome on Windows" }).click();
  await expect(page.getByRole("status")).toContainText("Chrome on Windows is disconnected");
  const stopped = laptop.app.getByRole("link", { name: "Sync: Sync stopped" });
  await expect(stopped).toBeVisible({ timeout: 30_000 });
  await stopped.click();
  await expect(laptop.app.getByText(/This device was disconnected from/)).toBeVisible();
  await expect(
    laptop.app.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: title }),
  ).toBeVisible();

  // 7. Delete the account: the server's copies and devices go with it.
  await page.getByLabel(`Type ${email} to confirm`).fill(email);
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(`${site ?? ""}/`);
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  const gone = await request.get(`${site ?? ""}/api/notes`, { headers: auth });
  expect(gone.status()).toBe(401);
  // The phone keeps its copy too; its next sync finds the account gone.
  await expect(
    phone.app.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: title }),
  ).toBeVisible();

  await Promise.all([person.close(), laptop.context.close(), phone.context.close()]);
});
