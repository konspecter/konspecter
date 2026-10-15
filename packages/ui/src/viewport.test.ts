import { describe, expect, it } from "vitest";
import { isIos, withoutFocusZoom } from "./viewport";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPAD_OR_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

describe("isIos", () => {
  it("knows an iPhone, and an iPad by its touch screen", () => {
    expect(isIos(IPHONE, 5)).toBe(true);
    expect(isIos(IPAD_OR_MAC, 5)).toBe(true);
  });

  it("leaves out a Mac and Android, where the limit would stop pinch zoom", () => {
    expect(isIos(IPAD_OR_MAC, 0)).toBe(false);
    expect(isIos(ANDROID, 5)).toBe(false);
  });
});

describe("withoutFocusZoom", () => {
  it("limits the scale once", () => {
    const content = "width=device-width, initial-scale=1, viewport-fit=cover";
    expect(withoutFocusZoom(content)).toBe(`${content}, maximum-scale=1`);
    expect(withoutFocusZoom(withoutFocusZoom(content))).toBe(`${content}, maximum-scale=1`);
  });
});
