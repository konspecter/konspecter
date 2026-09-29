import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ReadingPositionMode } from "../../domain/reading/reading";
import type { EditorMode } from "../../domain/settings/settings";
import { sourceView } from "../editors/test-helpers";
import { createNote } from "../../domain/note/note";
import { openNoteStore, type NoteStore } from "../../infrastructure/storage/note-store";
import { Activity } from "../app/activity";
import { NotePage } from "./NotePage";

let databaseCount = 0;
async function storeWithNote() {
  databaseCount += 1;
  const store = await openNoteStore(`reading-test-${String(databaseCount)}`);
  await store.put(createNote("# Long read\n\nBody text.", new Date("2020-01-01T00:00:00Z"), "n"));
  return store;
}

function renderNote(store: NoteStore, mode: ReadingPositionMode, editor: EditorMode = "text") {
  return render(
    <MemoryRouter initialEntries={["/notes/n"]}>
      <Routes>
        <Route
          path="notes/:id"
          element={
            <NotePage
              store={store}
              mode={editor}
              activity={new Activity()}
              readingPosition={mode}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
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
