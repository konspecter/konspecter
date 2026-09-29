import { persistenceStatus, requestPersistence } from "./persistence";

function stubStorage(storage: Partial<StorageManager> | undefined) {
  Object.defineProperty(navigator, "storage", { configurable: true, value: storage });
}

afterEach(() => {
  stubStorage(undefined);
});

describe("storage persistence", () => {
  it("reports and requests persistence", async () => {
    stubStorage({ persisted: () => Promise.resolve(false), persist: () => Promise.resolve(true) });

    expect(await persistenceStatus()).toBe("best-effort");
    expect(await requestPersistence()).toBe("persistent");
  });

  it("handles browsers without the API or with failures", async () => {
    stubStorage(undefined);
    expect(await persistenceStatus()).toBe("unsupported");
    expect(await requestPersistence()).toBe("unsupported");

    stubStorage({
      persisted: () => Promise.reject(new Error("denied")),
      persist: () => Promise.reject(new Error("denied")),
    });
    expect(await persistenceStatus()).toBe("unsupported");
    expect(await requestPersistence()).toBe("best-effort");
  });
});
