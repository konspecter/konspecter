import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, useActionData, useLoaderData } from "react-router";
import { ConnectApp, parseConnectCode, type ConnectCode } from "./connect-app";
import type { Device } from "./devices";
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

/** The settings page's part: the action hands out a code, the loader lists `devices.now`. */
function renderConnect(devices: { now: Device[] }) {
  function Page() {
    const loaded = useLoaderData<{ devices: Device[] }>();
    const result = useActionData<{ connect: ConnectCode }>();
    return <ConnectApp code={result?.connect ?? null} error={null} devices={loaded.devices} />;
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
          action: () => ({ connect: { url, expiresIn: 300 } }),
        },
      ],
    },
  ]);
  render(<Stub initialEntries={["/settings"]} />);
}

afterEach(() => {
  vi.useRealTimers();
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
