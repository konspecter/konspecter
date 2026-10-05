import { isSameOriginRequest } from "./origin.server";

const post = (origin?: string) =>
  new Request("http://localhost:3000/preferences", {
    method: "POST",
    headers: origin ? { Origin: origin } : {},
  });

it("lets reads through", () => {
  expect(
    isSameOriginRequest(new Request("http://localhost:3000/"), "https://notes.example.com"),
  ).toBe(true);
});

it("accepts posts from the site's own origin", () => {
  expect(isSameOriginRequest(post("http://localhost:3000"), null)).toBe(true);
  expect(isSameOriginRequest(post("https://notes.example.com"), "https://notes.example.com")).toBe(
    true,
  );
});

it("refuses posts from elsewhere or without an origin", () => {
  expect(isSameOriginRequest(post("https://evil.example"), null)).toBe(false);
  expect(isSameOriginRequest(post("http://localhost:3000"), "https://notes.example.com")).toBe(
    false,
  );
  expect(isSameOriginRequest(post(), null)).toBe(false);
});
