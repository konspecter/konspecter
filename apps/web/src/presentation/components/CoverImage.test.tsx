import { render } from "@testing-library/react";
import { CoverImage, embeddedCoverBytes, isDisplayableCover } from "./CoverImage";

describe("CoverImage", () => {
  it.each([
    ["https://example.com/c.png", true],
    ["http://example.com/c.png", true],
    ["images/cover.png", false],
    ["javascript:alert(1)", false],
    ["data:image/png;base64,AAAA", true],
    ["data:image/webp;base64,UklGRg==", true],
    ["data:image/svg+xml;base64,PHN2Zz4=", false],
    ["data:text/html;base64,PGI+", false],
    ["data:image/png,raw", false],
    ["", false],
  ])("isDisplayableCover(%j) is %s", (src, expected) => {
    expect(isDisplayableCover(src)).toBe(expected);
  });

  it("measures an uploaded cover by its decoded bytes", () => {
    expect(embeddedCoverBytes("data:image/png;base64,AQID")).toBe(3);
    expect(embeddedCoverBytes("data:image/png;base64,AQI=")).toBe(2);
    expect(embeddedCoverBytes("data:image/png;base64,AQ==")).toBe(1);
  });

  it("renders nothing for a cover it cannot display", () => {
    const { container } = render(<CoverImage src="javascript:alert(1)" />);

    expect(container).toBeEmptyDOMElement();
  });
});
