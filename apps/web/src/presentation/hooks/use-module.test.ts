import { renderHook, waitFor } from "@testing-library/react";
import { moduleLoader, useModule } from "./use-module";

describe("useModule", () => {
  it("loads the module, then has it on the first render", async () => {
    const loader = moduleLoader(() => Promise.resolve({ name: "editor" }));

    const first = renderHook(() => useModule(loader));
    expect(first.result.current.status).toBe("loading");
    await waitFor(() => {
      expect(first.result.current).toEqual({ status: "loaded", module: { name: "editor" } });
    });

    const next = renderHook(() => useModule(loader));
    expect(next.result.current).toEqual({ status: "loaded", module: { name: "editor" } });
  });

  it("reports a failed load and tries again on the next use", async () => {
    const importer = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("editor");
    const loader = moduleLoader(importer);

    const failed = renderHook(() => useModule(loader));
    await waitFor(() => {
      expect(failed.result.current.status).toBe("error");
    });

    const retried = renderHook(() => useModule(loader));
    await waitFor(() => {
      expect(retried.result.current).toEqual({ status: "loaded", module: "editor" });
    });
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
