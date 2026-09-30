import { InvalidDocumentError } from "../../domain/document/document";
import { FolderError, setInvokeForTests } from "../../infrastructure/desktop/desktop";
import { ApiError, NetworkError } from "../../infrastructure/http/api-client";
import { errorMessage, reportError } from "./errors";

const tauri = window as unknown as Record<string, unknown>;

afterEach(() => {
  setInvokeForTests(null);
  delete tauri.__TAURI_INTERNALS__;
});

describe("the message shown for an error", () => {
  it("is the app's own message, as a sentence", () => {
    expect(errorMessage(new InvalidDocumentError("Frontmatter line 2 is not valid YAML"))).toBe(
      "Frontmatter line 2 is not valid YAML.",
    );
    expect(errorMessage(new ApiError(400, "too_large", "request body is too large"))).toBe(
      "request body is too large.",
    );
    expect(errorMessage(new FolderError("not_found", "a.md does not exist."))).toBe(
      "a.md does not exist.",
    );
  });

  it("hides what a library, the browser or the operating system says", () => {
    const oops = "Oops, something went wrong.";
    expect(errorMessage(new DOMException("Quota exceeded", "QuotaExceededError"))).toBe(oops);
    expect(errorMessage(new TypeError("Failed to fetch"))).toBe(oops);
    expect(errorMessage(new Error("anything"))).toBe(oops);
    expect(errorMessage("a string")).toBe(oops);
    expect(
      errorMessage(new FolderError("io", "writing a.md: Permission denied (os error 13)")),
    ).toBe(oops);
    expect(errorMessage(new FolderError("credentials", "credential store: locked"))).toBe(oops);
  });
});

describe("reporting an error", () => {
  it("logs a hidden error once", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("Disk on fire");

    reportError(error);
    reportError(error);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(error);
  });

  it("does not log the app's own errors, unless they hide a cause", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    reportError(new ApiError(401, "unauthorized", "a valid bearer token is required"));
    expect(log).not.toHaveBeenCalled();

    const offline = new NetworkError("Could not reach the server", {
      cause: new TypeError("Failed to fetch"),
    });
    reportError(offline);
    expect(log).toHaveBeenCalledWith(offline);
  });

  it("writes to the desktop app's log file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    tauri.__TAURI_INTERNALS__ = {};
    const invoke = vi.fn(() => Promise.resolve(null));
    setInvokeForTests(invoke);

    reportError(
      new NetworkError("Could not reach the server", { cause: new TypeError("Load failed") }),
    );

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledOnce();
    });
    const [command, args] = invoke.mock.calls[0] as unknown as [string, { entry: string }];
    expect(command).toBe("log_error");
    expect(args.entry).toMatch(
      /^\d{4}-\d\d-\d\dT[\d:.]+Z NetworkError: Could not reach the server\n/,
    );
    expect(args.entry).toContain("Caused by: TypeError: Load failed");
  });
});
