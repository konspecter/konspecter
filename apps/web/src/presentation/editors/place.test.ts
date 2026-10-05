import type { Node } from "prosemirror-model";
import { describe, expect, it } from "vitest";
import { mapPlace, positionMap } from "./place";
import { markdownToTextDoc } from "./text-markdown";
import { textSchema } from "./text-schema";

function textDoc(body: string): Node {
  const content = markdownToTextDoc(body);
  if (!content.supported) throw new Error(content.reason);
  return content.doc;
}

/** The position before the first `text` in the document's text. */
function positionOf(doc: Node, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    const index = node.isText ? (node.text ?? "").indexOf(text) : -1;
    if (found === -1 && index !== -1) found = pos + index;
    return found === -1;
  });
  if (found === -1) throw new Error(`No "${text}" in the document`);
  return found;
}

const body = [
  "# A title",
  "",
  "Some **bold** text and a [link](https://example.com/a) here,",
  "on two lines.",
  "",
  "- first item",
  "- second *item*",
  "",
  "> quoted",
  "",
  "```js",
  "const x = 1;",
  "```",
  "",
  "Привет, мир 🙂 end",
  "",
].join("\n");

describe("positions between the text editor and the source", () => {
  const doc = textDoc(body);
  const map = positionMap(doc, body);

  it.each([
    ["A title", "A title"],
    ["bold", "bold"],
    ["text and", "text and"],
    ["link", "link"],
    [" here", " here"],
    ["on two", "on two"],
    ["second", "second"],
    ["item", "item"],
    ["quoted", "quoted"],
    ["const x", "const x"],
    ["мир", "мир"],
    ["end", "end"],
  ])("puts a caret before %j before it in the source", (text, source) => {
    expect(map.toSource(positionOf(doc, text))).toBe(body.indexOf(source));
    expect(map.toText(body.indexOf(source))).toBe(positionOf(doc, text));
  });

  it("puts a caret after marked text after the markup", () => {
    const end = positionOf(doc, "bold") + "bold".length;
    expect(map.toSource(end)).toBe(body.indexOf(" text"));
  });

  it("steps over the markup from the source", () => {
    expect(map.toText(body.indexOf("*bold"))).toBe(positionOf(doc, "bold"));
    expect(map.toText(body.indexOf("https"))).toBe(positionOf(doc, " here"));
    expect(map.toText(body.indexOf("# A") + 1)).toBe(positionOf(doc, "A title"));
  });

  it("puts a caret between blocks at the end of the block before", () => {
    const blank = body.indexOf("\n\n- first") + 1;
    expect(map.toText(blank)).toBe(positionOf(doc, "on two") + "on two lines.".length);
    expect(map.toText(0)).toBe(positionOf(doc, "A title"));
    expect(map.toText(body.length)).toBe(positionOf(doc, "end") + "end".length);
  });

  it("brings every position of the text back to itself", () => {
    doc.descendants((node, pos) => {
      if (!node.isText) return true;
      for (let at = pos; at <= pos + node.nodeSize; at += 1) {
        expect(map.toText(map.toSource(at))).toBe(at);
      }
      return false;
    });
  });

  it("maps a whole place", () => {
    const at = positionOf(doc, "bold");
    expect(mapPlace({ anchor: at, head: at + 4, shown: { at, top: 120 } }, map.toSource)).toEqual({
      anchor: body.indexOf("bold"),
      head: body.indexOf(" text"),
      shown: { at: body.indexOf("bold"), top: 120 },
    });
  });
});

describe("positions in documents that are not written as read", () => {
  it("steps over an empty paragraph, which the source leaves out", () => {
    const { paragraph } = textSchema.nodes;
    const doc = textSchema.node("doc", null, [
      paragraph.create(null, textSchema.text("one")),
      paragraph.create(),
      paragraph.create(null, textSchema.text("two")),
    ]);
    const map = positionMap(doc, "one\n\ntwo\n");
    expect(map.toSource(positionOf(doc, "two"))).toBe(5);
    expect(map.toSource(positionOf(doc, "one") + 4)).toBe(3); // In the empty paragraph.
  });

  it("maps hard breaks and setext headings", () => {
    const source = "Title\n=====\n\nline one  \nline two\n";
    const doc = textDoc(source);
    const map = positionMap(doc, source);
    expect(map.toSource(positionOf(doc, "Title"))).toBe(0);
    expect(map.toSource(positionOf(doc, "line two"))).toBe(source.indexOf("line two"));
  });

  it("opens an empty document at its start", () => {
    const doc = textDoc("");
    expect(positionMap(doc, "").toSource(1)).toBe(0);
    expect(positionMap(doc, "").toText(0)).toBe(0);
  });
});
