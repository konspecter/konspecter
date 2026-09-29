import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { NoteEditor, type EditorMode } from "./NoteEditor";
import { setSourceValue, sourceValue, typeSubstituted } from "./test-helpers";

/** The editor with a mode switch, as the top bar drives it. */
function Harness({
  initialMarkdown,
  initialMode,
  onChange,
  showMetadata,
}: {
  initialMarkdown: string;
  initialMode: EditorMode;
  onChange: (read: () => string) => void;
  showMetadata: boolean;
}) {
  const [mode, setMode] = useState(initialMode);
  return (
    <>
      {(["text", "markdown"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => {
            setMode(value);
          }}
        >
          {value === "text" ? "Text" : "Markdown"}
        </button>
      ))}
      <NoteEditor
        initialMarkdown={initialMarkdown}
        mode={mode}
        onChange={onChange}
        showMetadata={showMetadata}
      />
    </>
  );
}

function renderEditor(
  initialMarkdown: string,
  initialMode: EditorMode = "text",
  showMetadata = false,
) {
  let latest: (() => string) | null = null;
  const onChange = vi.fn((read: () => string) => {
    latest = read;
  });
  render(
    <Harness
      initialMarkdown={initialMarkdown}
      initialMode={initialMode}
      onChange={onChange}
      showMetadata={showMetadata}
    />,
  );
  /** What a save would write now: the latest reported text, or the untouched original. */
  const save = () => (latest ? latest() : initialMarkdown);
  return { save, onChange };
}

const textBox = () => screen.getByRole("textbox", { name: "Note text" });
const sourceBox = () => screen.getByRole("textbox", { name: "Markdown" });

async function typeInText(keys: string) {
  await userEvent.click(textBox());
  await userEvent.keyboard(keys);
}

/** Puts the caret after the last character; user-event cannot press End in contenteditable. */
async function typeAtEnd(keys: string) {
  await userEvent.click(textBox());
  const walker = document.createTreeWalker(textBox(), NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  while (walker.nextNode()) last = walker.currentNode as Text;
  if (last) document.getSelection()?.collapse(last, last.length);
  document.dispatchEvent(new Event("selectionchange"));
  await userEvent.keyboard(keys);
}

describe("text mode", () => {
  it("is used for notes it can represent", () => {
    renderEditor("---\ntitle: T\n---\n\n# Java\n\nText");

    expect(screen.getByRole("button", { name: "Text" })).toHaveAttribute("aria-pressed", "true");
    expect(textBox()).toHaveTextContent("JavaText");
    expect(textBox().querySelector("h1")).toHaveTextContent("Java");
  });

  it("reports nothing until something is edited, so the note stays as written", () => {
    const markdown = "---\n# comment\ntitle: T\n---\n\nTitle\n===\n\n- wrapped\n  line\n";
    const { save, onChange } = renderEditor(markdown);

    expect(onChange).not.toHaveBeenCalled();
    expect(save()).toBe(markdown);
  });

  it("serializes the text only when it is read, not per keystroke", async () => {
    const { onChange } = renderEditor("Start");

    await typeAtEnd(" and more");

    expect(onChange).toHaveBeenCalledTimes(" and more".length);
    const read = onChange.mock.calls.at(-1)?.[0];
    expect(read?.()).toBe("Start and more");
  });

  it("writes Markdown for typed text and keeps the frontmatter as written", async () => {
    const { save } = renderEditor("---\n# comment\ntitle: T\n---\n\nStart");

    await typeAtEnd(" more");

    expect(save()).toBe("---\n# comment\ntitle: T\n---\n\nStart more");
  });

  it("turns Markdown shortcuts into blocks", async () => {
    const { save } = renderEditor("");

    await typeInText("# Title{Enter}- first{Enter}second");

    expect(save()).toBe("# Title\n\n* first\n\n* second");
  });

  it("shows the formatting toolbar only while the text has focus", async () => {
    renderEditor("Some text");

    expect(screen.queryByRole("toolbar", { name: "Formatting" })).not.toBeInTheDocument();
    await userEvent.click(textBox());
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    expect(toolbar).toHaveAttribute("aria-orientation", "vertical");
    expect(toolbar.style.top).toBe("0px");

    await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
    await userEvent.click(screen.getByRole("button", { name: "Text" }));
    expect(screen.queryByRole("toolbar", { name: "Formatting" })).not.toBeInTheDocument();
  });

  it("keeps the toolbar while focus moves into it", async () => {
    renderEditor("Some text");

    await userEvent.click(textBox());
    await userEvent.tab();

    expect(screen.getByRole("toolbar", { name: "Formatting" })).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it("formats with the toolbar", async () => {
    const { save } = renderEditor("");

    await typeInText("plain ");
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    await userEvent.keyboard("bold");

    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
    expect(save()).toBe("plain **bold**");
  });

  it("folds to one tool and its toggle, and unfolds to all of them", async () => {
    renderEditor("Some text");

    await userEvent.click(textBox());
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    const toggle = within(toolbar).getByRole("button", { name: "All formatting tools" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      within(toolbar)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Bold", "All formatting tools"]);

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(toolbar).getByRole("button", { name: "Code block" })).toBeInTheDocument();
    expect(localStorage.getItem("konspecter.toolbar")).toBe("open");
  });

  it("keeps the tool in effect at the caret when folded", async () => {
    renderEditor("## Section");

    await userEvent.click(textBox());
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    expect(
      within(toolbar)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Heading", "All formatting tools"]);
  });

  it("toggles headings on the current block", async () => {
    const { save } = renderEditor("Section");

    await userEvent.click(textBox());
    await userEvent.click(screen.getByRole("button", { name: "All formatting tools" }));
    await userEvent.click(screen.getByRole("button", { name: "Heading" }));

    expect(screen.getByRole("button", { name: "Heading" })).toHaveAttribute("aria-pressed", "true");
    expect(save()).toBe("## Section");
  });
});

describe("notes the text editor cannot represent", () => {
  it.each([
    ["tables", "| a |\n| - |\n| b |", "This note uses tables"],
    ["HTML", "Press <kbd>K</kbd>", "This note uses HTML"],
  ])("with %s are shown rendered, and edited in Markdown mode", async (_, markdown, notice) => {
    renderEditor(markdown);

    expect(screen.getByRole("status")).toHaveTextContent(notice);
    expect(screen.queryByRole("textbox", { name: "Note text" })).not.toBeInTheDocument();
    expect(await screen.findByText(/K|b/, { selector: ".markdown *" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
    expect(sourceValue(sourceBox())).toBe(markdown);
  });

  it("with invalid frontmatter open as source, to be fixed", () => {
    renderEditor("---\ntitle: [\n---\n");

    expect(sourceValue(sourceBox())).toBe("---\ntitle: [\n---\n");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Text editing is unavailable: Frontmatter",
    );
  });

  it("stay out of the text editor when switching back to Text", async () => {
    renderEditor("~~gone~~", "markdown");

    await userEvent.click(screen.getByRole("button", { name: "Text" }));

    expect(screen.queryByRole("textbox", { name: "Markdown" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("strikethrough");
  });
});

describe("switching modes", () => {
  it("carries edits from text to Markdown and back", async () => {
    const { save } = renderEditor("---\ntitle: T\n---\n\nOne");

    await typeAtEnd(" two");
    await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
    expect(sourceValue(sourceBox())).toBe("---\ntitle: T\n---\n\nOne two");

    await userEvent.click(sourceBox());
    await userEvent.keyboard("{Control>}{End}{/Control} three");
    await userEvent.click(screen.getByRole("button", { name: "Text" }));
    expect(textBox()).toHaveTextContent("One two three");

    expect(save()).toBe("---\ntitle: T\n---\n\nOne two three");
  });

  it("can start in Markdown mode", () => {
    renderEditor("Text", "markdown");

    expect(sourceValue(sourceBox())).toBe("Text");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("Markdown source editor", () => {
  it("edits by typing and offers no autocompletion", async () => {
    const { save } = renderEditor("", "markdown");

    await userEvent.click(sourceBox());
    await userEvent.keyboard("# Ti");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(sourceValue(sourceBox())).toBe("# Ti");
    expect(save()).toBe("# Ti");
  });
});

describe("metadata fields", () => {
  const titleField = () => screen.getByRole("textbox", { name: "Title" });
  const coverField = () => screen.getByRole("textbox", { name: "Cover image" });

  it("stay out of the way while empty, and show when they have a value", () => {
    renderEditor("# Heading only\n\nBody");
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Cover image" })).not.toBeInTheDocument();
  });

  it("show a set title without an empty cover field", () => {
    renderEditor("---\ntitle: Set\n---\n\nBody");
    expect(titleField()).toHaveValue("Set");
    expect(screen.queryByRole("textbox", { name: "Cover image" })).not.toBeInTheDocument();
  });

  it("keep a field while its value is cleared", async () => {
    renderEditor("---\ntitle: Old\n---\n\nBody");
    await userEvent.clear(titleField());
    expect(titleField()).toHaveValue("");
    expect(titleField()).toHaveFocus();
  });

  it("shows the derived title as a placeholder until a title is set", () => {
    renderEditor("# From heading\n\nBody", "text", true);

    expect(titleField()).toHaveValue("");
    expect(titleField()).toHaveAttribute("placeholder", "From heading");
  });

  it("writes the title and cover into the frontmatter, keeping other keys", async () => {
    const { save } = renderEditor("---\n# mine\ntags: [a]\n---\n\nBody", "text", true);

    await userEvent.type(titleField(), "Java: Collections");
    await userEvent.type(coverField(), "https://example.com/c.png");

    expect(save()).toBe(
      '---\n# mine\ntags: [a]\ntitle: "Java: Collections"\ncover: "https://example.com/c.png"\n---\n\nBody',
    );
  });

  it("removes the key when a field is cleared", async () => {
    const { save } = renderEditor("---\ntitle: Old\ncover: x.png\n---\n\nBody", "text", true);

    await userEvent.clear(titleField());
    await userEvent.clear(coverField());

    expect(save()).toBe("---\n---\n\nBody");
  });

  it("follows the body's first line as it is typed", async () => {
    renderEditor("", "text", true);

    await typeInText("# Fresh title");

    expect(titleField()).toHaveAttribute("placeholder", "Fresh title");
  });

  it("reflects frontmatter edited in Markdown mode", async () => {
    renderEditor("Body", "text", true);

    await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
    setSourceValue(sourceBox(), "---\ntitle: Typed in source\n---\n\nBody");
    await userEvent.click(screen.getByRole("button", { name: "Text" }));

    expect(titleField()).toHaveValue("Typed in source");
  });
});

describe("tags and code in the editors", () => {
  const marked = (root: Element) =>
    [...root.querySelectorAll(".md-tag")].map((element) => element.textContent);

  it("marks tags in the text editor, but not in code", () => {
    renderEditor("Notes on #java and `#code`\n\n```\n#not\n```");

    expect(marked(textBox())).toEqual(["#java"]);
  });

  it("marks tags and code blocks in the Markdown editor", () => {
    renderEditor(
      '---\nk: "#no"\n---\n# Title #tips\n\nSee `#no` https://a.b/#no\n\n```json\n{"a": "#no"}\n```',
      "markdown",
    );

    expect(marked(sourceBox())).toEqual(["#tips"]);
    expect(sourceBox().querySelectorAll(".cm-code-line")).toHaveLength(3);
  });

  it("keeps a typed straight quote in code, and the system's quote in prose", () => {
    renderEditor("Text\n\n```json\n{}\n```", "markdown");
    const box = sourceBox();
    const inCode = "Text\n\n```json\n{".length;

    expect(typeSubstituted(box, inCode, '"', "«")).toBe(true);
    expect(sourceValue(box)).toBe('Text\n\n```json\n{"}\n```');
    expect(typeSubstituted(box, 4, '"', "«")).toBe(false);
  });
});

describe("the title and tags found in the Markdown source", () => {
  it("shows them above the source, read-only, and follows the typing", async () => {
    renderEditor("# Заголовок\n\nНовый текст\n\n#go#to\n\n#goto", "markdown");

    const found = screen.getByLabelText("Title and tags found in the text");
    expect(found).toHaveTextContent("TitleЗаголовок");
    expect([...found.querySelectorAll(".md-tag")].map((tag) => tag.textContent)).toEqual([
      "#go#to",
      "#goto",
    ]);

    setSourceValue(sourceBox(), "---\ntags: [meta]\n---\n# Other\n\n#goto");
    await waitFor(() => {
      expect(found).toHaveTextContent("TitleOther");
    });
    expect([...found.querySelectorAll(".md-tag")].map((tag) => tag.textContent)).toEqual([
      "#meta",
      "#goto",
    ]);
  });

  it("is not shown in the text editor, or when there is nothing to show", () => {
    renderEditor("# Title", "text");
    expect(screen.queryByLabelText("Title and tags found in the text")).not.toBeInTheDocument();
  });
});
