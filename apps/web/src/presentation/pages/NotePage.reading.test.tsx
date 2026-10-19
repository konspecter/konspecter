import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import type { ReadingPositionMode } from "../../domain/reading/reading";
import type { EditorMode } from "../../domain/settings/settings";
import { sourceView } from "../editors/test-helpers";
import { createNote } from "../../domain/note/note";
import { openNoteStore, type NoteStore } from "../../infrastructure/storage/note-store";
import { NoteCatalog } from "../../application/notes/note-catalog";
import { Activity } from "../app/activity";
import { NotePage } from "./NotePage";

let databaseCount = 0;
async function storeWithNote() {
  databaseCount += 1;
  const store = await openNoteStore(`reading-test-${String(databaseCount)}`);
  await store.put(createNote("# Long read\n\nBody text.", new Date("2020-01-01T00:00:00Z"), "n"));
  return store;
}

function notePage(
  store: NoteStore,
  mode: ReadingPositionMode,
  editor: EditorMode = "text",
  path = "/conspects/n",
) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Link to="/conspects/n#heading-3">Part two again</Link>
      <Routes>
        <Route
          path="conspects/:id"
          element={
            <NotePage
              store={store}
              catalog={new NoteCatalog(store)}
              mode={editor}
              activity={new Activity()}
              readingPosition={mode}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function renderNote(store: NoteStore, mode: ReadingPositionMode, editor: EditorMode = "text") {
  return render(notePage(store, mode, editor));
}

// jsdom has no layout: give the page a height and a viewport.
function layout(scrollHeight: number, viewport: number) {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: viewport });
}

function scrollPageTo(top: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: top });
  window.dispatchEvent(new Event("scroll"));
}

let scrollTo: ReturnType<typeof vi.fn>;
beforeEach(() => {
  layout(3000, 1000);
  scrollTo = vi.fn();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
});

async function bodyRendered() {
  expect(await screen.findByText("Body text.")).toBeInTheDocument();
}

describe("reading position", () => {
  it("saves the position while scrolling and restores it when the note is reopened", async () => {
    const store = await storeWithNote();
    const first = renderNote(store, "restore");
    await bodyRendered();

    scrollPageTo(1000);
    await waitFor(async () => {
      expect((await store.readingState("n"))?.position).toBe(0.5);
    });
    first.unmount();

    renderNote(store, "restore");
    await bodyRendered();
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 1000 });
    });
  });

  it("saves a pending position when the page is left", async () => {
    const store = await storeWithNote();
    const view = renderNote(store, "restore");
    await bodyRendered();

    scrollPageTo(2000);
    view.unmount();

    await waitFor(async () => {
      expect((await store.readingState("n"))?.position).toBe(1);
    });
  });

  it("offers to continue instead of jumping in ask mode", async () => {
    const store = await storeWithNote();
    await store.saveReadingPosition("n", 0.42);
    renderNote(store, "ask");
    await bodyRendered();

    const offer = await screen.findByRole("status");
    expect(offer).toHaveTextContent("You were 42% through this conspect.");
    expect(scrollTo).not.toHaveBeenCalled();

    await userEvent.click(within(offer).getByRole("button", { name: "Continue reading" }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 840 });
    expect(screen.queryByText(/You were/)).not.toBeInTheDocument();
  });

  it("neither saves nor restores when turned off", async () => {
    const store = await storeWithNote();
    await store.saveReadingPosition("n", 0.3);
    const view = renderNote(store, "off");
    await bodyRendered();

    scrollPageTo(2000);
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(scrollTo).not.toHaveBeenCalled();
    expect((await store.readingState("n"))?.position).toBe(0.3);
  });

  it("does not touch the note's Markdown", async () => {
    const store = await storeWithNote();
    const before = await store.get("n");
    await store.saveReadingPosition("n", 0.7);

    expect(await store.get("n")).toEqual(before);
  });
});

describe("the caret", () => {
  const source = () => screen.findByRole("textbox", { name: "Markdown" });
  const textBox = () => screen.findByRole("textbox", { name: "Conspect text" });

  it("comes back where it was in Markdown, with the focus", async () => {
    const store = await storeWithNote();
    const first = renderNote(store, "restore", "markdown");
    const view = sourceView(await source());
    view.focus();
    view.dispatch({ selection: { anchor: 10 } });
    await waitFor(async () => {
      expect((await store.readingState("n"))?.selection).toEqual({
        editor: "markdown",
        anchor: 10,
        head: 10,
        focused: true,
      });
    });
    first.unmount();

    renderNote(store, "restore", "markdown");
    const reopened = await source();
    expect(sourceView(reopened).state.selection.main.head).toBe(10);
    await waitFor(() => {
      expect(reopened).toHaveFocus();
    });
  });

  it("comes back where it was in the text editor: typing goes on there", async () => {
    const store = await storeWithNote();
    const first = renderNote(store, "restore");
    const box = await textBox();
    await userEvent.click(box);
    const text = within(box).getByText("Body text.").firstChild;
    if (!(text instanceof Text)) throw new Error("no text node");
    document.getSelection()?.collapse(text, "Body".length);
    document.dispatchEvent(new Event("selectionchange"));
    await waitFor(async () => {
      expect((await store.readingState("n"))?.selection).toMatchObject({
        editor: "text",
        focused: true,
      });
    });
    first.unmount();

    renderNote(store, "restore");
    const reopened = await textBox();
    await waitFor(() => {
      expect(reopened).toHaveFocus();
    });
    await userEvent.keyboard("X");
    expect(within(reopened).getByText("BodyX text.")).toBeInTheDocument();
  });

  it("stays where it was saved: not in the other editor, not in ask mode", async () => {
    const store = await storeWithNote();
    await store.saveEditorSelection("n", { editor: "markdown", anchor: 5, head: 5, focused: true });

    const inText = renderNote(store, "restore");
    expect(await textBox()).not.toHaveFocus();
    inText.unmount();

    renderNote(store, "ask", "markdown");
    const opened = await source();
    expect(opened).not.toHaveFocus();
    expect(sourceView(opened).state.selection.main.head).toBe(0);
  });

  it("keeps the scroll position when the caret is saved, and the other way round", async () => {
    const store = await storeWithNote();
    await store.saveReadingPosition("n", 0.5);
    await store.saveEditorSelection("n", { editor: "text", anchor: 3, head: 3, focused: false });
    await store.saveReadingPosition("n", 0.25);

    expect(await store.readingState("n")).toMatchObject({
      position: 0.25,
      selection: { editor: "text", anchor: 3 },
    });
  });
});

describe("a heading followed in the tree", () => {
  const OUTLINED = "# Long read\n\nBody text.\n\n## Part one\n\nOne.\n\n## Part two\n\nTwo.";

  async function storeWith(markdown: string) {
    const store = await storeWithNote();
    await store.put(createNote(markdown, new Date("2020-01-01T00:00:00Z"), "n"));
    await store.saveReadingPosition("n", 0.5);
    return store;
  }

  // jsdom has no layout: the heading named `text` is `top` pixels down the window.
  function headingAt(text: string, top: number) {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const y = /^H[1-3]$/.test(this.tagName) && this.textContent === text ? top : 0;
      return {
        x: 0,
        y,
        top: y,
        bottom: y + 20,
        left: 0,
        right: 0,
        width: 0,
        height: 20,
      } as DOMRect;
    });
  }

  beforeEach(() => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Scrolled so the heading stands just under the top of the window (no top bar here). */
  const AT_PART_TWO = { top: 600 - 12 };

  it("opens the note scrolled to it, not where it was last read", async () => {
    headingAt("Part two", 600);
    render(notePage(await storeWith(OUTLINED), "restore", "text", "/conspects/n#heading-3"));
    expect(await screen.findByText("Two.")).toBeInTheDocument();

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(AT_PART_TWO);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 1000 });
  });

  it("scrolls the rendered view to it", async () => {
    headingAt("Part two", 600);
    const markdown = "# Long read\n\n| a |\n| - |\n| b |\n\n## Part two\n\nTwo.";
    render(notePage(await storeWith(markdown), "restore", "text", "/conspects/n#heading-2"));
    expect(await screen.findByText("Two.")).toBeInTheDocument();

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(AT_PART_TWO);
    });
  });

  it("scrolls again each time it is followed, but not when the mode changes", async () => {
    headingAt("Part two", 600);
    const store = await storeWith(OUTLINED);
    const view = render(notePage(store, "off", "text", "/conspects/n#heading-3"));
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(AT_PART_TWO);
    });
    scrollTo.mockClear();

    view.rerender(notePage(store, "off", "markdown", "/conspects/n#heading-3"));
    await screen.findByRole("textbox", { name: "Markdown" });
    view.rerender(notePage(store, "off", "text", "/conspects/n#heading-3"));
    expect(await screen.findByText("Two.")).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("link", { name: "Part two again" }));
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(AT_PART_TWO);
    });
  });
});
