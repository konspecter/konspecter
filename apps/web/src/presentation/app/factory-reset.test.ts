import { factoryReset, sendWipeReceipt, takeWipedNotice, wipe } from "./factory-reset";

function parts(steps: string[]) {
  return {
    sync: { forget: () => Promise.resolve(void steps.push("sync")) },
    forgetFolders: () => Promise.resolve(void steps.push("folder")),
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

    await factoryReset({ ...parts(steps), forgetFolders: undefined });

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

describe("wipe", () => {
  const receipt = { serverUrl: "https://sync.example.com", token: "ksp_ada" };

  function wipeParts(steps: string[], storage = new Map<string, string>()) {
    return {
      deleteFiles: () => Promise.resolve(void steps.push("files")),
      store: { erase: () => Promise.resolve(void steps.push("store")) },
      forgetFolders: () => Promise.resolve(void steps.push("folder")),
      sync: { forgetToken: () => Promise.resolve(void steps.push("token")) },
      storage: {
        clear: () => {
          steps.push("storage");
          storage.clear();
        },
        setItem: (key: string, value: string) => void storage.set(key, value),
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => void storage.delete(key),
      },
      receipt,
      report: (error: unknown) => void steps.push(`report ${String(error)}`),
    };
  }

  it("erases the files and the app's data, then keeps the receipt and says so once", async () => {
    const steps: string[] = [];
    const wiped = wipeParts(steps);

    await wipe(wiped);

    expect(steps).toEqual(["files", "store", "folder", "storage", "token"]);
    expect(takeWipedNotice(wiped.storage)).toBe(true);
    expect(takeWipedNotice(wiped.storage)).toBe(false);
    const confirm = vi.fn(() => Promise.resolve(true));
    expect(await sendWipeReceipt(wiped.storage, confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(receipt);
    expect(await sendWipeReceipt(wiped.storage, confirm)).toBe(false); // Sent: forgotten.
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("erases the rest when a file cannot be deleted", async () => {
    const steps: string[] = [];
    const failing = () => Promise.reject(new Error("locked"));

    await wipe({ ...wipeParts(steps), deleteFiles: failing });

    expect(steps).toEqual(["report Error: locked", "store", "folder", "storage", "token"]);
  });

  it("confirms nothing and keeps the token when the database cannot be erased", async () => {
    const steps: string[] = [];
    const wiped = wipeParts(steps);
    const blocked = { erase: () => Promise.reject(new Error("blocked")) };

    await expect(wipe({ ...wiped, store: blocked })).rejects.toThrow("blocked");

    expect(steps).toEqual(["files"]);
    expect(await sendWipeReceipt(wiped.storage, () => Promise.resolve(true))).toBe(false);
  });

  it("tries the receipt again a few times, then leaves it for the next start", async () => {
    const storage = wipeParts([]).storage;
    storage.setItem("konspecter.wipeReceipt", JSON.stringify(receipt));
    const waits: number[] = [];
    const wait = (ms: number) => Promise.resolve(void waits.push(ms));
    const answers = [false, false, true];

    expect(
      await sendWipeReceipt(storage, () => Promise.resolve(answers.shift() ?? false), wait),
    ).toBe(true);
    expect(waits).toEqual([5_000, 30_000]);

    storage.setItem("konspecter.wipeReceipt", JSON.stringify(receipt));
    expect(await sendWipeReceipt(storage, () => Promise.resolve(false), wait)).toBe(false);
    expect(storage.getItem("konspecter.wipeReceipt")).not.toBeNull();
  });

  it("says nothing and sends nothing on a start that follows no wipe", async () => {
    const storage = wipeParts([]).storage;
    expect(takeWipedNotice(storage)).toBe(false);
    expect(await sendWipeReceipt(storage, () => Promise.resolve(true))).toBe(false);
  });
});
