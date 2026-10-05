import { contentSecurityPolicy } from "./entry.server";

it("allows scripts only from the site and with the response's nonce", () => {
  const policy = contentSecurityPolicy("abc");
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("script-src 'self' 'nonce-abc'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).not.toContain("unsafe-inline");
});
