import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, RouterContextProvider } from "react-router";
import { accountContext } from "../account.server";
import App from "../root";
import Activate, {
  action as activateAction,
  displayCode,
  loader as activateLoader,
} from "./activate";
import Settings, { action as settingsAction, loader as settingsLoader } from "./settings";

/** The API's replies, by method and path; each call is recorded. */
function stubApi(replies: Record<string, () => Response>) {
  const calls: { call: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const parsed = new URL(url);
      const call = `${init.method ?? "GET"} ${parsed.pathname}${parsed.search}`;
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ call, body });
      const reply = replies[call];
      return reply ? Promise.resolve(reply()) : Promise.reject(new Error(`unexpected ${call}`));
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function args(request: Request, signedIn = true) {
  const context = new RouterContextProvider();
  context.set(accountContext, {
    user: signedIn ? { id: "u1", email: "ann@example.com" } : null,
    enabled: true,
  });
  return { request, params: {}, context } as never;
}

function post(path: string, fields: Record<string, string>) {
  return new Request(`http://site.test${path}`, {
    method: "POST",
    headers: { Origin: "http://site.test", Cookie: "ksp_session=kss_1" },
    body: new URLSearchParams(fields),
  });
}

const device = {
  id: "d1",
  name: "Firefox on Linux",
  platform: "linux",
  client_version: "0.2.0",
  created_at: "2026-10-01T10:00:00Z",
  last_used_at: "2026-10-05T11:00:00Z",
  last_sync_at: "2026-10-05T11:55:00Z",
};

describe("settings", () => {
  it("sends a signed-out visitor to sign in and back", async () => {
    stubApi({});
    await expect(
      settingsLoader(args(new Request("http://site.test/settings"), false)),
    ).rejects.toSatisfy(
      (response: Response) => response.headers.get("Location") === "/login?next=%2Fsettings",
    );
  });

  it("loads the account and its devices", async () => {
    stubApi({
      "GET /api/account": () =>
        Response.json({ email: "ann@example.com", name: "Ann", recent_sign_in: true }),
      "GET /api/devices": () => Response.json({ devices: [device] }),
    });
    const loaded = await settingsLoader(args(new Request("http://site.test/settings")));
    expect(loaded.account).toEqual({ email: "ann@example.com", name: "Ann", recentSignIn: true });
    expect(loaded.devices.map((d) => d.name)).toEqual(["Firefox on Linux"]);
    expect(loaded.devicesFailed).toBe(false);
  });

  it("renames, disconnects and deletes through the API", async () => {
    const cleared = "ksp_session=; Path=/; Max-Age=0";
    const calls = stubApi({
      "PATCH /api/account": () => Response.json({ name: "Ann Lee" }),
      "DELETE /api/devices/d1": () => new Response(null, { status: 204 }),
      "DELETE /api/account": () =>
        new Response(null, { status: 204, headers: { "Set-Cookie": cleared } }),
    });
    expect(
      await settingsAction(args(post("/settings", { intent: "rename", name: "Ann Lee" }))),
    ).toEqual({
      intent: "rename",
      error: null,
    });
    expect(
      await settingsAction(
        args(post("/settings", { intent: "disconnect", id: "d1", name: "Firefox on Linux" })),
      ),
    ).toEqual({ intent: "disconnect", error: null, disconnected: "Firefox on Linux" });
    const response = (await settingsAction(
      args(post("/settings", { intent: "delete", email: " ann@example.com " })),
    )) as Response;
    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.getSetCookie()).toEqual([cleared]);
    expect(calls.map((c) => c.body)).toEqual([
      { name: "Ann Lee" },
      null,
      { email: "ann@example.com" },
    ]);
  });

  it("returns the API's refusal to delete to the form", async () => {
    stubApi({
      "DELETE /api/account": () =>
        Response.json(
          { error: { code: "reauthentication_required", message: "" } },
          { status: 403 },
        ),
    });
    const result = (await settingsAction(
      args(post("/settings", { intent: "delete", email: "ann@example.com" })),
    )) as { data: unknown; init: { status: number } };
    expect(result.data).toEqual({ intent: "delete", error: { code: "reauthentication_required" } });
    expect(result.init.status).toBe(403);
  });

  function renderSettings(account: { name: string; recentSignIn: boolean }, devices: unknown[]) {
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        Component: App as never,
        loader: () => ({ locale: "en", theme: "system", email: "ann@example.com", accounts: true }),
        children: [
          {
            path: "settings",
            Component: Settings as never,
            loader: () => ({
              account: { email: "ann@example.com", ...account },
              devices,
              devicesFailed: false,
              now: Date.parse("2026-10-05T12:00:00Z"),
            }),
            action: () => ({ intent: "disconnect", error: null, disconnected: "Firefox on Linux" }),
          },
        ],
      },
    ]);
    render(<Stub initialEntries={["/settings"]} />);
  }

  it("lists the devices with their last activity, and disconnects one", async () => {
    renderSettings({ name: "Ann", recentSignIn: true }, [
      {
        id: "d1",
        name: "Firefox on Linux",
        platform: "linux",
        clientVersion: "0.2.0",
        createdAt: "2026-10-01T10:00:00Z",
        lastUsedAt: "2026-10-05T11:00:00Z",
        lastSyncAt: "2026-10-05T11:55:00Z",
      },
    ]);
    const list = await screen.findByRole("list", { name: "Connected devices" });
    const row = within(list).getByRole("listitem");
    expect(row).toHaveTextContent("Firefox on Linux");
    expect(row).toHaveTextContent("Linux, version 0.2.0");
    expect(row).toHaveTextContent("Last synced 5 minutes ago");
    expect(screen.getByText(/Hello, Ann/)).toBeInTheDocument();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Disconnect Firefox on Linux" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Firefox on Linux is disconnected.",
    );
    expect(screen.getByRole("textbox", { name: "Type ann@example.com to confirm" })).toBeRequired();
  });

  it("asks to sign in again before deleting after an old sign-in", async () => {
    renderSettings({ name: "", recentSignIn: false }, []);
    expect(await screen.findByText(/No devices yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete account" })).toBeNull();
    const again = screen.getByRole("button", { name: "Sign in again" });
    expect(again.closest("form")).toHaveAttribute("action", "/logout");
  });
});

describe("activate", () => {
  it("writes codes as the app shows them", () => {
    expect(displayCode("bcdf ghjk")).toBe("BCDF-GHJK");
    expect(displayCode("BCDF-GHJK")).toBe("BCDF-GHJK");
    expect(displayCode("abc")).toBe("ABC");
  });

  it("sends a signed-out visitor to sign in with the code kept", async () => {
    stubApi({});
    await expect(
      activateLoader(args(new Request("http://site.test/activate?code=BCDF-GHJK"), false)),
    ).rejects.toSatisfy(
      (response: Response) =>
        response.headers.get("Location") === "/login?next=%2Factivate%3Fcode%3DBCDF-GHJK",
    );
  });

  it("finds the waiting app, or says the code is wrong", async () => {
    stubApi({
      "GET /api/devices/pending?user_code=BCDF-GHJK": () =>
        Response.json({ device: { name: "Firefox on Linux", platform: "linux" } }),
      "GET /api/devices/pending?user_code=XXXX-XXXX": () =>
        Response.json({ error: { code: "invalid_user_code", message: "" } }, { status: 404 }),
    });
    const found = await activateLoader(
      args(new Request("http://site.test/activate?code=bcdfghjk")),
    );
    expect(found).toMatchObject({ code: "BCDF-GHJK", device: { name: "Firefox on Linux" } });
    const wrong = await activateLoader(
      args(new Request("http://site.test/activate?code=XXXX-XXXX")),
    );
    expect(wrong).toMatchObject({ device: null, error: { code: "invalid_user_code" } });
    expect(await activateLoader(args(new Request("http://site.test/activate")))).toMatchObject({
      code: "",
      device: null,
    });
  });

  it("approves or denies the app", async () => {
    const calls = stubApi({
      "POST /api/devices/approve": () =>
        Response.json({ device: { name: "Phone", platform: "android" } }),
      "POST /api/devices/deny": () =>
        Response.json({ device: { name: "Phone", platform: "android" } }),
    });
    expect(
      await activateAction(args(post("/activate", { intent: "approve", code: "BCDF-GHJK" }))),
    ).toMatchObject({ decision: "approved", device: { name: "Phone" } });
    expect(
      await activateAction(args(post("/activate", { intent: "deny", code: "BCDF-GHJK" }))),
    ).toMatchObject({ decision: "denied" });
    expect(calls.map((c) => c.body)).toEqual([
      { user_code: "BCDF-GHJK" },
      { user_code: "BCDF-GHJK" },
    ]);
  });

  it("shows the code to compare, then the outcome", async () => {
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        Component: App as never,
        loader: () => ({ locale: "en", theme: "system", email: "ann@example.com", accounts: true }),
        children: [
          {
            path: "activate",
            Component: Activate as never,
            loader: () => ({
              email: "ann@example.com",
              code: "BCDF-GHJK",
              device: { name: "Firefox on Linux", platform: "linux", clientVersion: "0.2.0" },
              error: null,
            }),
            action: () => ({
              decision: "approved",
              device: { name: "Firefox on Linux", platform: "linux", clientVersion: "0.2.0" },
              error: null,
            }),
          },
        ],
      },
    ]);
    render(<Stub initialEntries={["/activate?code=BCDF-GHJK"]} />);
    expect(await screen.findByLabelText("Code BCDF-GHJK")).toHaveTextContent("BCDF-GHJK");
    expect(screen.getByText("Linux, version 0.2.0")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("heading", { name: "Device connected" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Firefox on Linux can now sync");
  });
});
