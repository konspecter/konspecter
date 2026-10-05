import { loginProviders, returnedError } from "./providers.server";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubProviders(body: unknown, status = 200) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(url);
      return Promise.resolve(Response.json(body, { status }));
    }),
  );
  return urls;
}

it("asks for the providers of the visitor's language and keeps the known ones", async () => {
  const urls = stubProviders({ providers: ["yandex", "myspace", "vk"] });
  const request = new Request("http://site.test/login", { headers: { Cookie: "lang=ru" } });
  expect(await loginProviders(request)).toEqual(["yandex", "vk"]);
  expect(new URL(urls[0] ?? "").search).toBe("?locale=ru");
});

it("offers none when the API cannot say", async () => {
  stubProviders({ error: { code: "not_configured", message: "" } }, 503);
  expect(await loginProviders(new Request("http://site.test/login"))).toEqual([]);
});

it("reads only the errors a provider sign-in returns with", () => {
  const at = (query: string) => returnedError(new Request(`http://site.test/login${query}`));
  expect(at("?error=oauth_failed")).toEqual({ code: "oauth_failed" });
  expect(at("?error=rate_limited")).toEqual({ code: "rate_limited", minutes: 15 });
  expect(at("?error=made_up")).toBeNull();
  expect(at("")).toBeNull();
});
