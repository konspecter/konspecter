import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { NoteEditor, type EditorMode } from "./NoteEditor";
import { undo } from "@codemirror/commands";
import { setSourceValue, sourceValue, sourceView, typeSubstituted } from "./test-helpers";
import { coverDataUrl, CoverImageError } from "../../infrastructure/files/cover-image";
import type { EditorSelection } from "../../domain/reading/reading";

// jsdom cannot decode images; the conversion itself is tested on its own.
vi.mock("../../infrastructure/files/cover-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infrastructure/files/cover-image")>()),
  coverDataUrl: vi.fn(),
}));

/** The editor with a mode switch, as the top bar drives it. */
function Harness({
  initialMarkdown,
  initialMode,
  onChange,
  showMetadata,
  onSelectionChange,
}: {
  initialMarkdown: string;
  initialMode: EditorMode;
  onChange: (read: () => string) => void;
  showMetadata: boolean;
  onSelectionChange: (selection: EditorSelection) => void;
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
        onSelectionChange={onSelectionChange}
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
  let caret: EditorSelection | null = null;
  render(
    <Harness
      initialMarkdown={initialMarkdown}
      initialMode={initialMode}
      onChange={onChange}
      showMetadata={showMetadata}
      onSelectionChange={(selection) => {
        caret = selection;
      }}
    />,
  );
  /** What a save would write now: the latest reported text, or the untouched original. */
  const save = () => (latest ? latest() : initialMarkdown);
  /** Where the caret was last reported, in which editor. */
  const selection = () => caret;
  return { save, onChange, selection };
}

const textBox = () => screen.getByRole("textbox", { name: "Conspect text" });
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
    expect(read?.()).toBe("---\ntitle: Start and more\n---\n\nStart and more");
  });

  it("writes Markdown for typed text and keeps the frontmatter as written", async () => {
    const { save } = renderEditor("---\n# comment\ntitle: T\n---\n\nStart");

    await typeAtEnd(" more");

    expect(save()).toBe("---\n# comment\ntitle: T\n---\n\nStart more");
  });

  it("turns Markdown shortcuts into blocks", async () => {
    const { save } = renderEditor("");

    await typeInText("# Title{Enter}- first{Enter}second");

    expect(save()).toBe("---\ntitle: Title\n---\n\n# Title\n\n* first\n* second");
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
    expect(save()).toBe("---\ntitle: plain bold\n---\n\nplain **bold**");
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

  it("keeps the last tool used when folded, also in the next editor", async () => {
    renderEditor("Section");
    const shownTools = () =>
      within(screen.getByRole("toolbar", { name: "Formatting" }))
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"));

    await userEvent.click(textBox());
    expect(shownTools()).toEqual(["Bold", "All formatting tools"]);

    await userEvent.click(screen.getByRole("button", { name: "All formatting tools" }));
    await userEvent.click(screen.getByRole("button", { name: "Quote" }));
    await userEvent.click(screen.getByRole("button", { name: "All formatting tools" }));
    expect(shownTools()).toEqual(["Quote", "All formatting tools"]);

    cleanup();
    renderEditor("Other text");
    await userEvent.click(textBox());
    expect(shownTools()).toEqual(["Quote", "All formatting tools"]);
  });

  it("keeps the tool in effect at the caret when folded, else the last one used", async () => {
    localStorage.setItem("konspecter.toolbar.last", "tool.italic");
    renderEditor("Plain **bold** text\n\n## Section\n\n- *leaning* and **heavy** item");
    const shownTools = () =>
      within(screen.getByRole("toolbar", { name: "Formatting" }))
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"));
    const caretIn = async (word: string) => {
      const walker = document.createTreeWalker(textBox(), NodeFilter.SHOW_TEXT);
      while (walker.nextNode() && !walker.currentNode.textContent?.includes(word));
      const text = walker.currentNode;
      document.getSelection()?.collapse(text, (text.textContent ?? "").indexOf(word) + 1);
      await act(async () => {
        document.dispatchEvent(new Event("selectionchange"));
        await Promise.resolve();
      });
    };

    await userEvent.click(textBox());
    await caretIn("Plain");
    expect(shownTools()).toEqual(["Italic", "All formatting tools"]);
    await caretIn("bold");
    expect(shownTools()).toEqual(["Bold", "All formatting tools"]);
    await caretIn("Section");
    expect(shownTools()).toEqual(["Heading", "All formatting tools"]);
    // Italic, the last one used, over the list around it.
    await caretIn("leaning");
    expect(shownTools()).toEqual(["Italic", "All formatting tools"]);
    await caretIn("heavy");
    expect(shownTools()).toEqual(["Bold", "All formatting tools"]);
  });

  it("counts a tool's shortcut as using it", async () => {
    const { save } = renderEditor("");

    await typeInText("{Control>}i{/Control}slanted");
    expect(
      within(screen.getByRole("toolbar", { name: "Formatting" }))
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Italic", "All formatting tools"]);
    expect(save()).toBe("---\ntitle: slanted\n---\n\n*slanted*");
    expect(localStorage.getItem("konspecter.toolbar.last")).toBe("tool.italic");
  });

  it.each([
    ["a bulleted list to a numbered one", "- one\n- two", "Numbered list", "1. one\n2. two"],
    ["a numbered list to a bulleted one", "1. one\n2. two", "Bulleted list", "* one\n* two"],
  ])("changes %s", async (_, markdown, tool, changed) => {
    const { save } = renderEditor(markdown);

    await userEvent.click(textBox());
    await userEvent.click(screen.getByRole("button", { name: "All formatting tools" }));
    await userEvent.click(screen.getByRole("button", { name: tool }));

    expect(save()).toBe(`---\ntitle: one\n---\n\n${changed}`);
  });

  it.each([
    ["bulleted", "- one\n- two", "Bulleted list", "one\n\n* two"],
    ["numbered", "1. one\n2. two", "Numbered list", "one\n\n1. two"],
  ])("takes the item out of a %s list with its own tool", async (_, markdown, tool, lifted) => {
    const { save } = renderEditor(markdown);

    await userEvent.click(textBox());
    await userEvent.click(screen.getByRole("button", { name: "All formatting tools" }));
    expect(screen.getByRole("button", { name: tool })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: tool }));

    expect(screen.getByRole("button", { name: tool })).toHaveAttribute("aria-pressed", "false");
    expect(save()).toBe(`---\ntitle: one\n---\n\n${lifted}`);
  });

  it("toggles headings on the current block", async () => {
    const { save } = renderEditor("Section");

    await userEvent.click(textBox());
    await userEvent.click(screen.getByRole("button", { name: "All formatting tools" }));
    await userEvent.click(screen.getByRole("button", { name: "Heading" }));

    expect(screen.getByRole("button", { name: "Heading" })).toHaveAttribute("aria-pressed", "true");
    expect(save()).toBe("---\ntitle: Section\n---\n\n## Section");
  });
});

describe("notes the text editor cannot represent", () => {
  it.each([
    ["tables", "| a |\n| - |\n| b |", "This conspect uses tables"],
    ["HTML", "Press <kbd>K</kbd>", "This conspect uses HTML"],
  ])("with %s are shown rendered, and edited in Markdown mode", async (_, markdown, notice) => {
    renderEditor(markdown);

    expect(screen.getByRole("status")).toHaveTextContent(notice);
    expect(screen.queryByRole("textbox", { name: "Conspect text" })).not.toBeInTheDocument();
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

  describe("keeps the caret at the same place in the text", () => {
    const note = "---\ntitle: T\n---\n\n# Head\n\nSome **bold** word";
    // In the text editor: the heading's text is 1–5, then the paragraph's from 7.
    const bold = 12;
    const word = 17;

    it("from text to Markdown", async () => {
      renderEditor(note);
      await userEvent.click(textBox());
      const texts = within(textBox()).getByText("bold").firstChild as Text;
      document.getSelection()?.setBaseAndExtent(texts, 1, texts, 3);
      document.dispatchEvent(new Event("selectionchange"));

      await userEvent.click(screen.getByRole("button", { name: "Markdown" }));

      const { anchor, head } = sourceView(sourceBox()).state.selection.main;
      expect(note.slice(anchor, head)).toBe("ol");
      expect(anchor).toBe(note.indexOf("bold") + 1);
    });

    it("from Markdown to text, and back", async () => {
      const { selection } = renderEditor(note, "markdown");
      const view = sourceView(sourceBox());
      view.dispatch({ selection: { anchor: note.indexOf("word"), head: note.indexOf("bold") } });

      await userEvent.click(screen.getByRole("button", { name: "Text" }));
      expect(selection()).toMatchObject({ editor: "text", anchor: word, head: bold });

      await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
      expect(selection()).toMatchObject({
        editor: "markdown",
        anchor: note.indexOf("word"),
        head: note.indexOf("bold"),
      });
    });

    it("from the frontmatter to the start of the body", async () => {
      const { selection } = renderEditor(note, "markdown");
      sourceView(sourceBox()).dispatch({ selection: { anchor: 5 } });

      await userEvent.click(screen.getByRole("button", { name: "Text" }));
      expect(selection()).toMatchObject({ editor: "text", anchor: 1, head: 1 });
    });
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

  it("keeps the frontmatter being typed as it is when a save brings new dates", async () => {
    const initial = "---\nupdated: 2026-09-28T10:00:00Z\n---\n\n# N";
    const onChange = vi.fn();
    const { rerender } = render(
      <NoteEditor initialMarkdown={initial} mode="markdown" onChange={onChange} />,
    );
    const source = await screen.findByRole("textbox", { name: "Markdown" });
    const typed = "---\ntitle: Hash \n\ntags:\n- a\nupdated: 2026-09-28T10:00:00Z\n---\n\n# N";
    setSourceValue(source, typed);
    const view = sourceView(source);
    const caret = typed.indexOf("Hash ") + "Hash ".length;
    view.dispatch({ selection: { anchor: caret } });

    const saved = { id: "n1", markdown: typed.replace("2026-09-28T10:00", "2026-09-29T08:00") };
    rerender(
      <NoteEditor initialMarkdown={initial} mode="markdown" onChange={onChange} saved={saved} />,
    );

    expect(sourceValue(source)).toBe(saved.markdown);
    expect(view.state.selection.main.head).toBe(caret);
    view.dispatch(view.state.replaceSelection("maps"));
    expect(sourceValue(source)).toContain("title: Hash maps\n");
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

  it("uploads a cover image into the frontmatter and shows it by size", async () => {
    vi.mocked(coverDataUrl).mockResolvedValue("data:image/webp;base64,AQID");
    const { save } = renderEditor("Body", "text", true);

    const image = new File(["img"], "c.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Upload…"), image);

    expect(coverDataUrl).toHaveBeenCalledWith(image);
    expect(save()).toBe("---\ncover: data:image/webp;base64,AQID\n---\n\nBody");
    expect(screen.getByText("Uploaded image, 1 kB")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Cover image" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace…" })).toBeInTheDocument();
  });

  it("removes an uploaded cover, leaving the field for a URL", async () => {
    const { save } = renderEditor("---\ncover: data:image/png;base64,AQID\n---\n\nBody", "text");

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(save()).toBe("---\n---\n\nBody");
    expect(coverField()).toHaveValue("");
  });

  it("explains an image it cannot use and keeps the cover", async () => {
    vi.mocked(coverDataUrl).mockRejectedValue(new CoverImageError("broken"));
    renderEditor("---\ncover: https://example.com/c.png\n---\n\nBody", "text");

    await userEvent.upload(
      screen.getByLabelText("Upload…"),
      new File(["x"], "c.png", { type: "image/png" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be used as a cover");
    expect(coverField()).toHaveValue("https://example.com/c.png");
  });

  it("follows the body's first line as it is typed", async () => {
    renderEditor("", "text", true);

    await typeInText("# Fresh title");

    expect(titleField()).toHaveAttribute("placeholder", "Fresh title");
  });

  it("writes the author into the frontmatter", async () => {
    const { save } = renderEditor("---\ntitle: T\n---\n\nBody", "text", true);

    await userEvent.type(screen.getByRole("textbox", { name: "Author" }), "Ann");

    expect(save()).toBe("---\ntitle: T\nauthor: Ann\n---\n\nBody");
  });

  it("reflects frontmatter edited in Markdown mode", async () => {
    renderEditor("Body", "text", true);

    await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
    setSourceValue(sourceBox(), "---\ntitle: Typed in source\n---\n\nBody");
    await userEvent.click(screen.getByRole("button", { name: "Text" }));

    expect(titleField()).toHaveValue("Typed in source");
  });

  it("reflects the author edited in Markdown mode, and has no tags field", async () => {
    renderEditor("Body", "text", true);

    await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
    setSourceValue(sourceBox(), "---\nauthor: Bob\ntags: [rust]\n---\n\nBody");
    await userEvent.click(screen.getByRole("button", { name: "Text" }));

    expect(screen.getByRole("textbox", { name: "Author" })).toHaveValue("Bob");
    expect(screen.queryByRole("textbox", { name: "Tags" })).not.toBeInTheDocument();
  });
});

describe("frontmatter following the text editor", () => {
  it("writes a title and tags typed in the body into the frontmatter, shown in Markdown mode", async () => {
    const { save } = renderEditor("");

    await typeInText("# Maps{Enter}Hash maps #java#collections");

    const written =
      "---\ntitle: Maps\ntags:\n  - java#collections\n---\n\n# Maps\n\nHash maps #java#collections";
    expect(save()).toBe(written);
    await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
    expect(sourceValue(sourceBox())).toBe(written);
  });

  it("keeps the title following the heading, and a title set to something else", async () => {
    const { save } = renderEditor("---\ntitle: Own\n---\n\n# Old", "text");

    await typeAtEnd("er");

    expect(save()).toBe("---\ntitle: Own\n---\n\n# Older");
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Own");
  });

  it("adds a tag typed in the body next to the ones only listed in the frontmatter", async () => {
    const { save } = renderEditor("---\ntitle: T\ntags: [extra, go]\n---\n\nT #go");

    await typeAtEnd(" #rust");

    expect(save()).toBe("---\ntitle: T\ntags: [extra, go, rust]\n---\n\nT #go #rust");
  });

  it("does not repeat the heading as a field, nor list the tags", () => {
    renderEditor("---\ntitle: Maps\ntags: [java, extra]\n---\n\n# Maps\n\n#java");

    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    expect(screen.queryByText("#extra")).not.toBeInTheDocument();
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

describe("paired characters in the Markdown editor", () => {
  const selected = (element: HTMLElement) => {
    const { from, to } = sourceView(element).state.selection.main;
    return sourceValue(element).slice(from, to);
  };

  it("wraps the selection instead of replacing it, keeping it selected", () => {
    renderEditor("a word here", "markdown");
    const box = sourceBox();

    expect(typeSubstituted(box, [2, 6], "*", "*")).toBe(true);
    expect(typeSubstituted(box, [3, 7], "*", "*")).toBe(true);
    expect(sourceValue(box)).toBe("a **word** here");
    expect(selected(box)).toBe("word");
    expect(typeSubstituted(box, [4, 8], "(", "(")).toBe(true);
    expect(sourceValue(box)).toBe("a **(word)** here");
  });

  it.each([
    ["_", "_", "_x_"],
    ["[", "[", "[x]"],
    ["`", "`", "`x`"],
    ["~", "~", "~x~"],
    ['"', "“", "“x”"],
    ['"', "«", "«x»"],
  ])("wraps with %s (the system typing %s)", (key, inserted, wrapped) => {
    renderEditor("x", "markdown");
    const box = sourceBox();

    expect(typeSubstituted(box, [0, 1], key, inserted)).toBe(true);
    expect(sourceValue(box)).toBe(wrapped);
  });

  it("wraps in straight quotes in code", () => {
    renderEditor("`x`", "markdown");
    const box = sourceBox();

    expect(typeSubstituted(box, [1, 2], '"', "«")).toBe(true);
    expect(sourceValue(box)).toBe('`"x"`');
  });

  it("types a single character where nothing is selected, and replaces with others", () => {
    renderEditor("x", "markdown");
    const box = sourceBox();

    expect(typeSubstituted(box, 1, "(", "(")).toBe(false);
    expect(typeSubstituted(box, [0, 1], "a", "a")).toBe(false);
  });
});

describe("a version from elsewhere", () => {
  // Changed before the caret (the date, the heading) and after it.
  const first =
    "---\nupdated: 2026-09-29T10:00:00Z\n---\n# Java\n\nfirst paragraph\n\nsecond paragraph";
  const next = {
    id: "n1",
    markdown:
      "---\nupdated: 2026-09-29T10:05:00Z\n---\n# Java, edited\n\nfirst paragraph\n\nsecond paragraph, changed elsewhere",
  };

  it("replaces the Markdown source in place: same editor, same caret, no edit reported", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <NoteEditor initialMarkdown={first} mode="markdown" onChange={onChange} />,
    );
    const source = await screen.findByRole("textbox", { name: "Markdown" });
    const view = sourceView(source);
    const caret = first.indexOf("first paragraph") + "first".length;
    view.dispatch({ selection: { anchor: caret } });

    rerender(
      <NoteEditor initialMarkdown={first} mode="markdown" onChange={onChange} replacement={next} />,
    );

    expect(screen.getByRole("textbox", { name: "Markdown" })).toBe(source);
    expect(sourceValue(source)).toBe(next.markdown);
    // Still after "first", though text before it changed.
    expect(view.state.selection.main.head).toBe(
      next.markdown.indexOf("first paragraph") + "first".length,
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(undo(view)).toBe(false); // Undo does not take the other version back.
  });

  it("replaces the rich text in place: same editor, same caret, no edit reported", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <NoteEditor initialMarkdown={first} mode="text" onChange={onChange} />,
    );
    const box = await screen.findByRole("textbox", { name: "Conspect text" });
    await userEvent.click(box);
    const text = within(box).getByText("first paragraph").firstChild;
    if (!(text instanceof Text)) throw new Error("no text node");
    document.getSelection()?.collapse(text, "first".length);
    document.dispatchEvent(new Event("selectionchange"));

    rerender(
      <NoteEditor initialMarkdown={first} mode="text" onChange={onChange} replacement={next} />,
    );

    expect(screen.getByRole("textbox", { name: "Conspect text" })).toBe(box);
    expect(box).toHaveTextContent("Java, edited");
    expect(box).toHaveTextContent("second paragraph, changed elsewhere");
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.keyboard("X");
    expect(within(box).getByText("firstX paragraph")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
  });

  it("keeps the Markdown editor for any version, even one with broken frontmatter", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <NoteEditor initialMarkdown={first} mode="markdown" onChange={onChange} />,
    );
    const source = await screen.findByRole("textbox", { name: "Markdown" });

    rerender(
      <NoteEditor
        initialMarkdown={first}
        mode="markdown"
        onChange={onChange}
        replacement={{ id: "n1", markdown: "---\ntitle: [\n---\nbroken" }}
      />,
    );

    // Markdown mode shows any text: still the same editor, now with the broken frontmatter.
    expect(screen.getByRole("textbox", { name: "Markdown" })).toBe(source);
    expect(sourceValue(source)).toBe("---\ntitle: [\n---\nbroken");
  });

  it("opens a version the rich text cannot hold in the view that can", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <NoteEditor initialMarkdown={first} mode="text" onChange={onChange} />,
    );
    await screen.findByRole("textbox", { name: "Conspect text" });

    rerender(
      <NoteEditor
        initialMarkdown={first}
        mode="text"
        onChange={onChange}
        replacement={{ id: "n1", markdown: "---\ntitle: [\n---\nbroken" }}
      />,
    );

    const source = await screen.findByRole("textbox", { name: "Markdown" });
    expect(sourceValue(source)).toBe("---\ntitle: [\n---\nbroken");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("an edit from outside the editor", () => {
  const markdown = "---\ntags: [extra, go]\n---\n\nBody #go";
  const edit = { apply: (text: string) => text.replace("[extra, go]", "[go]") };

  it("applies to the Markdown source in place and is reported as an edit", async () => {
    const onChange = vi.fn<(read: () => string) => void>();
    const { rerender } = render(
      <NoteEditor initialMarkdown={markdown} mode="markdown" onChange={onChange} />,
    );
    const source = await screen.findByRole("textbox", { name: "Markdown" });

    rerender(
      <NoteEditor initialMarkdown={markdown} mode="markdown" onChange={onChange} edit={edit} />,
    );

    expect(screen.getByRole("textbox", { name: "Markdown" })).toBe(source);
    expect(sourceValue(source)).toBe("---\ntags: [go]\n---\n\nBody #go");
    expect(onChange.mock.lastCall?.[0]()).toBe("---\ntags: [go]\n---\n\nBody #go");
  });

  it("applies to the frontmatter in text mode, keeping the rich text and its edits", async () => {
    const onChange = vi.fn<(read: () => string) => void>();
    const { rerender } = render(
      <NoteEditor initialMarkdown={markdown} mode="text" onChange={onChange} />,
    );
    await typeAtEnd(" more");

    rerender(<NoteEditor initialMarkdown={markdown} mode="text" onChange={onChange} edit={edit} />);

    expect(onChange.mock.lastCall?.[0]()).toBe(
      '---\ntags: [go]\ntitle: "Body #go more"\n---\n\nBody #go more',
    );
    // The same edit object again changes nothing more.
    const calls = onChange.mock.calls.length;
    rerender(<NoteEditor initialMarkdown={markdown} mode="text" onChange={onChange} edit={edit} />);
    expect(onChange.mock.calls.length).toBe(calls);
  });
});
