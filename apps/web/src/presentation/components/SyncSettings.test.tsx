import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openNoteStore } from "../../infrastructure/storage/note-store";
import { FakeServer, TEST_PASSPHRASE } from "../../infrastructure/sync/fake-server";
import { SyncEngine, type Scheduler } from "../../infrastructure/sync/sync-engine";
import { SyncSettings } from "./SyncSettings";

// The camera: what it "sees" (a QR code's text) or why it does not start.
const camera = vi.hoisted(() => ({ text: null as string | null, error: null as Error | null }));
vi.mock("../../infrastructure/camera/qr-scanner", () => ({
  cameraAvailable: () => true,
  cameraDenied: (error: unknown) =>
    error instanceof DOMException && error.name === "NotAllowedError",
  scanQrCodes: (_video: unknown, onCode: (text: string) => boolean) => {
    if (camera.error) return Promise.reject(camera.error);
    if (camera.text !== null) onCode(camera.text);
    return Promise.resolve();
  },
}));

afterEach(() => {
  camera.text = null;
  camera.error = null;
});

const code = "ksc_abcdefghijklmnopqrstuvwxyz012345";
const link = `https://sync.example.com/connect#${code}`;

let databases = 0;

/** Runs scheduled callbacks only when the test says so. */
class ManualScheduler implements Scheduler {
  pending: (() => void)[] = [];
  set = (callback: () => void) => {
    this.pending.push(callback);
    return callback;
  };
  clear = (handle: unknown) => {
    this.pending = this.pending.filter((callback) => callback !== handle);
  };
  runAll() {
    const due = this.pending;
    this.pending = [];
    for (const callback of due) callback();
  }
}

async function setup(server = new FakeServer()) {
  databases += 1;
  const store = await openNoteStore(`sync-settings-${String(databases)}`);
  const scheduler = new ManualScheduler();
  const engine = new SyncEngine(store, {
    fetch: server.fetch,
    scheduler,
    isOnline: () => true,
    isVisible: () => true,
  });
  const opened: string[] = [];
  vi.spyOn(window, "open").mockImplementation((url) => {
    opened.push(String(url));
    return null;
  });
  render(<SyncSettings sync={engine} />);
  return { server, engine, scheduler, opened };
}

it("signs in with the browser: shows the code, opens the page, connects once approved", async () => {
  const { server, scheduler, opened } = await setup();
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Server URL" }), "https://sync.example.com");
  await user.click(screen.getByRole("button", { name: "Sign in with browser" }));

  const code = (await screen.findByText(/^BCDF-/)).textContent;
  expect(opened).toEqual([`https://sync.example.com/activate?code=${code}`]);
  expect(screen.getByText("Waiting for approval…")).toBeInTheDocument();
  const request = [...server.authorizations.values()][0];
  expect(request?.device).toMatchObject({ platform: "web", name: expect.any(String) as string });

  server.decide(code, true);
  scheduler.runAll();
  expect(await screen.findByText(/Connected to/)).toHaveTextContent(
    "Connected to https://sync.example.com as ada@example.com.",
  );
  // Then the passphrase unlocks the key.
  await user.type(await screen.findByLabelText("Encryption passphrase"), "wrong horse battery");
  await user.click(screen.getByRole("button", { name: "Unlock" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("That passphrase does not open");
  await user.clear(screen.getByLabelText("Encryption passphrase"));
  await user.type(screen.getByLabelText("Encryption passphrase"), TEST_PASSPHRASE);
  await user.click(screen.getByRole("button", { name: "Unlock" }));
  expect(await screen.findByText(/Up to date/)).toBeInTheDocument();
});

it("suggests the server the web app's host names, unless the owner typed one", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(Response.json({ serverUrl: "https://notes.example.com" })),
  );
  await setup();
  const field = screen.getByRole("textbox", { name: "Server URL" });
  await waitFor(() => {
    expect(field).toHaveValue("https://notes.example.com");
  });
  expect(globalThis.fetch).toHaveBeenCalledWith("/config.json");
});

it("leaves a server URL the owner typed before the suggestion came", async () => {
  let answer: (response: Response) => void = () => undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () => new Promise<Response>((resolve) => (answer = resolve)),
  );
  await setup();
  const field = screen.getByRole("textbox", { name: "Server URL" });
  await userEvent.setup().type(field, "https://mine.example.com");
  answer(Response.json({ serverUrl: "https://notes.example.com" }));
  // Let the suggestion arrive.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(field).toHaveValue("https://mine.example.com");
});

it("sends the owner to the site when encryption is not set up", async () => {
  const { engine, opened } = await setup(new FakeServer({ encrypted: false }));
  await engine.connect({ serverUrl: "https://sync.example.com", token: "ksp_ada" });
  expect(await screen.findByRole("status")).toHaveTextContent("no encryption set up yet");
  await userEvent.setup().click(screen.getByRole("button", { name: "Open encryption settings" }));
  expect(opened).toEqual(["https://sync.example.com/settings#encryption"]);
});

it("keeps the token form under Advanced", async () => {
  await setup();
  const advanced = screen.getByText("Advanced: connect with an access token");
  await userEvent.setup().click(advanced);
  expect(screen.getByLabelText("Access token")).toBeVisible();
  const form = advanced.closest("details");
  expect(within(form as HTMLElement).getByRole("button", { name: "Connect" })).toBeDisabled(); // No server yet.
});

it("scans the site's QR code and connects to its server", async () => {
  const { server } = await setup();
  server.connectCodes.set(code, "ksp_ada");
  camera.text = link;
  await userEvent.setup().click(screen.getByRole("button", { name: "Scan QR code" }));

  expect(await screen.findByText(/Connected to/)).toHaveTextContent(
    "Connected to https://sync.example.com as ada@example.com.",
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(server.connected[0]).toMatchObject({ code, platform: "web" });
});

it("says when the camera may not be used", async () => {
  await setup();
  camera.error = new DOMException("Permission denied", "NotAllowedError");
  await userEvent.setup().click(screen.getByRole("button", { name: "Scan QR code" }));
  const dialog = screen.getByRole("dialog", { name: "Scan the QR code" });
  expect(await within(dialog).findByText(/may not use the camera/)).toBeInTheDocument();
});

it("says when a scanned code is used up, and scans again", async () => {
  const { server } = await setup();
  camera.text = link;
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Scan QR code" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This code is wrong, used or expired. Show a new one on the site.",
  );

  server.connectCodes.set(code, "ksp_ada");
  await user.click(screen.getByRole("button", { name: "Scan again" }));
  expect(await screen.findByText(/Connected to/)).toHaveTextContent(
    "Connected to https://sync.example.com as ada@example.com.",
  );
});

it("connects with a link pasted from the site", async () => {
  const { server } = await setup();
  server.connectCodes.set(code, "ksp_ada");
  const user = userEvent.setup();
  const summary = screen.getByText("Connect with a link from the site");
  await user.click(summary);
  const form = within(summary.closest("details") as HTMLElement);

  await user.type(form.getByLabelText("Connect link"), "https://sync.example.com/activate");
  await user.click(form.getByRole("button", { name: "Connect with the link" }));
  expect(form.getByRole("alert")).toHaveTextContent("This is not a connect link.");

  await user.clear(form.getByLabelText("Connect link"));
  await user.type(form.getByLabelText("Connect link"), link);
  await user.click(form.getByRole("button", { name: "Connect with the link" }));
  expect(await screen.findByText(/Connected to/)).toHaveTextContent(
    "Connected to https://sync.example.com as ada@example.com.",
  );
});

it("explains a disconnected device and offers to sign in again or stop", async () => {
  const { server, engine } = await setup();
  await engine.connect({ serverUrl: "https://sync.example.com", token: "ksp_ada" });
  server.disconnectDevice("ksp_ada");
  await engine.syncNow();

  expect(await screen.findByRole("status")).toHaveTextContent(
    "This device was disconnected from ada@example.com on https://sync.example.com.",
  );
  expect(screen.getByText("Every conspect is still on this device.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign in again" })).toBeEnabled();
  await userEvent.setup().click(screen.getByRole("button", { name: "Stop syncing" }));
  expect(await screen.findByRole("button", { name: "Sign in with browser" })).toBeInTheDocument();
});

it("says when the trial ends, and links to the subscription", async () => {
  const server = new FakeServer();
  server.access = { state: "trialing", until: "2026-10-20T12:00:00Z" };
  const { engine, opened } = await setup(server);
  await engine.connect({ serverUrl: "https://sync.example.com", token: "ksp_ada" });
  await engine.unlock(TEST_PASSPHRASE);
  expect(await screen.findByText(/Free trial until/)).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Manage subscription" }));
  expect(opened).toEqual(["https://sync.example.com/settings#subscription"]);
});

it("pauses when the subscription ends, keeps everything and checks again on request", async () => {
  const { server, engine, opened } = await setup();
  await engine.connect({ serverUrl: "https://sync.example.com", token: "ksp_ada" });
  await engine.unlock(TEST_PASSPHRASE);
  server.access = { state: "expired", until: "2026-10-01T12:00:00Z" };
  await engine.syncNow();

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Sync is paused: the subscription has ended.",
  );
  expect(
    screen.getByText(/Every conspect is safe, on this device and on the server/),
  ).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Subscribe" }));
  expect(opened).toEqual(["https://sync.example.com/settings#subscription"]);

  server.access = { state: "active", until: "2026-11-01T12:00:00Z" };
  await user.click(screen.getByRole("button", { name: "Check again" }));
  expect(await screen.findByText(/Up to date/)).toBeInTheDocument();
  expect(screen.getByText(/renews automatically/)).toBeInTheDocument();
});

it("says until when a canceled subscription keeps sync working", async () => {
  const server = new FakeServer();
  server.access = { state: "canceled", until: "2026-11-09T12:00:00Z" };
  const { engine } = await setup(server);
  await engine.connect({ serverUrl: "https://sync.example.com", token: "ksp_ada" });
  await engine.unlock(TEST_PASSPHRASE);
  expect(
    await screen.findByText(/The subscription does not renew. Sync works until/),
  ).toBeInTheDocument();
});

it("asks for a subscription where the account never had one", async () => {
  const { server, engine } = await setup();
  await engine.connect({ serverUrl: "https://sync.example.com", token: "ksp_ada" });
  await engine.unlock(TEST_PASSPHRASE);
  server.access = { state: "expired", until: null };
  await engine.syncNow();
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Sync on this server needs a subscription.",
  );
});
