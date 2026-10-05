import { guessPlatform } from "./platform";

it("guesses the platform from the user agent", () => {
  expect(guessPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macos");
  expect(guessPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
  expect(guessPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  expect(guessPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
  expect(guessPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBeNull();
  expect(guessPlatform(null)).toBeNull();
});
