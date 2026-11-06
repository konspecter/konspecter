import { isNativeMobile, nativeBackButton } from "./mobile";

const plugin = vi.hoisted(() => {
  const state = {
    listener: null as (() => void) | null,
    minimizeApp: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  };
  return {
    state,
    App: {
      addListener: (event: string, listener: () => void) => {
        if (event === "backButton") state.listener = listener;
        return Promise.resolve({ remove: state.remove });
      },
      minimizeApp: state.minimizeApp,
    },
  };
});
vi.mock("@capacitor/app", () => ({ App: plugin.App }));

afterEach(() => {
  delete (window as { Capacitor?: unknown }).Capacitor;
  plugin.state.listener = null;
  vi.clearAllMocks();
});

it("detects the native mobile app", () => {
  expect(isNativeMobile()).toBe(false);
  (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => false };
  expect(isNativeMobile()).toBe(false);
  (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  expect(isNativeMobile()).toBe(true);
});

it("hands the back button to the app, and puts the app in the background when it did nothing", async () => {
  let handled = true;
  const handle = vi.fn(() => handled);
  const giveBack = nativeBackButton(handle);
  await vi.waitFor(() => {
    expect(plugin.state.listener).not.toBeNull();
  });

  plugin.state.listener?.();
  expect(handle).toHaveBeenCalledTimes(1);
  expect(plugin.state.minimizeApp).not.toHaveBeenCalled();

  handled = false;
  plugin.state.listener?.();
  expect(plugin.state.minimizeApp).toHaveBeenCalledTimes(1);

  giveBack();
  expect(plugin.state.remove).toHaveBeenCalledTimes(1);
});

it("gives the button back even when that comes before the plugin has loaded", async () => {
  const giveBack = nativeBackButton(() => true);
  giveBack();
  await vi.waitFor(() => {
    expect(plugin.state.remove).toHaveBeenCalledTimes(1);
  });
});
