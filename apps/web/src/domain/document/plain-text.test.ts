import { plainText } from "./plain-text";

describe("plainText", () => {
  it("keeps prose and code, drops markup, URLs and HTML tags", () => {
    const body = [
      "# Java *Collections*",
      "",
      "See [the docs](https://example.com/secret-url) and `HashMap`.",
      "",
      "```java\nMap<K, V> m;\n```",
      "",
      "<b>bold html</b> ![diagram](d.png)",
      "- item one",
      "",
      "line one",
      "line two",
    ].join("\n");

    expect(plainText(body)).toBe(
      "Java Collections\nSee the docs and HashMap.\nMap<K, V> m;\nbold html diagram\nitem one\nline one line two",
    );
  });

  it("is empty for an empty body", () => {
    expect(plainText("")).toBe("");
  });
});
