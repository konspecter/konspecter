import { clearPendingCookie, pendingCookie, readPending } from "./pending.server";

const withCookie = (cookie: string) =>
  new Request("http://site.test/", { headers: { Cookie: cookie } });

it("remembers the address and the mode in an HttpOnly cookie", () => {
  const cookie = pendingCookie({ mode: "register", email: "ann@example.com" });
  expect(cookie).toMatch(
    /^ksp_pending=register%3Aann%40example\.com; Path=\/; Max-Age=900; HttpOnly; SameSite=Lax$/,
  );
  const value = cookie.split(";")[0] ?? "";
  expect(readPending(withCookie(value))).toEqual({ mode: "register", email: "ann@example.com" });
});

it("ignores missing or tampered values", () => {
  expect(readPending(new Request("http://site.test/"))).toBeNull();
  expect(readPending(withCookie("ksp_pending=admin%3Aann%40example.com"))).toBeNull();
  expect(readPending(withCookie("ksp_pending=login%3Anot-an-address"))).toBeNull();
});

it("clears the cookie", () => {
  expect(clearPendingCookie()).toContain("Max-Age=0");
});
