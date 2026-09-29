import { flushBeforeClosing, saveBeforeClosing } from "./closing";

describe("saving before the app closes", () => {
  it("writes every registered piece of work, and only while it is registered", async () => {
    const flush = vi.fn(() => Promise.resolve());
    const unregister = saveBeforeClosing(flush);
    const failing = saveBeforeClosing(() => Promise.reject(new Error("disk full")));

    await flushBeforeClosing(); // A failing write does not stop the others.
    expect(flush).toHaveBeenCalledOnce();

    unregister();
    failing();
    await flushBeforeClosing();
    expect(flush).toHaveBeenCalledOnce();
  });
});
