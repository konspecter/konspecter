import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { richText } from "./rich";

describe("richText", () => {
  it("puts elements in place of placeholders", () => {
    const html = renderToStaticMarkup(
      <p>{richText("Tag notes with {tag} or {missing}.", { tag: <code>#tag</code> })}</p>,
    );
    expect(html).toBe("<p>Tag notes with <code>#tag</code> or {missing}.</p>");
  });
});
