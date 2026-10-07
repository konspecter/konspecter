import { createKey, openKeyTransfer } from "@konspecter/crypto";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, useActionData, useLoaderData } from "react-router";
import { ConnectApp, parseConnectCode, type ConnectCode } from "./connect-app";
import type { Device } from "./devices";
import { forgetKey, rememberKey } from "./remembered-key";
import App from "./root";

const phone: Device = {
  id: "d2",
  name: "Konspecter for Android",
  platform: "android",
  clientVersion: "0.3.0",
  createdAt: "2026-10-06T10:00:00Z",
  lastUsedAt: null,
  lastSyncAt: null,
};

const url = "https://notes.example.com/connect#ksc_abcdefghijklmnopqrstuvwxyz012345";

/**
 * The settings page's part: the action hands out a code (and records what
 * was posted to it), the loader lists `devices.now`.
 */
function renderConnect(devices: { now: Device[] }, posted: FormData[] = []) {
  function Page() {
    const loaded = useLoaderData<{ devices: Device[] }>();
    const result = useActionData<{ connect: ConnectCode }>();
    return (
      <ConnectApp
        account="a@example.com"
        code={result?.connect ?? null}
        error={null}
        devices={loaded.devices}
      />
    );
  }
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      Component: App as never,
      loader: () => ({
        locale: "en",
        theme: "system",
        email: "a@example.com",
        name: "",
        accounts: true,
      }),
      children: [
        {
          path: "settings",
          Component: Page,
          loader: () => ({ devices: devices.now }),
          action: async ({ request }) => {
            posted.push(await request.formData());
            return { connect: { url, expiresIn: 300 } };
          },
        },
      ],
    },
  ]);
  render(<Stub initialEntries={["/settings"]} />);
}

afterEach(async () => {
  vi.useRealTimers();
  await forgetKey();
});

it("reads the API's code", () => {
  expect(parseConnectCode({ code: "ksc_x", url, expires_in: 300 })).toEqual({
    url,
    expiresIn: 300,
  });
  expect(parseConnectCode({ url })).toBeNull();
});

it("shows the code as a QR code and as a link to paste", async () => {
  renderConnect({ now: [] });
  await userEvent.click(await screen.findByRole("button", { name: "Show QR code" }));

  expect(
    await screen.findByRole("img", { name: "QR code that connects an app to this account" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("No camera? Paste this link into the app instead")).toHaveValue(url);
  expect(screen.getByText("The code works once, for 5 min.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show a new code" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Done" })).toHaveAttribute("href", "/settings");
});

it("says the app will ask for the passphrase while this browser does not remember the key", async () => {
  const posted: FormData[] = [];
  renderConnect({ now: [] }, posted);
  expect(await screen.findByRole("link", { name: "Connect apps without it" })).toHaveAttribute(
    "href",
    "#encryption",
  );
  await userEvent.click(screen.getByRole("button", { name: "Show QR code" }));
  await screen.findByRole("img", { name: /QR code/ });
  expect(posted[0]?.get("intent")).toBe("connect");
  expect(posted[0]?.has("sealed_key")).toBe(false);
});

it("hands the remembered key over: sealed to the server, its secret only in the link", async () => {
  const { record, raw } = await createKey("a long passphrase", 1_000);
  await rememberKey("a@example.com", record.keyId, raw);
  const posted: FormData[] = [];
  renderConnect({ now: [] }, posted);
  expect(await screen.findByText(/This browser remembers your encryption key/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Show QR code" }));
  await screen.findByRole("img", { name: /QR code/ });
  expect(screen.getByText(/it carries your encryption key too/)).toBeInTheDocument();

  const sent = posted[0];
  const link = screen.getByLabelText<HTMLInputElement>(
    "No camera? Paste this link into the app instead",
  ).value;
  const secret = link.slice(url.length + 1);
  expect(link.startsWith(`${url}.`)).toBe(true);
  expect(sent?.get("intent")).toBe("connect");
  expect(sent?.get("key_id")).toBe(record.keyId);
  expect([...(sent?.values() ?? [])]).not.toContain(secret);
  const sealedKey = sent?.get("sealed_key");
  if (typeof sealedKey !== "string") throw new Error("no sealed key");
  const opened = await openKeyTransfer(record.keyId, sealedKey, secret);
  expect(opened.type).toBe("secret");
});

it("says which app connected, checking the devices while the code shows", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const devices = { now: [] as Device[] };
  renderConnect(devices);
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  await user.click(await screen.findByRole("button", { name: "Show QR code" }));
  await screen.findByRole("img", { name: /QR code/ });

  devices.now = [phone];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_000);
  });

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Konspecter for Android is connected.",
  );
  expect(screen.queryByRole("img", { name: /QR code/ })).toBeNull();
});

it("puts the code away when it expires", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderConnect({ now: [] });
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  await user.click(await screen.findByRole("button", { name: "Show QR code" }));
  await screen.findByRole("img", { name: /QR code/ });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_000);
  });

  expect(screen.getByRole("status")).toHaveTextContent("The code has expired.");
  expect(screen.queryByRole("img", { name: /QR code/ })).toBeNull();
});
