import { appInfo, isDesktop, setInvokeForTests } from "./desktop";

afterEach(() => {
  setInvokeForTests(null);
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("desktop bridge", () => {
  it("detects the desktop shell", () => {
    expect(isDesktop()).toBe(false);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(isDesktop()).toBe(true);
  });

  it("calls native commands and validates their answers", async () => {
    const calls: string[] = [];
    setInvokeForTests((command) => {
      calls.push(command);
      return Promise.resolve({ name: "Konspecter", version: "0.1.0", os: "macos" });
    });

    expect(await appInfo()).toEqual({ name: "Konspecter", version: "0.1.0", os: "macos" });
    expect(calls).toEqual(["app_info"]);

    setInvokeForTests(() => Promise.resolve({ name: 1 }));
    await expect(appInfo()).rejects.toThrow("invalid app info");
  });
});
