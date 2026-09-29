import { render, screen, within } from "@testing-library/react";
import { MarkdownView } from "./MarkdownView";

function renderMarkdown(markdown: string, title = "", titleDerived = false) {
  const { container } = render(
    <MarkdownView markdown={markdown} title={title} titleDerived={titleDerived} />,
  );
  const root = container.querySelector(".markdown");
  if (!(root instanceof HTMLElement)) throw new Error("MarkdownView rendered no root");
  return root;
}

describe("MarkdownView: CommonMark and GFM", () => {
  it("renders headings at their levels", () => {
    renderMarkdown("# One\n\n## Two\n\n### Three\n\nSetext\n------");

    expect(screen.getByRole("heading", { level: 1, name: "One" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Two" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Three" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Setext" })).toBeInTheDocument();
  });

  it("does not treat tags as headings", () => {
    const root = renderMarkdown("#java#collections\n\n#java");

    expect(within(root).queryByRole("heading")).not.toBeInTheDocument();
    expect(root).toHaveTextContent("#java#collections");
  });

  it("renders ordered, unordered, nested and task lists", () => {
    const root = renderMarkdown("1. First\n2. Second\n   - Nested\n\n- [x] Done\n- [ ] Todo");

    const [ordered, nested, tasks] = within(root).getAllByRole("list");
    expect(ordered?.tagName).toBe("OL");
    expect(within(ordered as HTMLElement).getAllByRole("listitem")[0]).toHaveTextContent("First");
    expect(nested).toHaveTextContent("Nested");
    const checkboxes = within(tasks as HTMLElement).getAllByRole("checkbox");
    expect(checkboxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, false]);
    expect(checkboxes[0]).toBeDisabled();
  });

  it("renders emphasis, strikethrough, inline code and blockquotes", () => {
    const root = renderMarkdown("*em* **strong** ~~gone~~ `code`\n\n> quoted");

    expect(root.querySelector("em")).toHaveTextContent("em");
    expect(root.querySelector("strong")).toHaveTextContent("strong");
    expect(root.querySelector("del")).toHaveTextContent("gone");
    expect(root.querySelector("p code")).toHaveTextContent("code");
    expect(root.querySelector("blockquote")).toHaveTextContent("quoted");
  });

  it("renders tables in a scrollable wrapper", () => {
    renderMarkdown("| Type | Ordered |\n| :-- | --: |\n| ArrayList | yes |");

    const table = screen.getByRole("table");
    expect(table.parentElement).toHaveClass("markdown-table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Type", "Ordered"]);
    expect(within(table).getByRole("cell", { name: "yes" })).toHaveStyle({ textAlign: "right" });
  });

  it("renders images lazily with alt text", () => {
    renderMarkdown("![Diagram](https://example.com/d.png)");

    const image = screen.getByRole("img", { name: "Diagram" });
    expect(image).toHaveAttribute("src", "https://example.com/d.png");
    expect(image).toHaveAttribute("loading", "lazy");
  });
});

describe("MarkdownView: links", () => {
  it("opens external links in a new tab without leaking the opener", () => {
    renderMarkdown("[Docs](https://example.com/docs) and https://auto.example.com");

    for (const name of ["Docs", "https://auto.example.com"]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("keeps relative and mailto links in place", () => {
    renderMarkdown("[Other](other.md) [Mail](mailto:me@example.com)");

    expect(screen.getByRole("link", { name: "Other" })).toHaveAttribute("href", "other.md");
    expect(screen.getByRole("link", { name: "Other" })).not.toHaveAttribute("target");
    expect(screen.getByRole("link", { name: "Mail" })).toHaveAttribute(
      "href",
      "mailto:me@example.com",
    );
  });
});

describe("MarkdownView: code blocks", () => {
  it("highlights fenced code with a known language", () => {
    const root = renderMarkdown('```java\nString s = "hi"; // note\n```');

    const code = root.querySelector("pre > code");
    expect(code).toHaveClass("hljs", "language-java");
    expect(code?.querySelector(".hljs-string")).toHaveTextContent('"hi"');
    expect(code?.querySelector(".hljs-comment")).toHaveTextContent("// note");
    expect(code).toHaveTextContent('String s = "hi"; // note');
    expect(root.querySelector("pre")).toHaveAttribute("tabindex", "0");
  });

  it("leaves code without a language, or with an unknown one, as plain text", () => {
    const root = renderMarkdown("```\nplain <b>not html</b>\n```\n\n```nosuchlang\nx = 1\n```");

    const [plain, unknown] = root.querySelectorAll("pre > code");
    expect(plain?.querySelector("span")).toBeNull();
    expect(plain).toHaveTextContent("plain <b>not html</b>");
    expect(unknown?.querySelector("span")).toBeNull();
    expect(unknown).toHaveTextContent("x = 1");
  });
});

describe("MarkdownView: HTML safety", () => {
  it("keeps harmless HTML", () => {
    const root = renderMarkdown(
      "<details><summary>More</summary>\n\nHidden **text**\n\n</details>\n\nPress <kbd>Ctrl</kbd>",
    );

    expect(root.querySelector("details summary")).toHaveTextContent("More");
    expect(root.querySelector("details strong")).toHaveTextContent("text");
    expect(root.querySelector("kbd")).toHaveTextContent("Ctrl");
  });

  it.each([
    ["script elements", "<script>window.pwned = true</script>", "script"],
    ["style elements", "<style>body { display: none }</style>", "style"],
    ["iframes", '<iframe src="https://evil.example"></iframe>', "iframe"],
    ["forms", '<form action="https://evil.example"><input name="x"></form>', "form"],
  ])("removes %s", (_, markdown, selector) => {
    const root = renderMarkdown(`Before\n\n${markdown}\n\nAfter`);

    expect(root.querySelector(selector)).toBeNull();
    expect(root).toHaveTextContent("Before");
    expect(root).toHaveTextContent("After");
  });

  it("removes event handler and style attributes", () => {
    const root = renderMarkdown(
      '<img src="https://example.com/x.png" alt="x" onerror="alert(1)" style="position:fixed"> <b onclick="alert(1)">bold</b>',
    );

    const image = root.querySelector("img");
    expect(image).toHaveAttribute("src", "https://example.com/x.png");
    expect(image).not.toHaveAttribute("onerror");
    expect(image).not.toHaveAttribute("style");
    expect(root.querySelector("b")).not.toHaveAttribute("onclick");
  });

  it.each([
    ["a Markdown link", "[click](javascript:alert(1))"],
    ["an HTML link", '<a href="javascript:alert(1)">click</a>'],
    ["an obfuscated protocol", '<a href="JaVaScRiPt&#58;alert(1)">click</a>'],
    ["a data URL", '<a href="data:text/html,<script>alert(1)</script>">click</a>'],
  ])("drops dangerous URLs from %s", (_, markdown) => {
    const root = renderMarkdown(markdown);

    const link = root.querySelector("a");
    expect(link?.getAttribute("href") ?? "").not.toMatch(/javascript|data:/i);
    expect(root).toHaveTextContent("click");
  });

  it("drops images with non-http sources", () => {
    const root = renderMarkdown('<img src="data:image/svg+xml,<svg onload=alert(1)>" alt="svg">');

    expect(root.querySelector("img")?.getAttribute("src") ?? "").toBe("");
  });

  it("prefixes ids so notes cannot clobber page globals", () => {
    const root = renderMarkdown('<a id="location" name="top">x</a>');

    expect(root.querySelector("a")).toHaveAttribute("id", "user-content-location");
  });
});

describe("MarkdownView: title", () => {
  it("omits a leading h1 that the title was derived from", () => {
    const root = renderMarkdown("# Java *Collections*\n\nBody", "Java *Collections*", true);

    expect(within(root).queryByRole("heading")).not.toBeInTheDocument();
    expect(root).toHaveTextContent("Body");
  });

  it("omits a leading h1 that repeats the frontmatter title", () => {
    const root = renderMarkdown("\n\n# Java\n\nBody", "Java", false);

    expect(within(root).queryByRole("heading")).not.toBeInTheDocument();
  });

  it.each([
    ["differs from the frontmatter title", "# From body\n\nText", "From metadata"],
    ["is not the first block", "Intro\n\n# Java", "Java"],
    ["is not level 1", "## Java", "Java"],
  ])("keeps a heading that %s", (_, markdown, title) => {
    const root = renderMarkdown(markdown, title, false);

    expect(within(root).getByRole("heading")).toBeInTheDocument();
  });
});
