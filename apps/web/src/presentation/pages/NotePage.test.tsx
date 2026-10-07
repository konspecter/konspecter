import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { parseDocument } from "../../domain/document/document";
import { createNote } from "../../domain/note/note";
import type { EditorMode } from "../../domain/settings/settings";
import { openNoteStore, type NoteStore } from "../../infrastructure/storage/note-store";
import { Activity } from "../app/activity";
import { DetailsSlot } from "../components/details-slot";
import { NotePage } from "./NotePage";

// Simulates the renderer chunk failing to download, e.g. when offline.
vi.mock("../markdown/MarkdownView", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

let databaseCount = 0;
async function newStore() {
  databaseCount += 1;
  return openNoteStore(`note-page-test-${String(databaseCount)}`);
}

function Where() {
  const location = useLocation();
  return <output aria-label="Location">{location.pathname}</output>;
}

/** A place for the page's details, as the sidebar provides in the app. */
function WithDetails({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <DetailsSlot value={slot}>
      {children}
      <div ref={setSlot} />
    </DetailsSlot>
  );
}

/** Both routes render one element, as in App, so a saved new note keeps its editor. */
function renderNotePage(
  store: NoteStore,
  path: string,
  activity = new Activity(),
  mode: EditorMode = "text",
) {
  const page = <NotePage store={store} mode={mode} activity={activity} />;
  render(
    <MemoryRouter initialEntries={[path]}>
      <WithDetails>
        <Routes>
          <Route path="conspects/new" element={page} />
          <Route path="conspects/:id" element={page} />
        </Routes>
      </WithDetails>
      <Where />
    </MemoryRouter>,
  );
}

/** A note as the server has it (revision 1), with nothing waiting to be pushed. */
async function synced(store: NoteStore, id: string, markdown: string) {
  await store.applyRemote({ id, markdown, revision: 1, deleted: false });
}

const textBox = () => screen.findByRole("textbox", { name: "Conspect text" });
const location = () => screen.getByRole("status", { name: "Location" });

/** Puts the caret after the last character (user-event cannot press End in contenteditable). */
function caretAtEnd(box: HTMLElement) {
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  while (walker.nextNode()) last = walker.currentNode as Text;
  if (last) document.getSelection()?.collapse(last, last.length);
  document.dispatchEvent(new Event("selectionchange"));
}

describe("a new note", () => {
  it("opens focused, and is stored by typing alone, without a remount", async () => {
    const store = await newStore();
    renderNotePage(store, "/conspects/new");

    const box = await textBox();
    expect(box).toHaveFocus();
    await userEvent.keyboard("# Autosaved{Enter}Body");

    await waitFor(async () => {
      expect(await store.list()).toHaveLength(1);
    });
    const [note] = await store.list();
    await waitFor(() => {
      expect(location()).toHaveTextContent(`/conspects/${note?.id ?? ""}`);
    });
    expect(parseDocument(note?.markdown ?? "").body).toBe("# Autosaved\n\nBody");
    // The same editor, still focused: typing simply continues.
    expect(await textBox()).toBe(box);
    expect(box).toHaveFocus();
    await userEvent.keyboard(" text");
    await waitFor(async () => {
      expect((await store.get(note?.id ?? ""))?.markdown).toContain("Body text");
    });
    expect(await store.list()).toHaveLength(1);
  });

  it("stores nothing while it is blank", async () => {
    const store = await newStore();
    renderNotePage(store, "/conspects/new");

    await textBox();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await store.list()).toEqual([]);
  });
});

describe("an existing note", () => {
  it("saves edits as they happen and keeps the caret where it is", async () => {
    const store = await newStore();
    await store.put(createNote("# Java\n\nBody", new Date("2020-01-01T00:00:00Z"), "java"));
    const activity = new Activity({ linger: 0 });
    renderNotePage(store, "/conspects/java", activity);

    const box = await textBox();
    await userEvent.click(box);
    caretAtEnd(box);
    await userEvent.keyboard(" text");
    expect(activity.getSnapshot()).toBe(true);

    await waitFor(async () => {
      expect((await store.get("java"))?.markdown).toContain("Body text");
    });
    await userEvent.keyboard(" more");
    expect(await textBox()).toBe(box);
    expect(box).toHaveTextContent("Body text more");
    await waitFor(async () => {
      expect((await store.get("java"))?.markdown).toContain("Body text more");
    });
    await waitFor(() => {
      expect(activity.getSnapshot()).toBe(false);
    });
  });

  it("saves at once with Ctrl+S", async () => {
    const store = await newStore();
    await store.put(createNote("# Java", new Date("2020-01-01T00:00:00Z"), "java"));
    renderNotePage(store, "/conspects/java");

    const box = await textBox();
    await userEvent.click(box);
    caretAtEnd(box);
    await userEvent.keyboard("!{Control>}s{/Control}");

    await waitFor(async () => {
      expect((await store.get("java"))?.markdown).toContain("# Java!");
    });
  });

  it("shows a version changed elsewhere when nothing is unsaved", async () => {
    const store = await newStore();
    await synced(store, "java", "# Java\n\nold");
    renderNotePage(store, "/conspects/java");
    const box = await textBox();
    const put = vi.spyOn(store, "put");

    await store.applyRemote({
      id: "java",
      revision: 2,
      markdown: "# Java\n\nfrom the server",
      deleted: false,
    });

    expect(await screen.findByText("from the server")).toBeInTheDocument();
    // In place: the same editor (no reload, no blink), and nothing to save back.
    expect(await textBox()).toBe(box);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(put).not.toHaveBeenCalled();
  });

  it("keeps an edit that crossed a change from elsewhere: the later edit wins", async () => {
    const store = await newStore();
    await synced(store, "shared", "# Shared\n\nold");
    renderNotePage(store, "/conspects/shared");

    const box = await textBox();
    await userEvent.click(box);
    caretAtEnd(box);
    await userEvent.keyboard(" mine");
    await store.applyRemote({
      id: "shared",
      revision: 2,
      markdown: "# Shared\n\ntheirs",
      deleted: false,
    });

    await waitFor(async () => {
      expect((await store.get("shared"))?.markdown).toContain("old mine");
    });
    expect(await store.list()).toHaveLength(1);
    expect(location()).toHaveTextContent("/conspects/shared");
    expect(await textBox()).toHaveTextContent("old mine");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("says when the open note was deleted elsewhere, and brings it back when edited", async () => {
    const store = await newStore();
    await synced(store, "gone", "# Gone\n\ntext");
    renderNotePage(store, "/conspects/gone");
    const box = await textBox();

    await store.applyRemote({ id: "gone", revision: 2, markdown: "", deleted: true });
    expect(await screen.findByRole("note")).toHaveTextContent(
      "This conspect was deleted elsewhere. Editing it brings it back.",
    );

    await userEvent.click(box);
    caretAtEnd(box);
    await userEvent.keyboard(" again");
    await waitFor(async () => {
      expect((await store.get("gone"))?.markdown).toContain("text again");
    });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("explains invalid frontmatter instead of saving it", async () => {
    const store = await newStore();
    await store.put({ id: "broken", markdown: "---\ntitle: [\n---\n\nStill here." });
    render(
      <MemoryRouter initialEntries={["/conspects/broken"]}>
        <Routes>
          <Route
            path="conspects/:id"
            element={<NotePage store={store} mode="markdown" activity={new Activity()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const source = await screen.findByRole("textbox", { name: "Markdown" });
    await userEvent.click(source);
    await userEvent.keyboard("{Control>}{End}{/Control} more");

    expect(await screen.findByRole("alert", {}, { timeout: 2000 })).toHaveTextContent(
      "Not saved: Frontmatter",
    );
    expect((await store.get("broken"))?.markdown).toBe("---\ntitle: [\n---\n\nStill here.");
  });

  it("removes a tag only the frontmatter lists from the Details, in either editor", async () => {
    for (const mode of ["text", "markdown"] as const) {
      const store = await newStore();
      await store.put(createNote("---\ntags: [extra, go]\n---\n\n# N #go", new Date(), "n"));
      renderNotePage(store, "/conspects/n", new Activity(), mode);
      const details = await screen.findByRole("region", { name: "Details" });

      // #go is written in the text: it is removed there.
      expect(within(details).queryByRole("button", { name: "Remove #go" })).toBeNull();
      await userEvent.click(within(details).getByRole("button", { name: "Remove #extra" }));

      await waitFor(async () => {
        expect((await store.get("n"))?.markdown).toContain("tags: [go]\n");
      });
      expect(within(details).queryByRole("link", { name: "#extra" })).toBeNull();
      if (mode === "markdown") {
        const source = screen.getByRole("textbox", { name: "Markdown" });
        expect(source).toHaveTextContent("tags: [go]");
      }
      cleanup();
    }
  });

  it("shows not found for an unknown note", async () => {
    const store = await newStore();
    renderNotePage(store, "/conspects/nowhere");

    expect(await screen.findByRole("heading", { name: "Conspect not found" })).toBeInTheDocument();
  });
});

it("shows an error instead of crashing when the renderer cannot be loaded", async () => {
  const store = await newStore();
  await store.put(createNote("# Table\n\n| a |\n| - |\n| b |", new Date(), "table"));
  renderNotePage(store, "/conspects/table");

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the conspect reader");
  expect(screen.getByRole("heading", { level: 1, name: "Table" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
});
