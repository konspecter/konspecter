import { describeDevice, deviceLogin, DeviceLoginError, suggestedServerUrl } from "./device-login";

const device = { name: "Firefox on Linux", platform: "web", clientVersion: "0.1.0" };

/** A server that answers the token polls in turn. */
function server(polls: (() => Response)[]) {
  const sent: string[] = [];
  const fetch = (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    sent.push(path);
    if (path === "/api/devices/authorize") {
      return Promise.resolve(
        Response.json({
          device_code: "ksd_1",
          user_code: "BCDF-GHJK",
          verification_uri: "https://sync.example.com/activate",
          verification_uri_complete: "https://sync.example.com/activate?code=BCDF-GHJK",
          expires_in: 600,
          interval: 5,
        }),
      );
    }
    expect(JSON.parse(init?.body as string)).toEqual({ device_code: "ksd_1" });
    const next = polls.shift();
    return next ? Promise.resolve(next()) : Promise.reject(new TypeError("Failed to fetch"));
  };
  return { fetch, sent };
}

const refusal = (code: string) => Response.json({ error: { code, message: "" } }, { status: 400 });

it("waits the interval, slows down when told, and rides out a lost connection", async () => {
  const { fetch } = server([
    () => refusal("authorization_pending"),
    () => refusal("slow_down"),
    () => {
      throw new TypeError("Failed to fetch");
    },
    () => Response.json({ token: "ksp_new" }),
  ]);
  const waits: number[] = [];
  const shown: string[] = [];
  const token = await deviceLogin("https://sync.example.com", device, {
    fetch,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    onCode: (authorization) => shown.push(authorization.userCode),
  });
  expect(token).toBe("ksp_new");
  expect(shown).toEqual(["BCDF-GHJK"]);
  expect(waits).toEqual([5000, 5000, 10_000, 10_000]);
});

it("ends when the owner denies the device or the code expires", async () => {
  for (const [code, reason] of [
    ["access_denied", "denied"],
    ["expired_token", "expired"],
  ] as const) {
    const { fetch } = server([() => refusal(code)]);
    const login = deviceLogin("https://sync.example.com/", device, {
      fetch,
      sleep: () => Promise.resolve(),
      onCode: () => undefined,
    });
    await expect(login).rejects.toEqual(new DeviceLoginError(reason));
  }
});

it("names the device so its owner recognises it on the site", () => {
  const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
  const chromeMac =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
  const edge =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0";
  expect(describeDevice({ userAgent: firefox })).toEqual({
    name: "Firefox on Linux",
    platform: "web",
    clientVersion: __KONSPECTER_VERSION__,
  });
  expect(describeDevice({ userAgent: chromeMac }).name).toBe("Chrome on macOS");
  expect(describeDevice({ userAgent: edge }).name).toBe("Edge on Windows");
  expect(describeDevice({ userAgent: "curl/8" }).name).toBe("Browser");
  expect(describeDevice({ desktopOs: "macos", userAgent: chromeMac })).toMatchObject({
    name: "Konspecter for macOS",
    platform: "macos",
  });
  expect(describeDevice({ mobile: true, userAgent: firefox })).toMatchObject({
    name: "Konspecter for Android",
    platform: "android",
  });
});

describe("the suggested server", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** A host that answers `/config.json` with this. */
  const host = (answer: () => Response) => {
    const asked: string[] = [];
    const fetch = (input: string) => {
      asked.push(input);
      return Promise.resolve(answer());
    };
    return { fetch, asked };
  };

  it("is the one the web app's host names, as an origin", async () => {
    const { fetch, asked } = host(() =>
      Response.json({ serverUrl: "https://Notes.Example.com/ignored" }),
    );
    await expect(suggestedServerUrl({ native: false, fetch })).resolves.toBe(
      "https://notes.example.com",
    );
    expect(asked).toEqual(["/config.json"]);
  });

  it("falls back to the build's when the host names none", async () => {
    vi.stubEnv("VITE_KONSPECTER_SERVER_URL", "https://build.example.com");
    const answers = [
      () => Response.json({ serverUrl: "" }),
      () => Response.json({ serverUrl: "ftp://notes.example.com" }),
      () => Response.json(["https://notes.example.com"]),
      () => new Response("<!doctype html><title>Konspecter</title>"),
      () => new Response("", { status: 404 }),
      () => {
        throw new TypeError("Failed to fetch");
      },
    ];
    for (const answer of answers) {
      await expect(suggestedServerUrl({ native: false, ...host(answer) })).resolves.toBe(
        "https://build.example.com",
      );
    }
  });

  it("is the build's in the desktop and mobile apps, without asking", async () => {
    vi.stubEnv("VITE_KONSPECTER_SERVER_URL", "https://build.example.com");
    const { fetch, asked } = host(() => Response.json({ serverUrl: "https://notes.example.com" }));
    await expect(suggestedServerUrl({ native: true, fetch })).resolves.toBe(
      "https://build.example.com",
    );
    expect(asked).toEqual([]);
  });
});
