import { RouterContextProvider } from "react-router";
import { action as complete, loader as completeLoader } from "./complete";
import { action as login } from "./login";
import { action as loginCode, loader as loginCodeLoader } from "./login-code";
import { action as logout } from "./logout";
import { action as register } from "./register";

/** The API's replies, by path; each call is recorded. */
function stubApi(replies: Record<string, () => Response>) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ path, body });
      const reply = replies[path];
      return reply
        ? Promise.resolve(reply())
        : Promise.reject(new Error(`unexpected call to ${path}`));
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function post(path: string, fields: Record<string, string>, cookie = "") {
  return new Request(`http://site.test${path}`, {
    method: "POST",
    headers: {
      Origin: "http://site.test",
      "Accept-Language": "ru-RU",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: new URLSearchParams(fields),
  });
}

const args = (request: Request) =>
  ({ request, params: {}, context: new RouterContextProvider() }) as never;
const session = "ksp_session=kss_1; Path=/; HttpOnly; SameSite=Lax";

it("signs in with a password and passes the session cookie on", async () => {
  const calls = stubApi({
    "/api/auth/login": () => Response.json({ user: {} }, { headers: { "Set-Cookie": session } }),
  });
  const response = (await login(
    args(
      post("/login?next=/elsewhere", {
        email: " ann@example.com ",
        password: "pw",
        intent: "password",
      }),
    ),
  )) as Response;
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/elsewhere");
  expect(response.headers.getSetCookie()).toEqual([session]);
  expect(calls[0]?.body).toEqual({ email: "ann@example.com", password: "pw" });
});

it("asks for a password before calling the API", async () => {
  const calls = stubApi({});
  const result = (await login(
    args(post("/login", { email: "ann@example.com", password: "", intent: "password" })),
  )) as {
    data: unknown;
    init: { status: number };
  };
  expect(result.data).toEqual({
    email: "ann@example.com",
    mode: "password",
    error: { code: "password_required" },
  });
  expect(result.init.status).toBe(400);
  expect(calls).toHaveLength(0);
});

it("switches between the code and the password without JavaScript", async () => {
  const calls = stubApi({});
  expect(
    await login(args(post("/login", { email: " ann@example.com ", intent: "use-password" }))),
  ).toEqual({ email: "ann@example.com", mode: "password", error: null });
  expect(await login(args(post("/login", { email: "", intent: "use-code" })))).toEqual({
    email: "",
    mode: "code",
    error: null,
  });
  expect(calls).toHaveLength(0);
});

it("returns the API's error to the form", async () => {
  stubApi({
    "/api/auth/login": () =>
      Response.json({ error: { code: "invalid_credentials", message: "" } }, { status: 401 }),
  });
  const result = (await login(
    args(post("/login", { email: "a@example.com", password: "x", intent: "password" })),
  )) as {
    data: { error: { code: string } };
  };
  expect(result.data.error.code).toBe("invalid_credentials");
});

it("sends a code in the visitor's language and remembers the address", async () => {
  const calls = stubApi({
    "/api/auth/code": () => Response.json({ expires_in: 600 }, { status: 202 }),
  });
  const response = (await login(
    args(post("/login", { email: "ann@example.com", intent: "code" })),
  )) as Response;
  expect(response.headers.get("Location")).toBe("/login/code?next=%2F");
  expect(response.headers.getSetCookie()[0]).toMatch(/^ksp_pending=login%3Aann%40example\.com;/);
  expect(calls[0]?.body).toEqual({ email: "ann@example.com", locale: "ru" });
});

it("registers with the password and remembers that it is a sign-up", async () => {
  const calls = stubApi({
    "/api/auth/code": () => Response.json({ expires_in: 600 }, { status: 202 }),
  });
  const response = (await register(
    args(post("/register", { email: "new@example.com", password: "long enough" })),
  )) as Response;
  expect(response.headers.get("Location")).toBe("/login/code");
  expect(response.headers.getSetCookie()[0]).toMatch(/^ksp_pending=register%3A/);
  expect(calls[0]?.body).toEqual({
    email: "new@example.com",
    password: "long enough",
    locale: "ru",
  });
});

it("verifies the code for the remembered address and forgets it", async () => {
  const calls = stubApi({
    "/api/auth/code/verify": () =>
      Response.json({ user: {} }, { headers: { "Set-Cookie": session } }),
  });
  const pending = "ksp_pending=login%3Aann%40example.com";
  const result = (await loginCode(
    args(post("/login/code", { code: "123 456", intent: "verify" }, pending)),
  )) as {
    data: unknown;
    init: { headers: Headers };
  };
  // The page shows a tick, then goes on to `next` by itself.
  expect(result.data).toEqual({ error: null, resent: false, next: "/" });
  expect(result.init.headers.getSetCookie()).toEqual([
    session,
    expect.stringContaining("ksp_pending=; Path=/; Max-Age=0"),
  ]);
  expect(calls[0]?.body).toEqual({ email: "ann@example.com", code: "123 456" });
});

it("sends the visitor back to /login without a remembered address", async () => {
  stubApi({});
  await expect(loginCode(args(post("/login/code", { code: "1" })))).rejects.toMatchObject({
    status: 302,
  });
  await expect(
    Promise.resolve().then(() => loginCodeLoader(args(new Request("http://site.test/login/code")))),
  ).rejects.toMatchObject({ status: 302 });
});

it("signs out through the API and goes home in the visitor's language", async () => {
  const cleared = "ksp_session=; Path=/; Max-Age=0";
  stubApi({
    "/api/auth/logout": () =>
      new Response(null, { status: 204, headers: { "Set-Cookie": cleared } }),
  });
  const response = await logout(args(post("/logout", {}, "ksp_session=kss_1")));
  expect(response.headers.get("Location")).toBe("/ru/");
  expect(response.headers.getSetCookie()).toEqual([cleared]);
});

it("finishes a provider sign-in: a code to the entered address, remembered as such", async () => {
  const calls = stubApi({
    "/api/auth/complete": () => Response.json({ expires_in: 600 }, { status: 202 }),
  });
  const response = (await complete(
    args(post("/complete?next=/settings", { email: "ann@example.com" }, "ksp_link=ksl_1")),
  )) as Response;
  expect(response.headers.get("Location")).toBe("/login/code?next=%2Fsettings");
  expect(response.headers.getSetCookie()[0]).toMatch(/^ksp_pending=complete%3Aann%40example\.com;/);
  expect(calls[0]?.body).toEqual({ email: "ann@example.com", locale: "ru" });
});

it("starts over when the provider sign-in has expired", async () => {
  const expired = () =>
    Response.json({ error: { code: "identity_expired", message: "" } }, { status: 404 });
  stubApi({ "/api/auth/complete": expired });
  await expect(
    complete(args(post("/complete", { email: "ann@example.com" }))),
  ).rejects.toMatchObject({ status: 302 });
  await expect(completeLoader(args(new Request("http://site.test/complete")))).rejects.toSatisfy(
    (response: Response) => response.headers.get("Location") === "/login?error=identity_expired",
  );
});

it("shows which provider is waiting, with its suggested address", async () => {
  stubApi({
    "/api/auth/complete": () => Response.json({ provider: "vk", email: "ann@vk.com" }),
  });
  expect(await completeLoader(args(new Request("http://site.test/complete")))).toEqual({
    provider: "vk",
    suggested: "ann@vk.com",
  });
});

it("asks again for a code that finishes the provider sign-in", async () => {
  const calls = stubApi({
    "/api/auth/complete": () => Response.json({ expires_in: 600 }, { status: 202 }),
  });
  const pending = "ksp_pending=complete%3Aann%40example.com";
  const result = await loginCode(args(post("/login/code", { intent: "resend" }, pending)));
  expect(result).toEqual({ error: null, resent: true, next: null });
  expect(calls[0]).toEqual({
    path: "/api/auth/complete",
    body: { email: "ann@example.com", locale: "ru" },
  });
});
