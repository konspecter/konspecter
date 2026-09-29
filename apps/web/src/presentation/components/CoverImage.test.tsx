import { render } from "@testing-library/react";
import { CoverImage, isDisplayableCover } from "./CoverImage";

describe("CoverImage", () => {
  it.each([
    ["https://example.com/c.png", true],
    ["http://example.com/c.png", true],
    ["images/cover.png", false],
    ["javascript:alert(1)", false],
    ["data:image/png;base64,AAAA", false],
    ["", false],
  ])("isDisplayableCover(%j) is %s", (src, expected) => {
    expect(isDisplayableCover(src)).toBe(expected);
  });

  it("renders nothing for a cover it cannot display", () => {
    const { container } = render(<CoverImage src="javascript:alert(1)" />);

    expect(container).toBeEmptyDOMElement();
  });
});
