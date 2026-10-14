import { nextPath } from "./account.server";

const at = (path: string) => new Request(`https://example.com${path}`);

it("goes back to the page asked for after signing in", () => {
  expect(nextPath(at("/login?next=%2Factivate%3Fcode%3DAB12"))).toBe("/activate?code=AB12");
  expect(nextPath(at("/login?next=%2F"))).toBe("/");
});

it("goes to the settings when no page, or one off the site, was asked for", () => {
  expect(nextPath(at("/login"))).toBe("/settings");
  expect(nextPath(at("/login?next="))).toBe("/settings");
  expect(nextPath(at("/login?next=https%3A%2F%2Fevil.example"))).toBe("/settings");
  expect(nextPath(at("/login?next=%2F%2Fevil.example"))).toBe("/settings");
});
