import {
  isNewer,
  LATEST_RELEASE_URL,
  latestRelease,
  parseRelease,
  type Release,
  watchReleases,
} from "./releases";

const page = "https://github.com/konspecter/konspecter/releases/tag/v0.9.0";

describe("parseRelease", () => {
  it("reads the version and the page", () => {
    expect(parseRelease({ tag_name: "v0.9.0", html_url: page, draft: false })).toEqual({
      version: "0.9.0",
      url: page,
    });
  });

  it("refuses anything else", () => {
    expect(() => parseRelease(null)).toThrow("invalid release");
    expect(() => parseRelease({ tag_name: "nightly", html_url: page })).toThrow("not a version");
    expect(() =>
      parseRelease({ tag_name: "v0.9.0", html_url: "https://example.com/v0.9.0" }),
    ).toThrow("not on GitHub");
  });
});

describe("isNewer", () => {
  it.each([
    ["0.9.0", "0.8.0", true],
    ["0.10.0", "0.9.0", true],
    ["1.0.0", "0.99.99", true],
    ["0.8.1", "0.8.0", true],
    ["0.8.0", "0.8.0", false],
    ["0.7.0", "0.8.0", false],
    ["0.9.0", "0.9.0-rc.1", true],
    ["0.9.0-rc.1", "0.9.0", false],
    ["0.9.0-rc.2", "0.9.0-rc.1", true],
    ["0.8.0", "0.9.0-rc.1", false],
    ["latest", "0.8.0", false],
  ])("%s after %s: %s", (candidate, current, expected) => {
    expect(isNewer(candidate, current)).toBe(expected);
  });
});

describe("latestRelease", () => {
  it("asks GitHub for the latest release", async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(Response.json({ tag_name: "v0.9.0", html_url: page })),
    );
    expect(await latestRelease(fetchFn)).toEqual({ version: "0.9.0", url: page });
    expect(fetchFn).toHaveBeenCalledWith(LATEST_RELEASE_URL, expect.anything());
  });

  it("fails on an error answer", async () => {
    const fetchFn = () => Promise.resolve(new Response("rate limited", { status: 403 }));
    await expect(latestRelease(fetchFn)).rejects.toThrow("403");
  });
});

describe("watchReleases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const release = (version: string): Release => ({ version, url: page });

  it("checks after the start, then every so often, telling each newer version once", async () => {
    const answers = ["0.8.0", "offline", "0.9.0", "0.9.0", "0.10.0"];
    const check = vi.fn(() => {
      const answer = answers.shift() ?? "0.10.0";
      return answer === "offline"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(release(answer));
    });
    const onNewer = vi.fn();
    watchReleases({ current: "0.8.0", onNewer, check, after: 100, every: 1000 });

    await vi.advanceTimersByTimeAsync(99);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(onNewer).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);
    expect(check).toHaveBeenCalledTimes(5);
    expect(onNewer.mock.calls).toEqual([[release("0.9.0")], [release("0.10.0")]]);
  });

  it("asks nothing while turned off, but checks at once when asked to", async () => {
    const answers = ["0.8.0", "offline", "0.9.0", "0.9.0"];
    const check = vi.fn(() => {
      const answer = answers.shift() ?? "0.9.0";
      return answer === "offline"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(release(answer));
    });
    const onNewer = vi.fn();
    const checkNow = watchReleases({
      current: "0.8.0",
      onNewer,
      enabled: () => false,
      check,
      after: 100,
      every: 1000,
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(check).not.toHaveBeenCalled();

    expect(await checkNow()).toBeNull();
    await expect(checkNow()).rejects.toThrow("offline");
    expect(await checkNow()).toEqual(release("0.9.0"));
    // Still newer, but already announced.
    expect(await checkNow()).toEqual(release("0.9.0"));
    expect(onNewer.mock.calls).toEqual([[release("0.9.0")]]);
  });
});
