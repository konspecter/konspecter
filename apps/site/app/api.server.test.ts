import { callApi, withCookies } from "./api.server";

const browserRequest = new Request("http://site.test/login", {
  method: "POST",
  headers: {
    Cookie: "ksp_session=kss_x",
    Origin: "http://site.test",
    "Accept-Language": "ru",
    "User-Agent": "Test Browser",
    "X-Forwarded-For": "198.51.100.7",
    Authorization: "Bearer must-not-pass",
  },
});

it("forwards the visitor and sends JSON", async () => {
  const fetcher = vi.fn(() =>
    Promise.resolve(
      Response.json(
        { user: { id: "u", email: "a@example.com" } },
        { headers: { "Set-Cookie": "ksp_session=kss_new; Path=/; HttpOnly" } },
      ),
    ),
  );
  const result = await callApi(
    browserRequest,
    "/api/auth/login",
    { method: "POST", body: { a: 1 } },
    fetcher,
  );

  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://localhost:8080/api/auth/login");
  const headers = new Headers(init.headers);
  expect(headers.get("Cookie")).toBe("ksp_session=kss_x");
  expect(headers.get("Origin")).toBe("http://site.test");
  expect(headers.get("Accept-Language")).toBe("ru");
  expect(headers.get("User-Agent")).toBe("Test Browser");
  expect(headers.get("X-Forwarded-For")).toBe("198.51.100.7");
  expect(headers.get("Authorization")).toBeNull();
  expect(headers.get("Content-Type")).toBe("application/json");
  expect(init.body).toBe('{"a":1}');

  expect(result.status).toBe(200);
  expect(result.data).toEqual({ user: { id: "u", email: "a@example.com" } });
  expect(result.error).toBeNull();
  expect(result.cookies).toEqual(["ksp_session=kss_new; Path=/; HttpOnly"]);
});

it("reads API errors and Retry-After", async () => {
  const fetcher = vi.fn(() =>
    Promise.resolve(
      Response.json(
        { error: { code: "rate_limited", message: "too many" } },
        { status: 429, headers: { "Retry-After": "61" } },
      ),
    ),
  );
  const result = await callApi(
    browserRequest,
    "/api/auth/code",
    { method: "POST", body: {} },
    fetcher,
  );
  expect(result).toMatchObject({
    status: 429,
    data: null,
    error: { code: "rate_limited", message: "too many" },
    retryAfter: 61,
  });
});

it("turns a non-JSON failure into an internal error", async () => {
  const fetcher = vi.fn(() => Promise.resolve(new Response("bad gateway", { status: 502 })));
  const result = await callApi(browserRequest, "/api/me", {}, fetcher);
  expect(result.error?.code).toBe("internal");
});

it("reports an unreachable API instead of throwing", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const fetcher = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
  const result = await callApi(browserRequest, "/api/me", {}, fetcher);
  expect(result).toMatchObject({ status: 503, error: { code: "unreachable" } });
});

it("passes cookies on to the browser", () => {
  const headers = withCookies(["a=1"], ["b=2"]);
  expect(headers.getSetCookie()).toEqual(["a=1", "b=2"]);
});
