import { isNativeMobile } from "./mobile";

afterEach(() => {
  delete (window as { Capacitor?: unknown }).Capacitor;
});

it("detects the native mobile app", () => {
  expect(isNativeMobile()).toBe(false);
  (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => false };
  expect(isNativeMobile()).toBe(false);
  (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  expect(isNativeMobile()).toBe(true);
});
