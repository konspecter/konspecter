import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openNoteStore } from "../../infrastructure/storage/note-store";
import { FakeServer } from "../../infrastructure/sync/fake-server";
import { SyncEngine, type Scheduler } from "../../infrastructure/sync/sync-engine";
import { SyncSettings } from "./SyncSettings";

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

async function setup() {
  databases += 1;
  const store = await openNoteStore(`sync-settings-${String(databases)}`);
  const server = new FakeServer();
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
});

it("keeps the token form under Advanced", async () => {
  await setup();
  await userEvent.setup().click(screen.getByText("Advanced: connect with an access token"));
  expect(screen.getByLabelText("Access token")).toBeVisible();
  expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled(); // No server yet.
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
