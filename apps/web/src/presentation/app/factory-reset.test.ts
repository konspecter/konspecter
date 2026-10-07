import { factoryReset } from "./factory-reset";

function parts(steps: string[]) {
  return {
    sync: { forget: () => Promise.resolve(void steps.push("sync")) },
    closeFolder: () => Promise.resolve(void steps.push("folder")),
    store: { erase: () => Promise.resolve(void steps.push("store")) },
    storage: { clear: () => void steps.push("storage") },
  };
}

describe("factoryReset", () => {
  it("signs out of sync first, while its connection can be read, and erases the database last", async () => {
    const steps: string[] = [];

    await factoryReset(parts(steps));

    expect(steps).toEqual(["sync", "folder", "store", "storage"]);
  });

  it("has no folder to forget outside File Mode", async () => {
    const steps: string[] = [];

    await factoryReset({ ...parts(steps), closeFolder: undefined });

    expect(steps).toEqual(["sync", "store", "storage"]);
  });

  it("carries on without storage", async () => {
    const steps: string[] = [];
    const storage = {
      clear() {
        throw new DOMException("denied", "SecurityError");
      },
    };

    await factoryReset({ ...parts(steps), storage });

    expect(steps).toEqual(["sync", "folder", "store"]);
  });

  it("stops before erasing anything when sync cannot be forgotten", async () => {
    const steps: string[] = [];
    const failing = { forget: () => Promise.reject(new Error("keychain locked")) };

    await expect(factoryReset({ ...parts(steps), sync: failing })).rejects.toThrow(
      "keychain locked",
    );

    expect(steps).toEqual([]);
  });
});
