import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openDB } from "idb";
import { MemoryRouter } from "react-router";
import { parseDocument } from "../../domain/document/document";
import { parseQuery } from "../../domain/search/query";
import { DEFAULT_SETTINGS, type Settings } from "../../domain/settings/settings";
import { DEFAULT_IGNORE } from "../../domain/note/ignore";
import { createNote, type Note } from "../../domain/note/note";
import { openNoteStore, type NoteStore } from "../../infrastructure/storage/note-store";
import { setSourceValue, sourceValue } from "../editors/test-helpers";
import { FakeFolder } from "../../infrastructure/folder/fake-folder";
import { FolderStore } from "../../infrastructure/folder/folder-store";
import { FakeServer, TEST_PASSPHRASE } from "../../infrastructure/sync/fake-server";
import { SyncEngine } from "../../infrastructure/sync/sync-engine";
import type { NoteRepository } from "../../application/notes/note-repository";
import { applyLanguage } from "../i18n/setup";
import { App } from "./App";

let databaseCount = 0;
async function newStore() {
  databaseCount += 1;
  return openNoteStore(`app-test-${String(databaseCount)}`);
}

function renderApp(store: NoteRepository, path = "/", settings?: Settings) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App store={store} {...(settings ? { initialSettings: settings } : {})} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

/** The rich-text editor (the default mode). It is loaded lazily. */
const textEditor = () => screen.findByRole("textbox", { name: "Conspect text" });

/** Switches to Markdown mode (the top bar's toggle) and returns the source text box. */
async function markdownEditor() {
  await userEvent.click(topBarButton("Markdown"));
  return screen.findByRole("textbox", { name: "Markdown" });
}

const sidebar = () => screen.getByRole("complementary", { name: "Sidebar" });
const topBar = () => screen.getByRole("banner");
const topBarButton = (name: string) => within(topBar()).getByRole("button", { name });
const searchBox = () => screen.getByRole("searchbox", { name: "Search conspects" });
/** The same box on the note page, where it searches the note. */
const findBox = () => screen.getByRole("searchbox", { name: "Search in this conspect" });
const noteList = () => screen.findByRole("list", { name: "Conspects" });
const recentNav = () => within(sidebar()).getByRole("navigation", { name: "Recent" });
const recentTitles = () =>
  within(recentNav())
    .queryAllByRole("link")
    .map((link) => link.textContent);
const antenna = () => screen.getByRole("img", { name: /stored on this device|Saving/ });

/** Titles in the main list, in order. */
async function listTitles() {
  const list = await noteList();
  return [...list.querySelectorAll(".note-result-title")].map((title) => title.textContent);
}

/** Puts the caret after the last character (user-event cannot press End in contenteditable). */
function caretAtEnd(box: HTMLElement) {
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  while (walker.nextNode()) last = walker.currentNode as Text;
  if (last) document.getSelection()?.collapse(last, last.length);
  document.dispatchEvent(new Event("selectionchange"));
}

async function stored(store: NoteRepository, id: string, check: (markdown: string) => boolean) {
  await waitFor(
    async () => {
      expect(check((await store.get(id))?.markdown ?? "")).toBe(true);
    },
    { timeout: 3000 },
  );
}

const javaNote = createNote(
  "# Java Collections\n\nArrayList — dynamic array.",
  new Date("2020-09-28T10:15:00.000Z"),
  "java",
);
const emptyNote = createNote("", new Date("2020-09-27T08:00:00.000Z"), "empty");
const brokenNote: Note = { id: "broken", markdown: "---\ntitle: [\n---\n\nStill here." };

describe("layout", () => {
  it("is two panels, without an app header, menu or loading text", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store);

    expect(sidebar()).toBeInTheDocument();
    expect(within(topBar()).getByRole("search")).toBeInTheDocument();
    expect(topBarButton("Dark theme")).toBeInTheDocument();
    expect(topBarButton("Markdown")).toHaveAttribute("aria-pressed", "false");
    expect(antenna()).toHaveAccessibleName("Everything is stored on this device");
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    expect(screen.queryByText("Konspecter")).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(await listTitles()).toEqual(["Java Collections"]);
  });

  it("goes back and forward from the search box", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store);
    const search = () => within(topBar()).getByRole("search");
    const back = () => within(search()).getByRole("button", { name: "Back" });
    const forward = () => within(search()).getByRole("button", { name: "Forward" });
    expect(back()).toBeDisabled();
    expect(forward()).toBeDisabled();

    await userEvent.click(within(await noteList()).getByRole("link", { name: /Java Collections/ }));
    await textEditor();
    expect(back()).toBeEnabled();
    expect(forward()).toBeDisabled();

    await userEvent.click(back());
    expect(await listTitles()).toEqual(["Java Collections"]);
    expect(back()).toBeDisabled();
    expect(forward()).toBeEnabled();

    await userEvent.click(forward());
    await textEditor();
    expect(forward()).toBeDisabled();
  });

  it("goes back and forward with Mod+← and Mod+→, but not while typing", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store);
    await userEvent.click(within(await noteList()).getByRole("link", { name: /Java Collections/ }));
    const editor = await textEditor();

    // In the text, the keys are the editor's (to the line's start).
    await userEvent.click(editor);
    await userEvent.keyboard("{Control>}{ArrowLeft}{/Control}");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("textbox", { name: "Conspect text" })).toBeInTheDocument();

    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await userEvent.keyboard("{Control>}{ArrowLeft}{/Control}");
    expect(await listTitles()).toEqual(["Java Collections"]);
    // Nowhere further back within the app: the list stays.
    await userEvent.keyboard("{Control>}{ArrowLeft}{/Control}");
    expect(await listTitles()).toEqual(["Java Collections"]);

    await userEvent.keyboard("{Control>}{ArrowRight}{/Control}");
    await textEditor();
    expect(within(topBar()).getByRole("button", { name: "Back" })).toHaveAttribute(
      "title",
      "Back (Ctrl+←)",
    );
  });

  it("hides and shows the sidebar with a sideways swipe", async () => {
    renderApp(await newStore());
    const swipe = (fromX: number, toX: number) => {
      fireEvent.touchStart(document.body, { touches: [{ clientX: fromX, clientY: 300 }] });
      fireEvent.touchEnd(document.body, {
        touches: [],
        changedTouches: [{ clientX: toX, clientY: 310 }],
      });
    };

    swipe(300, 100);
    expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
    swipe(100, 300);
    expect(sidebar()).toBeInTheDocument();
  });

  it("hides and shows the sidebar, and remembers the choice", async () => {
    renderApp(await newStore());

    await userEvent.click(within(sidebar()).getByRole("button", { name: "Hide sidebar" }));
    expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
    expect(localStorage.getItem("konspecter.sidebar")).toBe("closed");
    // Its controls move to the top bar meanwhile.
    expect(within(topBar()).getByRole("link", { name: "New conspect" })).toBeInTheDocument();

    await userEvent.click(topBarButton("Show sidebar"));
    expect(sidebar()).toBeInTheDocument();
    expect(localStorage.getItem("konspecter.sidebar")).toBe("open");
  });

  it("starts with the sidebar hidden when it was hidden before", async () => {
    localStorage.setItem("konspecter.sidebar", "closed");
    renderApp(await newStore());

    expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
    expect(topBarButton("Show sidebar")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens settings and a new note from the sidebar", async () => {
    renderApp(await newStore());

    await userEvent.click(within(sidebar()).getByRole("link", { name: "Settings" }));
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();

    await userEvent.click(within(sidebar()).getByRole("link", { name: "New conspect" }));
    expect(await textEditor()).toHaveFocus();
  });

  it("opens every note from the top bar, right before the search, whether or not the sidebar is shown", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/settings");

    expect(
      within(sidebar()).queryByRole("link", { name: "All conspects" }),
    ).not.toBeInTheDocument();
    const allNotes = within(topBar()).getByRole("link", { name: "All conspects" });
    expect(allNotes).toHaveAttribute("href", "/");
    expect(allNotes).toHaveAttribute("title", "All conspects (Esc)");
    expect(allNotes.parentElement?.nextElementSibling).toBe(within(topBar()).getByRole("search"));
    await userEvent.click(allNotes);
    expect(await listTitles()).toEqual(["Java Collections"]);

    await userEvent.click(within(sidebar()).getByRole("button", { name: "Hide sidebar" }));
    expect(within(topBar()).getByRole("link", { name: "All conspects" })).toBeInTheDocument();
  });

  it("shows not found for an unknown route", async () => {
    renderApp(await newStore(), "/nowhere");

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it("opens a conspect at /conspects/:id, and an old /notes/ link there too", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/notes/java");

    expect(await textEditor()).toHaveTextContent("Java Collections");
    const link = within(recentNav()).getByRole("link", { name: "Java Collections" });
    expect(link).toHaveAttribute("href", "/conspects/java");
    expect(link).toHaveAttribute("aria-current", "page");
  });
});

describe("sidebar panes", () => {
  const paneToggle = (name: string) => within(sidebar()).getByRole("button", { name });
  const taggedStore = async () => {
    const store = await newStore();
    await store.put(createNote("# Java Collections\n\nArrayList. #java", new Date(), "java"));
    return store;
  };

  it("folds each pane on its header, any number open, and remembers it", async () => {
    renderApp(await taggedStore(), "/conspects/java");
    await textEditor();
    const tags = await within(sidebar()).findByRole("navigation", { name: "Tags" });
    const javaTag = within(tags).getByRole("link", { name: "Java" });
    const recentNote = within(recentNav()).getByRole("link", { name: "Java Collections" });
    const details = within(sidebar()).getByRole("region", { name: "Details" });
    for (const name of ["Tags", "Recent", "Details"]) {
      expect(paneToggle(name)).toHaveAttribute("aria-expanded", "true");
    }

    await userEvent.click(paneToggle("Tags"));
    expect(paneToggle("Tags")).toHaveAttribute("aria-expanded", "false");
    expect(javaTag).not.toBeVisible();
    expect(recentNote).toBeVisible();
    expect(details).toBeVisible();
    await userEvent.click(paneToggle("Details"));
    expect(details).not.toBeVisible();
    expect(recentNote).toBeVisible();

    cleanup();
    renderApp(await taggedStore(), "/conspects/java");
    await textEditor();
    await within(sidebar()).findByRole("navigation", { name: "Tags" });
    expect(paneToggle("Tags")).toHaveAttribute("aria-expanded", "false");
    expect(paneToggle("Recent")).toHaveAttribute("aria-expanded", "true");
    expect(paneToggle("Details")).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(paneToggle("Tags"));
    expect(within(sidebar()).getByRole("link", { name: "Java" })).toBeVisible();
  });

  it("moves with ↑/↓ through the headers and the rows of open panes", async () => {
    renderApp(await taggedStore());
    await within(sidebar()).findByRole("navigation", { name: "Tags" });
    act(() => {
      paneToggle("Tags").focus();
    });

    await userEvent.keyboard("{ArrowDown}");
    expect(within(sidebar()).getByRole("link", { name: "Java" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(paneToggle("Recent")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(within(recentNav()).getByRole("link", { name: "Java Collections" })).toHaveFocus();

    // A folded pane's rows are skipped.
    await userEvent.click(paneToggle("Tags"));
    await userEvent.keyboard("{ArrowDown}");
    expect(paneToggle("Recent")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(paneToggle("Tags")).toHaveFocus();
  });

  it("enters the sidebar with Ctrl+\\ on an open pane only", async () => {
    renderApp(await taggedStore(), "/conspects/java");
    await within(sidebar()).findByRole("navigation", { name: "Tags" });
    await userEvent.click(paneToggle("Recent"));
    await userEvent.click(paneToggle("Tags"));
    await userEvent.click(await textEditor());

    await userEvent.keyboard("{Control>}\\{/Control}{Control>}\\{/Control}");
    expect(paneToggle("Tags")).toHaveFocus();
  });
});

describe("the note list", () => {
  it("lists every note, most recently edited first, here and in the sidebar", async () => {
    const store = await newStore();
    await store.put(emptyNote);
    await store.put(javaNote);
    await store.put(brokenNote);
    renderApp(store);

    expect(await listTitles()).toEqual(["Java Collections", "Untitled", "Unreadable conspect"]);
    const list = await noteList();
    expect(within(list).getByRole("link", { name: "Java Collections" })).toHaveAttribute(
      "href",
      "/conspects/java",
    );
    // A row is the cover, title, date and tags, and the start of the text.
    expect(within(list).getByText(/ArrayList — dynamic array\./)).toBeInTheDocument();
    expect(list.querySelector("time")).toHaveAttribute("datetime", "2020-09-28T10:15:00Z");
    expect(recentTitles()).toEqual(["Java Collections", "Untitled", "Unreadable conspect"]);
  });

  it("shows each note's cover, tags and text, and a letter where there is no cover", async () => {
    const store = await newStore();
    const date = new Date("2020-01-01");
    await store.put(
      createNote(
        "---\ncover: https://example.com/maps.png\ntags: [java#maps]\n---\n# Hash maps\n\n#algorithms",
        date,
        "maps",
      ),
    );
    await store.put(createNote("# ёжик\n\nText.", date, "hedgehog"));
    renderApp(store);

    const list = await noteList();
    // The same date: by id.
    const [hedgehog, maps] = within(list).getAllByRole("listitem");
    expect(maps?.querySelector("img")).toHaveAttribute("src", "https://example.com/maps.png");
    expect(maps).toHaveTextContent("#java #maps #algorithms");
    expect(hedgehog?.querySelector("img")).toBeNull();
    expect(hedgehog?.querySelector(".note-result-letter")).toHaveTextContent("Ё");
    expect(hedgehog?.querySelector(".search-snippet")).toHaveTextContent(/^Text\.$/);
  });

  it("shows an error when notes cannot be loaded, and retries", async () => {
    const store = await newStore();
    await store.put(javaNote);
    const failure = new Error("Disk on fire");
    vi.spyOn(store, "list").mockRejectedValueOnce(failure);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderApp(store);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load conspects");
    // A library's message is not shown; it goes to the log.
    expect(alert).toHaveTextContent("Oops, something went wrong.");
    expect(alert).not.toHaveTextContent("Disk on fire");
    expect(log).toHaveBeenCalledWith(failure);

    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await listTitles()).toEqual(["Java Collections"]);
  });

  it("shows notes arriving by sync without reloading the page", async () => {
    const store = await newStore();
    renderApp(store);
    expect(
      await screen.findByRole("heading", { name: "Welcome to Konspecter" }),
    ).toBeInTheDocument();

    await store.applyRemote({
      id: "r1",
      markdown: "# From the server",
      revision: 1,
      deleted: false,
    });

    await waitFor(async () => {
      expect(await listTitles()).toEqual(["From the server"]);
    });
    expect(recentTitles()).toEqual(["From the server"]);
  });
});

describe("creating a note", () => {
  it("saves as you type, with created and updated dates, and lists it at once", async () => {
    const store = await newStore();
    renderApp(store);

    await userEvent.click(within(sidebar()).getByRole("link", { name: "New conspect" }));
    await userEvent.type(await textEditor(), "# Hash maps{Enter}Buckets.");

    await waitFor(async () => {
      expect(await store.list()).toHaveLength(1);
    });
    const [saved] = await store.list();
    await stored(store, saved?.id ?? "", (markdown) => markdown.includes("Buckets."));
    const { metadata, body } = parseDocument((await store.get(saved?.id ?? ""))?.markdown ?? "");
    expect(body).toBe("# Hash maps\n\nBuckets.");
    expect(metadata.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    await waitFor(() => {
      expect(document.title).toBe("Hash maps · Konspecter");
    });
    // The title follows the text; the address moves to the saved note's a moment later.
    await waitFor(() => {
      expect(recentTitles()).toEqual(["Hash maps"]);
      expect(within(recentNav()).getByRole("link", { name: "Hash maps" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
    // There is no save button to press.
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("stores nothing when left blank", async () => {
    const store = await newStore();
    renderApp(store, "/conspects/new");

    await textEditor();
    await userEvent.click(within(sidebar()).getByRole("link", { name: "Settings" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await store.list()).toEqual([]);
  });

  it("does not save invalid frontmatter, and explains why", async () => {
    const store = await newStore();
    renderApp(store, "/conspects/new");

    const editor = await markdownEditor();
    setSourceValue(editor, "---\ncreated: tomorrow\n---\nText");

    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent(
      'Not saved: Frontmatter "created" must be an ISO 8601 date',
    );
    expect(sourceValue(editor)).toBe("---\ncreated: tomorrow\n---\nText");
    expect(await store.list()).toEqual([]);
  });

  it("keeps the text and tries again when saving fails", async () => {
    const store = await newStore();
    vi.spyOn(store, "put").mockRejectedValueOnce(new Error("Quota exceeded"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderApp(store, "/conspects/new");

    const editor = await textEditor();
    await userEvent.type(editor, "Important{Enter}text");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save the conspect: Oops, something went wrong. Your text is kept",
    );
    expect(editor).toHaveTextContent("Important");
    await userEvent.type(editor, "Still here");
    await waitFor(async () => {
      expect((await store.list())[0]?.markdown).toContain("Still here");
    });
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});

describe("a note", () => {
  it("opens in the editor, with its title, dates and cover", async () => {
    const store = await newStore();
    await store.put({
      id: "c",
      markdown:
        "---\ntitle: Covered\ncreated: 2026-09-01T00:00:00Z\nupdated: 2026-09-28T00:00:00Z\ncover: https://example.com/c.png\n---\n\nBody",
    });
    renderApp(store, "/conspects/c");

    expect(await textEditor()).toHaveTextContent("Body");
    expect(screen.getByRole("heading", { level: 1, name: "Covered" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Covered");
    expect(document.querySelector("img.note-cover")).toHaveAttribute(
      "src",
      "https://example.com/c.png",
    );
    const times = [...document.querySelectorAll(".details-list time")];
    expect(times.map((time) => time.getAttribute("datetime"))).toEqual([
      "2026-09-01T00:00:00Z",
      "2026-09-28T00:00:00Z",
    ]);
    expect(screen.queryByRole("toolbar", { name: "Formatting" })).not.toBeInTheDocument();
  });

  it("keeps empty title and cover fields out of the way until asked for", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/conspects/java");

    await textEditor();
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Properties" });
    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Collections");
    await stored(store, "java", (markdown) => markdown.includes("title: Collections"));
    expect(await textEditor()).toHaveTextContent("ArrayList");
  });

  it("saves an author set in the properties into the frontmatter", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/conspects/java");

    await textEditor();
    await userEvent.click(screen.getByRole("button", { name: "Properties" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Author" }), "Ann");
    expect(screen.queryByRole("textbox", { name: "Tags" })).not.toBeInTheDocument();

    await stored(store, "java", (markdown) => markdown.includes("author: Ann\n"));
    const details = within(sidebar()).getByRole("region", { name: "Details" });
    await waitFor(() => {
      expect(details).toHaveTextContent("AuthorAnn");
    });
  });

  it("shows notes the text editor cannot represent rendered, with highlighted code", async () => {
    const store = await newStore();
    await store.put(
      createNote(
        "# Maps\n\n| Map | Order |\n| - | - |\n| TreeMap | sorted |\n\n```java\nvar m = new HashMap<>();\n```",
        new Date("2020-09-28T10:15:00.000Z"),
        "maps",
      ),
    );
    renderApp(store, "/conspects/maps");

    expect(await screen.findByRole("table")).toHaveTextContent("TreeMap");
    expect(screen.getByRole("status")).toHaveTextContent("This conspect uses tables");
    expect(document.querySelector("pre code.language-java .hljs-keyword")).toHaveTextContent("new");

    const editor = await markdownEditor();
    expect(sourceValue(editor)).toContain("| TreeMap | sorted |");
  });

  it("edits the whole document and bumps only the updated date", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/conspects/java");

    await textEditor();
    const editor = await markdownEditor();
    expect(sourceValue(editor)).toBe(javaNote.markdown);
    setSourceValue(editor, javaNote.markdown.replace("Collections", "Collections, revised"));

    await stored(store, "java", (markdown) => markdown.includes("revised"));
    const { metadata, body } = parseDocument((await store.get("java"))?.markdown ?? "");
    expect(body).toBe("# Java Collections, revised\n\nArrayList — dynamic array.");
    expect(metadata.created).toBe("2020-09-28T10:15:00Z");
    expect(metadata.updated && metadata.updated > "2020-09-28T10:15:00Z").toBe(true);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Java Collections, revised" }),
      ).toBeInTheDocument();
    });
  });

  it("moves to the top of Recent as soon as it is edited", async () => {
    const store = await newStore();
    await store.put(javaNote);
    await store.put(createNote("# Newer", new Date("2021-01-01T00:00:00Z"), "newer"));
    renderApp(store, "/conspects/java");

    const box = await textEditor();
    await waitFor(() => {
      expect(recentTitles()).toEqual(["Newer", "Java Collections"]);
    });
    await userEvent.click(box);
    caretAtEnd(box);
    await userEvent.keyboard(" Edited.");

    await waitFor(() => {
      expect(recentTitles()).toEqual(["Java Collections", "Newer"]);
    });
    expect(await textEditor()).toBe(box);
  });

  it("opens a note with invalid frontmatter as source, and saves the fix", async () => {
    const store = await newStore();
    await store.put(brokenNote);
    renderApp(store, "/conspects/broken");

    const source = await screen.findByRole("textbox", { name: "Markdown" });
    expect(screen.getByRole("status")).toHaveTextContent("Text editing is unavailable");
    setSourceValue(source, "---\ntitle: Repaired\n---\n\nStill here.");

    await stored(store, "broken", (markdown) => markdown.includes("Repaired"));
    expect(await screen.findByRole("heading", { level: 1, name: "Repaired" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows not found for an unknown note", async () => {
    renderApp(await newStore(), "/conspects/missing");

    expect(await screen.findByRole("heading", { name: "Conspect not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to conspects" })).toHaveAttribute("href", "/");
  });

  it("is deleted after confirmation", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/conspects/java");

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete this conspect?" });
    expect(dialog).toHaveAccessibleDescription(
      "“Java Collections” will be deleted. This cannot be undone.",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(await store.get("java")).toEqual(javaNote);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByRole("heading", { name: "Welcome to Konspecter" }),
    ).toBeInTheDocument();
    expect(await store.get("java")).toBeUndefined();
  });

  it("is kept when the deletion is cancelled", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/conspects/java");

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await textEditor()).toHaveTextContent("ArrayList");
    expect(await store.get("java")).toEqual(javaNote);
  });
});

describe("tags", () => {
  async function storeWithTaggedNotes() {
    const store = await newStore();
    await store.put(createNote("# Lists\n\n#java#collections", new Date("2020-01-03"), "lists"));
    await store.put(
      createNote("# Streams\n\n#java#streams #fp", new Date("2020-01-02"), "streams"),
    );
    await store.put(createNote("# Untagged", new Date("2020-01-01"), "plain"));
    return store;
  }
  const tagTree = () => within(sidebar()).findByRole("navigation", { name: "Tags" });

  it("shows the tags as folders with their notes inside, with counts, collapsed", async () => {
    renderApp(await storeWithTaggedNotes());

    const tree = await tagTree();
    const java = within(tree).getByRole("link", { name: "Java" });
    const javaRow = java.closest("li") as HTMLElement;
    expect(within(javaRow).getByLabelText("2 conspects")).toBeInTheDocument();
    expect(within(tree).queryByRole("link", { name: "Collections" })).not.toBeInTheDocument();

    await userEvent.click(within(tree).getByRole("button", { name: "Expand #java" }));
    // A folder is its tag: its link filters by that tag alone.
    expect(within(tree).getByRole("link", { name: "Collections" })).toHaveAttribute(
      "href",
      "/?q=%23collections",
    );
    expect(within(tree).getByRole("button", { name: "Collapse #java" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // #java has only child tags; its notes sit inside them.
    expect(within(javaRow).queryByRole("link", { name: "Lists" })).not.toBeInTheDocument();

    await userEvent.click(within(tree).getByRole("button", { name: "Expand #collections" }));
    expect(await within(tree).findByRole("link", { name: "Lists" })).toHaveAttribute(
      "href",
      "/conspects/lists",
    );
    await userEvent.click(within(tree).getByRole("button", { name: "Expand #fp" }));
    // The note "Streams" (in #fp), beside the tag folder of the same name.
    await waitFor(() => {
      expect(
        within(tree)
          .getAllByRole("link", { name: "Streams" })
          .map((link) => link.getAttribute("href")),
      ).toEqual(["/conspects/streams", "/?q=%23streams"]);
    });
    expect(within(tree).queryByRole("link", { name: "Untagged" })).not.toBeInTheDocument();
  });

  it("walks the tree with the arrow keys: ↑/↓ row by row, → into a folder, ← out of it", async () => {
    renderApp(await storeWithTaggedNotes());
    const tree = await tagTree();
    const java = within(tree).getByRole("link", { name: "Java" });
    act(() => {
      java.focus();
    });

    await userEvent.keyboard("{ArrowRight}");
    expect(within(tree).getByRole("button", { name: "Collapse #java" })).toBeInTheDocument();
    expect(java).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(within(tree).getByRole("link", { name: "Collections" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    const streams = within(tree)
      .getAllByRole("link", { name: "Streams" })
      .find((link) => link.getAttribute("href") === "/?q=%23streams");
    expect(streams).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    const note = await waitFor(() => {
      const link = within(tree)
        .getAllByRole("link", { name: "Streams" })
        .find((each) => each.getAttribute("href") === "/conspects/streams");
      expect(link).toBeDefined();
      return link;
    });
    await userEvent.keyboard("{ArrowRight}");
    expect(note).toHaveFocus();

    await userEvent.keyboard("{ArrowLeft}");
    expect(streams).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(within(tree).getByRole("button", { name: "Expand #streams" })).toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}");
    expect(java).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(within(tree).getByRole("link", { name: "Fp" })).toHaveFocus();

    // Past the tree, the recent notes' header and the notes: one list.
    await userEvent.keyboard("{ArrowDown}{ArrowLeft}{ArrowDown}");
    expect(within(sidebar()).getByRole("button", { name: "Recent" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(within(recentNav()).getByRole("link", { name: "Lists" })).toHaveFocus();
  });

  it("shows tags as the notes write them, with underscores as spaces", async () => {
    const store = await newStore();
    await store.put(createNote("# Lists\n\n#Java#Linked_List", new Date(), "lists"));
    renderApp(store);

    const tree = await tagTree();
    await userEvent.click(await within(tree).findByRole("button", { name: "Expand #java" }));
    expect(within(tree).getByRole("link", { name: "Java" })).toHaveAttribute("href", "/?q=%23java");
    expect(within(tree).getByRole("link", { name: "Linked List" })).toHaveAttribute(
      "href",
      "/?q=%23linked_list",
    );
  });

  it("shows the tags listed in the frontmatter in the tree", async () => {
    const store = await newStore();
    await store.put(
      createNote("---\ntags:\n  - parent_1#child\n  - parent_2\n---\n# Meta", new Date(), "m"),
    );
    renderApp(store);

    const tree = await tagTree();
    expect(await within(tree).findByRole("link", { name: "Parent 1" })).toBeInTheDocument();
    expect(within(tree).getByRole("link", { name: "Parent 2" })).toBeInTheDocument();
    // A tag with a parent is never a root.
    expect(within(tree).queryByRole("link", { name: "Child" })).not.toBeInTheDocument();
    await userEvent.click(within(tree).getByRole("button", { name: "Expand #parent_1" }));
    await userEvent.click(within(tree).getByRole("button", { name: "Expand #child" }));
    expect(await within(tree).findByRole("link", { name: "Meta" })).toHaveAttribute(
      "href",
      "/conspects/m",
    );
  });

  it("shows a tag under each of its parents, holding the notes whose chains lead there", async () => {
    const store = await newStore();
    await store.put(createNote("# Lists\n\n#java#collections", new Date(), "lists"));
    await store.put(createNote("# Py\n\n#python#collections", new Date(), "py"));
    await store.put(createNote("# Bare\n\n#collections", new Date(), "bare"));
    renderApp(store, "/?q=%23collections");

    const tree = await tagTree();
    const roots = await within(tree).findAllByRole("link", { name: /^(Java|Python|Collections)$/ });
    // The active tag's folders start open, under both parents.
    expect(roots.map((link) => link.textContent)).toEqual([
      "Java",
      "Collections",
      "Python",
      "Collections",
    ]);
    for (const link of within(tree).getAllByRole("link", { name: "Collections" })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
    // #java#collections only in Java › Collections, #python#collections only in
    // Python › Collections; a bare #collections in both.
    await waitFor(() => {
      expect(
        within(tree)
          .getAllByRole("link", { name: /^(Bare|Lists|Py)$/ })
          .map((link) => link.textContent),
      ).toEqual(["Bare", "Lists", "Bare", "Py"]);
    });
    // Each folder counts what it holds.
    expect(within(tree).getAllByLabelText("2 conspects")).toHaveLength(4);
    // The search still takes each chain as both its tags.
    expect((await listTitles()).sort()).toEqual(["Bare", "Lists", "Py"]);
  });

  it("opens a note from the tag tree and marks it there", async () => {
    renderApp(await storeWithTaggedNotes());

    await userEvent.click(within(await tagTree()).getByRole("button", { name: "Expand #fp" }));
    await userEvent.click(await within(await tagTree()).findByRole("link", { name: "Streams" }));

    expect(await textEditor()).toHaveTextContent("Streams");
    expect(within(await tagTree()).getByRole("link", { name: "Streams" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("explains tags when no note has one", async () => {
    renderApp(await newStore());

    const tree = await tagTree();
    expect(tree).toHaveTextContent("Write #tag or #parent#child in a conspect.");
  });

  it("filters the list by a tag, including child tags, until the filter is removed", async () => {
    renderApp(await storeWithTaggedNotes());

    await userEvent.click(within(await tagTree()).getByRole("link", { name: "Java" }));

    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Lists", "Streams"]);
    });
    // The tag is a chip in the search box, not text.
    expect(searchBox()).toHaveValue("");
    expect(
      within(screen.getByRole("list", { name: "Tag filters" })).getByRole("listitem"),
    ).toHaveTextContent("#java");
    expect(within(await tagTree()).getByRole("link", { name: "Java" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const filters = screen.getByRole("list", { name: "Tag filters" });
    await userEvent.click(within(filters).getByRole("button", { name: "Remove #java filter" }));
    expect(await listTitles()).toEqual(["Lists", "Streams", "Untagged"]);
  });

  it("narrows to every tag of a chain", async () => {
    renderApp(await storeWithTaggedNotes(), "/?q=%23java%23streams");

    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Streams"]);
    });
  });

  it("updates the tree when a note gains a tag", async () => {
    const store = await storeWithTaggedNotes();
    renderApp(store);
    await tagTree();

    await store.put(createNote("# Rust\n\n#rust", new Date(), "rust"));

    expect(await within(await tagTree()).findByRole("link", { name: "Rust" })).toBeInTheDocument();
  });
});

describe("search", () => {
  async function storeWithNotes() {
    const store = await newStore();
    await store.put(
      createNote("# Hash maps\n\nBuckets and collisions.", new Date("2020-01-01"), "maps"),
    );
    await store.put(createNote("# Networking\n\nTCP handshakes.", new Date("2020-02-01"), "net"));
    await store.put(
      createNote("# Хеш-таблицы\n\nКоллизии и корзины.", new Date("2020-03-01"), "ru"),
    );
    return store;
  }

  it("opens with Ctrl+P, listing every note by recent edit", async () => {
    renderApp(await storeWithNotes(), "/settings");
    await screen.findByRole("heading", { level: 1, name: "Settings" });

    await userEvent.keyboard("{Control>}p{/Control}");

    expect(searchBox()).toHaveFocus();
    expect(await listTitles()).toEqual(["Хеш-таблицы", "Networking", "Hash maps"]);
  });

  it("keeps an open note until something is typed, and returns to it when cleared", async () => {
    renderApp(await storeWithNotes(), "/conspects/maps");
    const editor = await textEditor();
    await userEvent.click(editor);

    await userEvent.keyboard("{Control>}p{/Control}");
    expect(searchBox()).toHaveFocus();
    expect(await textEditor()).toHaveTextContent("Buckets and collisions.");
    expect(screen.queryByRole("list", { name: "Conspects" })).not.toBeInTheDocument();

    await userEvent.keyboard("tcp");
    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Networking"]);
    });

    await userEvent.clear(searchBox());
    expect(await textEditor()).toHaveTextContent("Buckets and collisions.");
    expect(screen.queryByRole("list", { name: "Conspects" })).not.toBeInTheDocument();
  });

  it("keeps a new note when the search box is focused", async () => {
    renderApp(await storeWithNotes(), "/conspects/new");
    await textEditor();

    await userEvent.click(findBox());

    expect(await textEditor()).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Conspects" })).not.toBeInTheDocument();
  });

  it("filters as you type and marks the matching fragments", async () => {
    renderApp(await storeWithNotes());
    await noteList();

    await userEvent.type(searchBox(), "collis");

    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Hash maps"]);
    });
    const list = await noteList();
    expect(within(list).getByRole("link", { name: "Hash maps" })).toHaveAttribute(
      "href",
      "/conspects/maps",
    );
    expect(list.querySelector("mark")).toHaveTextContent("collisions");
  });

  it("finds and highlights Cyrillic text, in titles too", async () => {
    renderApp(await storeWithNotes());
    await noteList();

    await userEvent.type(searchBox(), "хеш");

    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Хеш-таблицы"]);
    });
    const marks = [...(await noteList()).querySelectorAll("mark")].map((mark) => mark.textContent);
    expect(marks).toContain("Хеш");
  });

  it("keeps the query in the URL", async () => {
    renderApp(await storeWithNotes(), "/?q=tcp");

    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Networking"]);
    });
    expect(searchBox()).toHaveValue("tcp");
  });

  it("combines words with tag filters that can be removed", async () => {
    const store = await newStore();
    await store.put(createNote("# Java maps\n\nhashmap #java", new Date("2020-01-02"), "j"));
    await store.put(createNote("# Go maps\n\nhashmap #go", new Date("2020-01-01"), "g"));
    renderApp(store, "/?q=hashmap%20%23java");

    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Java maps"]);
    });

    const filters = screen.getByRole("list", { name: "Tag filters" });
    await userEvent.click(within(filters).getByRole("button", { name: "Remove #java filter" }));

    expect(searchBox()).toHaveValue("hashmap");
    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Java maps", "Go maps"]);
    });
  });

  it("turns a typed tag into a chip once a space follows it, and Backspace removes it", async () => {
    const store = await newStore();
    await store.put(createNote("# Java maps\n\nhashmap #java", new Date("2020-01-02"), "j"));
    await store.put(createNote("# Go maps\n\nhashmap #go", new Date("2020-01-01"), "g"));
    renderApp(store, "/");

    await userEvent.type(searchBox(), "#jav");
    expect(screen.queryByRole("list", { name: "Tag filters" })).not.toBeInTheDocument();
    await userEvent.type(searchBox(), "a hash");
    expect(searchBox()).toHaveValue("hash");
    const filters = screen.getByRole("list", { name: "Tag filters" });
    expect(filters).toHaveTextContent("#java");
    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Java maps"]);
    });

    await userEvent.clear(searchBox());
    await userEvent.keyboard("{Backspace}");
    expect(screen.queryByRole("list", { name: "Tag filters" })).not.toBeInTheDocument();
    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Java maps", "Go maps"]);
    });
  });

  it("has no heading over the list or the results", async () => {
    renderApp(await storeWithNotes(), "/?q=tcp");

    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Networking"]);
    });
    // Only a heading for screen readers.
    expect(screen.getByRole("heading", { level: 1, name: "Search results" })).toHaveClass(
      "visually-hidden",
    );
    expect(screen.queryByText("All notes")).not.toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    renderApp(await storeWithNotes(), "/?q=quantum");

    expect(
      await screen.findByRole("heading", { name: "No matching conspects" }),
    ).toBeInTheDocument();
  });

  it("finds a note saved after the index was built", async () => {
    const store = await storeWithNotes();
    await store.search(parseQuery("warm up"));
    await store.put(createNote("# Fresh\n\nnew words", new Date(), "fresh"));
    renderApp(store, "/?q=fresh");

    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Fresh"]);
    });
  });

  it("searches the library from a note with Ctrl+P and opens results", async () => {
    renderApp(await storeWithNotes(), "/conspects/maps");
    await textEditor();

    await userEvent.keyboard("{Control>}p{/Control}");
    await userEvent.keyboard("tcp");
    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Networking"]);
    });
    await userEvent.keyboard("{Enter}");

    expect(await textEditor()).toHaveTextContent("TCP handshakes.");
  });
  it("moves through two columns with the arrow keys", async () => {
    renderApp(await storeWithNotes());
    const list = await noteList();
    // The layout's two columns (jsdom lays nothing out).
    list.style.gridTemplateColumns = "320px 320px";
    const link = (name: string) => within(list).getByRole("link", { name });

    await userEvent.click(searchBox());
    await userEvent.keyboard("{ArrowDown}");
    expect(link("Хеш-таблицы")).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(link("Networking")).toHaveFocus();
    // Nothing under it in the short last row: its last note.
    await userEvent.keyboard("{ArrowDown}");
    expect(link("Hash maps")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(link("Хеш-таблицы")).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}{ArrowLeft}");
    expect(link("Хеш-таблицы")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(searchBox()).toHaveFocus();
  });

  it("moves through the results with ↑ and ↓, back to the search box from the first", async () => {
    renderApp(await storeWithNotes());
    const list = await noteList();
    const link = (name: string) => within(list).getByRole("link", { name });

    await userEvent.click(searchBox());
    await userEvent.keyboard("{ArrowDown}");
    expect(link("Хеш-таблицы")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(link("Hash maps")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(link("Hash maps")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(link("Networking")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(searchBox()).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(await textEditor()).toHaveTextContent("TCP handshakes.");
  });
});

describe("search in the note", () => {
  const maps = createNote(
    "# Hash maps\n\nA HashMap maps keys.\n\nTreeMap keeps them sorted.",
    new Date("2020-01-01"),
    "maps",
  );
  let scrollTo: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  });

  async function openMaps(settings?: Settings) {
    const store = await newStore();
    await store.put(maps);
    renderApp(store, "/conspects/maps", settings);
    return store;
  }

  const count = () => within(topBar()).getByRole("status");
  const marked = (root: ParentNode = document) =>
    [...root.querySelectorAll(".find-match")].map((match) => match.textContent);
  const current = () => document.querySelector(".find-current")?.textContent;

  it("marks the matches in the note and scrolls to the first", async () => {
    await openMaps();
    const editor = await textEditor();
    await userEvent.click(findBox());
    scrollTo.mockClear();

    await userEvent.keyboard("map");

    expect(marked(editor)).toEqual(["map", "Map", "map", "Map"]);
    expect(current()).toBe("map");
    expect(count()).toHaveTextContent("Match 1 of 4");
    expect(scrollTo).toHaveBeenCalled();
    // The note stays; the library is not searched.
    expect(screen.queryByRole("list", { name: "Conspects" })).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("A HashMap maps keys.");
  });

  it("moves between the matches with ↓, ↑, Enter and the buttons, around the ends", async () => {
    await openMaps();
    const editor = await textEditor();
    await userEvent.click(findBox());
    await userEvent.keyboard("map");
    const selected = () =>
      [...editor.querySelectorAll(".find-match")].findIndex((match) =>
        match.classList.contains("find-current"),
      );

    await userEvent.keyboard("{ArrowDown}");
    expect(selected()).toBe(1);
    expect(findBox()).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(selected()).toBe(2);
    await userEvent.click(within(topBar()).getByRole("button", { name: "Next match" }));
    expect(selected()).toBe(3);
    expect(count()).toHaveTextContent("Match 4 of 4");
    await userEvent.keyboard("{ArrowDown}");
    expect(selected()).toBe(0);
    await userEvent.keyboard("{ArrowUp}");
    expect(selected()).toBe(3);
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    expect(selected()).toBe(2);
    await userEvent.click(within(topBar()).getByRole("button", { name: "Previous match" }));
    expect(selected()).toBe(1);
    expect(findBox()).toHaveFocus();
  });

  it("lets Tab leave the box, with or without matches", async () => {
    await openMaps();
    const editor = await textEditor();
    await userEvent.click(findBox());
    await userEvent.keyboard("queue");

    expect(marked(editor)).toEqual([]);
    expect(count()).toHaveTextContent("Match 0 of 0");
    expect(within(topBar()).getByRole("button", { name: "Next match" })).toBeDisabled();
    await userEvent.keyboard("{Tab}");
    expect(findBox()).not.toHaveFocus();

    await userEvent.click(findBox());
    await userEvent.clear(findBox());
    await userEvent.keyboard("map");
    expect(count()).toHaveTextContent("Match 1 of 4");
    await userEvent.keyboard("{Tab}");
    expect(findBox()).not.toHaveFocus();
    expect(count()).toHaveTextContent("Match 1 of 4");
  });

  it("opens with Ctrl+F from the editor; Ctrl+P searches the library instead", async () => {
    await openMaps();
    await userEvent.click(await textEditor());

    await userEvent.keyboard("{Control>}f{/Control}");
    expect(findBox()).toHaveFocus();
    await userEvent.keyboard("sorted");
    expect(current()).toBe("sorted");

    await userEvent.keyboard("{Control>}p{/Control}");
    expect(searchBox()).toHaveFocus();
    expect(searchBox()).toHaveValue("");
    // Leaving the box brings the note's search back.
    await userEvent.click(await textEditor());
    expect(findBox()).toHaveValue("sorted");
    expect(current()).toBe("sorted");
  });

  it("ends with the note: the list's search box is empty and nothing stays marked", async () => {
    await openMaps();
    await textEditor();
    await userEvent.click(findBox());
    await userEvent.keyboard("map");

    await userEvent.click(within(topBar()).getByRole("link", { name: "All conspects" }));
    expect(await listTitles()).toEqual(["Hash maps"]);
    expect(searchBox()).toHaveValue("");

    await userEvent.click(within(await noteList()).getByRole("link", { name: "Hash maps" }));
    expect(await textEditor()).toHaveTextContent("A HashMap maps keys.");
    expect(findBox()).toHaveValue("");
    expect(marked()).toEqual([]);
  });

  it("searches the Markdown source in Markdown mode, frontmatter and marks included", async () => {
    await openMaps({ ...DEFAULT_SETTINGS, defaultEditor: "markdown" });
    const source = await screen.findByRole("textbox", { name: "Markdown" });

    await userEvent.click(findBox());
    await userEvent.keyboard("# hash");

    expect(marked(source)).toEqual(["# Hash"]);
    expect(count()).toHaveTextContent("Match 1 of 1");
  });

  it("follows the note as it changes, and keeps the matches when the mode is switched", async () => {
    await openMaps();
    const editor = await textEditor();
    await userEvent.click(findBox());
    await userEvent.keyboard("keys");
    expect(count()).toHaveTextContent("Match 1 of 1");

    await userEvent.click(editor);
    caretAtEnd(editor);
    await userEvent.keyboard(" More keys.");
    expect(marked(editor)).toEqual(["keys", "keys"]);

    await userEvent.keyboard("{Control>}/{/Control}");
    const source = await screen.findByRole("textbox", { name: "Markdown" });
    expect(marked(source)).toEqual(["keys", "keys"]);
    expect(count()).toHaveTextContent("Match 1 of 2");
  });

  it("counts the matches in a note shown rendered", async () => {
    const store = await newStore();
    await store.put(
      createNote(
        "# Maps\n\n| Map | Order |\n| --- | --- |\n| TreeMap | sorted |",
        new Date("2020-01-01"),
        "table",
      ),
    );
    renderApp(store, "/conspects/table");
    await screen.findByRole("table");

    await userEvent.click(findBox());
    await userEvent.keyboard("map");

    // "Maps" is the page's title, not repeated in the text: the table's two.
    expect(count()).toHaveTextContent("Match 1 of 2");
  });
});

describe("settings and the top bar", () => {
  afterEach(() => {
    applyLanguage("system");
  });

  function renderWithSettings(store: NoteStore, path: string, settings?: Settings) {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App
          store={store}
          saveSettings={(next) => store.saveSettings(next)}
          {...(settings ? { initialSettings: settings } : {})}
        />
      </MemoryRouter>,
    );
  }

  it("edits the app's .konspecterignore in a text box and keeps it", async () => {
    const store = await newStore();
    renderWithSettings(store, "/settings");

    const rules = screen.getByRole("textbox", { name: "Rules (.konspecterignore)" });
    expect(rules).toHaveValue(DEFAULT_IGNORE);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await userEvent.clear(rules);
    await userEvent.type(rules, "drafts/{Enter}");
    await userEvent.click(save);
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(save).toBeDisabled();
    expect(await store.loadSettings()).toMatchObject({ ignore: "drafts/\n" });

    await userEvent.click(screen.getByRole("button", { name: "Restore default" }));
    expect(rules).toHaveValue(DEFAULT_IGNORE);
    expect(save).toBeEnabled();
  });

  it("names tags with a capital first letter, or as written", async () => {
    const store = await newStore();
    await store.put(createNote("# N\n\n#новые_технологии", new Date(), "n"));
    renderWithSettings(store, "/settings");

    const tree = await within(sidebar()).findByRole("navigation", { name: "Tags" });
    expect(await within(tree).findByRole("link", { name: "Новые технологии" })).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Tag names" }),
      "As written in conspects",
    );
    expect(await within(tree).findByRole("link", { name: "новые технологии" })).toBeInTheDocument();
    await waitFor(async () => {
      expect(await store.loadSettings()).toMatchObject({ tagNames: "as-written" });
    });
  });

  it("switches the interface language at once and keeps it", async () => {
    const store = await newStore();
    renderWithSettings(store, "/settings");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Language" }), "Русский");

    expect(screen.getByRole("heading", { level: 1, name: "Настройки" })).toBeInTheDocument();
    const russianSidebar = screen.getByRole("complementary", { name: "Боковая панель" });
    expect(within(russianSidebar).getByRole("link", { name: "Настройки" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("ru");
    const language = screen.getByRole("combobox", { name: "Язык" });
    expect(language).toHaveValue("ru");
    await waitFor(async () => {
      expect(await store.loadSettings()).toMatchObject({ language: "ru" });
    });

    await userEvent.selectOptions(language, "Как в системе");
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("highlights the editing area unless turned off", async () => {
    const store = await newStore();
    renderWithSettings(store, "/settings");

    expect(document.documentElement.dataset.editingArea).toBe("highlighted");
    await userEvent.click(screen.getByRole("radio", { name: "Plain" }));
    expect(document.documentElement.dataset.editingArea).toBe("plain");
  });

  it("applies and saves the theme and text size immediately", async () => {
    const store = await newStore();
    renderWithSettings(store, "/settings");
    expect(document.documentElement.dataset.theme).toBe("system");

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await userEvent.click(screen.getByRole("radio", { name: "Larger" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1.3");
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(await store.loadSettings()).toMatchObject({ theme: "dark", fontScale: 1.3 });
  });

  it("toggles the theme from the top bar and keeps it", async () => {
    const store = await newStore();
    renderWithSettings(store, "/");

    const toggle = topBarButton("Dark theme");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await waitFor(async () => {
      expect(await store.loadSettings()).toMatchObject({ theme: "dark" });
    });
    await userEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("switches the open note between Text and Markdown from the top bar, and keeps the mode", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderWithSettings(store, "/conspects/java");

    await textEditor();
    expect(topBarButton("Markdown")).toHaveAttribute("aria-pressed", "false");
    const source = await markdownEditor();

    expect(sourceValue(source)).toBe(javaNote.markdown);
    expect(topBarButton("Markdown")).toHaveAttribute("aria-pressed", "true");
    await waitFor(async () => {
      expect(await store.loadSettings()).toMatchObject({ defaultEditor: "markdown" });
    });

    await userEvent.click(within(sidebar()).getByRole("link", { name: "New conspect" }));
    expect(await screen.findByRole("textbox", { name: "Markdown" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Conspect text" })).not.toBeInTheDocument();
  });

  it("opens editors in the default mode chosen in settings", async () => {
    const store = await newStore();
    renderWithSettings(store, "/settings");

    await userEvent.click(screen.getByRole("radio", { name: "Markdown" }));
    await userEvent.click(within(sidebar()).getByRole("link", { name: "New conspect" }));

    expect(await screen.findByRole("textbox", { name: "Markdown" })).toBeInTheDocument();
  });

  it("passes the reading position behaviour to notes", async () => {
    const store = await newStore();
    await store.put(javaNote);
    await store.saveReadingPosition("java", 0.5);
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 3000,
    });
    renderWithSettings(store, "/conspects/java", { ...DEFAULT_SETTINGS, readingPosition: "ask" });

    expect(await screen.findByText("You were 50% through this conspect.")).toBeInTheDocument();
  });

  it("shows whether notes are stored persistently and can ask for it", async () => {
    let persisted = false;
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        persisted: () => Promise.resolve(persisted),
        persist: () => {
          persisted = true;
          return Promise.resolve(true);
        },
      },
    });
    renderWithSettings(await newStore(), "/settings");

    expect(await screen.findByText(/the browser may clear them/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep my conspects on this device" }));

    expect(await screen.findByText(/stored persistently on this device/)).toBeInTheDocument();
    Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });
  });

  it("shows an error but keeps the change when saving fails", async () => {
    const store = await newStore();
    vi.spyOn(store, "saveSettings").mockRejectedValueOnce(new Error("Read-only"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderWithSettings(store, "/settings");

    await userEvent.click(screen.getByRole("radio", { name: "Light" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save settings: Oops, something went wrong. They apply until you reload.",
    );
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("lists the keyboard shortcuts", async () => {
    renderWithSettings(await newStore(), "/settings");

    const section = screen.getByRole("region", { name: "Keyboard shortcuts" });
    // One row per action, with every key that does it.
    expect(section).toHaveTextContent("Ctrl+Por/Search");
    expect(section).toHaveTextContent("Ctrl+NornNew conspect");
    expect(section).toHaveTextContent("Ctrl+,Settings");
  });
});

describe("the dates a save writes", () => {
  it("appear in the Markdown source at once, next to what is typed", async () => {
    const store = await newStore();
    const settings: Settings = { ...DEFAULT_SETTINGS, defaultEditor: "markdown" };
    renderApp(store, "/conspects/new", settings);
    const source = await screen.findByRole("textbox", { name: "Markdown" });

    setSourceValue(source, "# Dated\n\nbody");
    await waitFor(async () => {
      expect(await store.list()).toHaveLength(1);
    });
    const [stored] = await store.list();
    await waitFor(() => {
      expect(sourceValue(source)).toBe(stored?.markdown);
    });
  });
});

describe("a new note's first line", () => {
  async function typedNote(keys: string, settings?: Settings) {
    const store = await newStore();
    renderApp(store, "/conspects/new", settings);
    const box = await screen.findByRole("textbox", {
      name: settings?.defaultEditor === "markdown" ? "Markdown" : "Conspect text",
    });
    await userEvent.click(box);
    await userEvent.keyboard(keys);
    let markdown = "";
    await waitFor(async () => {
      const [note] = await store.list();
      markdown = note?.markdown ?? "";
      expect(markdown).toContain("milk");
    });
    return parseDocument(markdown).body;
  }

  it("becomes the title when it is short and Enter ends it", async () => {
    expect(await typedNote("Shopping list{Enter}milk")).toBe("# Shopping list\n\nmilk");
  });

  it("stays text when it is long", async () => {
    const long = "A first line that is far too long to be taken as the note title";
    expect(await typedNote(`${long}{Enter}milk`)).toBe(`${long}\n\nmilk`);
  });

  it("becomes the title in Markdown mode too", async () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, defaultEditor: "markdown" };
    expect(await typedNote("Shopping list{Enter}milk", settings)).toBe("# Shopping list\nmilk");
  });
});

describe("note details", () => {
  const details = () => within(sidebar()).queryByRole("region", { name: "Details" });

  it("shows the open note's details in the sidebar, and only on the note page", async () => {
    const store = await newStore();
    await store.put(
      createNote(
        "---\nauthor: Ann\n---\n# Maps\n\nHash maps and trees. #java#collections",
        new Date("2026-09-01T10:00:00Z"),
        "maps",
      ),
    );
    renderApp(store, "/conspects/maps");

    await textEditor();
    const region = await within(sidebar()).findByRole("region", { name: "Details" });
    expect(region).toHaveTextContent("Created");
    expect(region).toHaveTextContent("7 words");
    // A chain is listed as its separate tags.
    expect(within(region).getByRole("link", { name: "#java" })).toHaveAttribute(
      "href",
      "/?q=%23java",
    );
    expect(within(region).getByRole("link", { name: "#collections" })).toHaveAttribute(
      "href",
      "/?q=%23collections",
    );
    expect(region).toHaveTextContent("AuthorAnn");
    const actions = within(region).getByRole("group", { name: "Conspect actions" });
    expect(within(actions).getByRole("button", { name: "Delete" })).toHaveAttribute(
      "title",
      "Delete",
    );

    await userEvent.click(within(sidebar()).getByRole("link", { name: "Maps" }));
    await userEvent.click(within(sidebar()).getByRole("link", { name: "Settings" }));
    expect(details()).not.toBeInTheDocument();
  });

  it("shows a new note's details before it is saved", async () => {
    renderApp(await newStore(), "/conspects/new");

    const region = await within(sidebar()).findByRole("region", { name: "Details" });
    expect(region).toHaveTextContent("Not saved yet");
    expect(within(region).getByRole("button", { name: "Properties" })).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});

describe("the antenna", () => {
  it("transmits while a change is being saved, then rests", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/conspects/java");

    const box = await textEditor();
    await userEvent.click(box);
    caretAtEnd(box);
    await userEvent.keyboard("!");

    expect(antenna()).toHaveAttribute("data-active", "true");
    expect(antenna()).toHaveAccessibleName("Saving and syncing");
    await stored(store, "java", (markdown) => markdown.includes("array.!"));
    await waitFor(
      () => {
        expect(antenna()).toHaveAttribute("data-active", "false");
      },
      { timeout: 3000 },
    );
  });
});

describe("sync", () => {
  function syncFor(store: NoteStore, server: FakeServer) {
    return new SyncEngine(store, {
      fetch: server.fetch,
      scheduler: { set: () => null, clear: () => undefined },
      isOnline: () => true,
    });
  }

  it("connects from settings, shows the status and disconnects", async () => {
    const store = await newStore();
    await store.put(javaNote);
    const server = new FakeServer();
    const sync = syncFor(store, server);
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App store={store} sync={sync} />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText("Server URL"), "https://sync.example.com");
    await userEvent.type(screen.getByLabelText("Access token"), "ksp_ada");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await userEvent.type(await screen.findByLabelText("Encryption passphrase"), TEST_PASSPHRASE);
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText(/Up to date/)).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(server.notes.has("java")).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("explains a failed connection", async () => {
    const store = await newStore();
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App store={store} sync={syncFor(store, new FakeServer())} />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText("Server URL"), "https://sync.example.com");
    await userEvent.type(screen.getByLabelText("Access token"), "ksp_wrong");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not connect: a valid bearer token is required",
    );
  });

  it("shows held-back notes in the top bar", async () => {
    const store = await newStore();
    const server = new FakeServer();
    const sync = syncFor(store, server);
    await store.put(createNote("x".repeat(2000), new Date(), "huge"));
    await sync.connect({ serverUrl: "https://sync.example.com", token: "ksp_ada" });
    await sync.unlock(TEST_PASSPHRASE);
    render(
      <MemoryRouter>
        <App store={store} sync={sync} />
      </MemoryRouter>,
    );

    expect(
      await within(topBar()).findByRole("link", { name: "Sync: 1 not synced" }),
    ).toHaveAttribute("href", "/settings");
  });

  it("keeps an edit made while a sync replaced the note: the later edit wins", async () => {
    const store = await newStore();
    await store.put(javaNote);
    // Synced: the server's version may replace it.
    await store.markPushed("java", { revision: 1, markdown: javaNote.markdown });
    renderApp(store, "/conspects/java");
    await textEditor();
    const editor = await markdownEditor();
    setSourceValue(editor, "# My edit");

    await store.applyRemote({
      id: "java",
      markdown: "# From another device",
      revision: 7,
      deleted: false,
    });

    await waitFor(
      async () => {
        expect((await store.get("java"))?.markdown).toContain("# My edit");
      },
      { timeout: 3000 },
    );
    expect(await store.list()).toHaveLength(1);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

describe("file mode", () => {
  async function folderApp(path = "/", { followTitles = false } = {}) {
    const folder = new FakeFolder();
    const store = new FolderStore(folder, await newStore(), { graceMs: 5, followTitles });
    return {
      folder,
      store,
      render: () => {
        renderApp(store, path);
      },
    };
  }

  it("lists, opens and edits Markdown files", async () => {
    const { folder, render: show } = await folderApp();
    folder.edit("java.md", "# Java\n\nCollections. #java");
    show();

    await userEvent.click(within(await noteList()).getByRole("link", { name: "Java" }));
    expect(await textEditor()).toHaveTextContent("Collections. #java");

    const source = await markdownEditor();
    setSourceValue(source, "# Java\n\nStreams too.");

    await waitFor(() => {
      expect(folder.files.get("java.md")?.text).toContain("Streams too.");
    });
  });

  it("creates a file for a new note and trashes deleted ones", async () => {
    const { folder, render: show } = await folderApp("/conspects/new");
    show();

    await userEvent.type(await textEditor(), "# Fresh idea{Enter}Body");
    await waitFor(() => {
      expect(folder.files.has("fresh-idea.md")).toBe(true);
    });

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete this conspect?" });
    expect(dialog).toHaveTextContent("will be moved to the system trash");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByRole("heading", { name: "Welcome to Konspecter" }),
    ).toBeInTheDocument();
    expect(folder.trashed).toEqual(["fresh-idea.md"]);
  });

  it("updates the list and the open note when files change on disk", async () => {
    const { folder, store, render: show } = await folderApp("/conspects/live.md");
    folder.edit("live.md", "# Live\n\nfirst version");
    await store.watch();
    show();
    expect(await textEditor()).toHaveTextContent("first version");

    folder.edit("live.md", "# Live\n\nsaved in Vim");
    folder.notify({ paths: ["live.md"], rescan: false });

    await waitFor(async () => {
      expect(await textEditor()).toHaveTextContent("saved in Vim");
    });
  });

  it("follows a note whose file was renamed", async () => {
    const { folder, store, render: show } = await folderApp("/conspects/old.md");
    folder.edit("old.md", "# Moving");
    await store.watch();
    show();
    expect(await textEditor()).toHaveTextContent("Moving");

    folder.move("old.md", "archive/new.md");
    folder.notify({ paths: ["old.md", "archive/new.md"], rescan: false });

    await waitFor(() => {
      const link = within(recentNav()).getByRole("link", { name: "Moving" });
      expect(link).toHaveAttribute("href", "/conspects/archive%2Fnew.md");
      expect(link).toHaveAttribute("aria-current", "page");
    });
    expect(await textEditor()).toHaveTextContent("Moving");
  });

  it("renames the open note's file after its title, and the editing goes on", async () => {
    const { folder, render: show } = await folderApp("/conspects/test.md", { followTitles: true });
    folder.edit("test.md", "# Test\n\nBody");
    show();

    const editor = await markdownEditor();
    setSourceValue(editor, "# Hello мир!\n\nBody");
    await waitFor(() => {
      expect([...folder.files.keys()]).toEqual(["hello-mir.md"]);
    });
    await waitFor(() => {
      const link = within(recentNav()).getByRole("link", { name: "Hello мир!" });
      expect(link).toHaveAttribute("href", "/conspects/hello-mir.md");
      expect(link).toHaveAttribute("aria-current", "page");
    });

    // The same editor keeps saving, now to the renamed file.
    expect(editor).toBeInTheDocument();
    setSourceValue(editor, "# Hello мир!\n\nMore");
    await waitFor(() => {
      expect(folder.files.get("hello-mir.md")?.text).toContain("More");
    });
    expect([...folder.files.keys()]).toEqual(["hello-mir.md"]);
  });

  it("keeps file names when titles change, unless the setting says otherwise", async () => {
    const { folder, render: show } = await folderApp("/conspects/test.md");
    folder.edit("test.md", "# Test");
    show();

    setSourceValue(await markdownEditor(), "# Hello мир!");
    await waitFor(() => {
      expect(folder.files.get("test.md")?.text).toContain("Hello мир!");
    });
    expect([...folder.files.keys()]).toEqual(["test.md"]);
  });

  it("opens a note in the external editor", async () => {
    const { folder, render: show } = await folderApp("/conspects/ext.md");
    folder.edit("ext.md", "# External");
    show();

    await userEvent.click(await screen.findByRole("button", { name: "Open in external editor" }));
    await userEvent.click(screen.getByRole("button", { name: "Show in Finder" }));

    expect(folder.opened).toEqual(["ext.md"]);
    expect(folder.revealed).toEqual(["ext.md"]);
  });

  it("writes an edit over a file changed on disk meanwhile: the later edit wins", async () => {
    const { folder, store, render: show } = await folderApp("/conspects/race.md");
    folder.edit("race.md", "# Race\n\noriginal");
    await store.watch();
    show();
    await textEditor();
    const editor = await markdownEditor();
    setSourceValue(editor, "# Race\n\nmy edit");

    folder.edit("race.md", "# Race\n\nsaved in VS Code");
    folder.notify({ paths: ["race.md"], rescan: false });

    await waitFor(
      () => {
        expect(folder.files.get("race.md")?.text).toContain("my edit");
      },
      { timeout: 3000 },
    );
    expect([...folder.files.keys()]).toEqual(["race.md"]);
    expect(screen.queryByText(/conflict copy/)).not.toBeInTheDocument();
  });

  it("writes over a change another program made just before saving", async () => {
    const { folder, render: show } = await folderApp("/conspects/race.md");
    folder.edit("race.md", "# Race\n\noriginal");
    show();
    await textEditor();
    const editor = await markdownEditor();
    // Written by another program, not yet reported by the watcher.
    folder.edit("race.md", "# Race\n\nunreported change");
    setSourceValue(editor, "# Race\n\nmy edit");

    await waitFor(
      () => {
        expect(folder.files.get("race.md")?.text).toContain("my edit");
      },
      { timeout: 3000 },
    );
    expect([...folder.files.keys()]).toEqual(["race.md"]);
  });

  describe("folders following tags", () => {
    async function reformatApp(path = "/") {
      const folder = new FakeFolder();
      folder.edit("x.md", "# X\n\n#java");
      folder.edit("java/placed.md", "# Placed\n\n#java");
      const store = new FolderStore(folder, await newStore(), { graceMs: 5 });
      const show = () =>
        render(
          <MemoryRouter initialEntries={[path]}>
            <App
              store={store}
              library={{
                folder: "/Users/ada/Notes",
                chooseFolder: () => Promise.resolve(),
                reformat: { misplaced: () => store.misplaced(), apply: () => store.reformat() },
              }}
            />
          </MemoryRouter>,
        );
      return { folder, show };
    }
    const question = () =>
      screen.findByRole("alertdialog", { name: "Reformat your local files collection?" });

    it("asks once whether to reformat, and moves files with tags into their folders", async () => {
      const { folder, show } = await reformatApp();
      show();

      expect(await question()).toHaveTextContent(
        "1 conspect with tags is elsewhere and would move into its tags' folder.",
      );
      await userEvent.click(screen.getByRole("button", { name: "Reformat" }));
      await waitFor(() => {
        expect([...folder.files.keys()].sort()).toEqual(["java/placed.md", "java/x.md"]);
      });

      cleanup();
      folder.edit("y.md", "# Y\n\n#go");
      show();
      await listTitles();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("keeps the files as they are when told so, until reformatted from settings", async () => {
      const { folder, show } = await reformatApp("/settings");
      show();

      await userEvent.click(within(await question()).getByRole("button", { name: "Keep as is" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(folder.files.has("x.md")).toBe(true);

      await userEvent.click(screen.getByRole("button", { name: "Reformat the folder…" }));
      await userEvent.click(within(await question()).getByRole("button", { name: "Reformat" }));
      expect(
        await screen.findByText("Moved 1 conspect into its tags' folder."),
      ).toBeInTheDocument();
      expect(folder.files.has("java/x.md")).toBe(true);

      await userEvent.click(screen.getByRole("button", { name: "Reformat the folder…" }));
      expect(
        await screen.findByText("Every conspect with tags is in its tags' folder already."),
      ).toBeInTheDocument();
    });
  });

  it("edits the folder's .konspecterignore, and the list follows it", async () => {
    const folder = new FakeFolder();
    folder.edit("note.md", "# Note");
    folder.edit("drafts/draft.md", "# Draft");
    folder.edit(".hidden/secret.md", "# Secret");
    const store = new FolderStore(folder, await newStore(), { graceMs: 5 });
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App
          store={store}
          library={{
            folder: "/Users/ada/Notes",
            chooseFolder: () => Promise.resolve(),
            ignore: { read: () => store.ignoreText(), save: (text) => store.setIgnore(text) },
          }}
        />
      </MemoryRouter>,
    );

    const rules = await screen.findByRole("textbox", { name: "Rules (.konspecterignore)" });
    expect(rules).toHaveValue(DEFAULT_IGNORE);
    expect(screen.getByText(/Kept in the folder as/)).toBeInTheDocument();

    await userEvent.clear(rules);
    await userEvent.type(rules, "drafts/");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(folder.ignoreFile).toBe("drafts/");
    expect((await store.list()).map((note) => note.id).sort()).toEqual([
      ".hidden/secret.md",
      "note.md",
    ]);
  });

  it("shows the folder in settings, and changes it", async () => {
    const store = await newStore();
    const chooseFolder = vi.fn(() => Promise.resolve());
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App store={store} library={{ folder: "/Users/ada/Konspecter", chooseFolder }} />
      </MemoryRouter>,
    );

    expect(screen.getByText("/Users/ada/Konspecter")).toBeInTheDocument();
    expect(screen.getByText(/Sync covers this folder/)).toBeInTheDocument();
    const fileNames = screen.getByRole("combobox", { name: "File names" });
    expect(fileNames).toHaveDisplayValue("Keep the name when the title changes");
    await userEvent.selectOptions(fileNames, "Rename the file after the title");
    expect(fileNames).toHaveDisplayValue("Rename the file after the title");
    expect(
      screen.queryByRole("button", { name: "Import into the app library" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Change folder…" }));
    expect(chooseFolder).toHaveBeenCalled();
  });
});

describe("import and export", () => {
  it("imports .md files from settings and reports the result", async () => {
    const store = await newStore();
    renderApp(store, "/settings");

    // Bypass the picker's filter to check the app's own validation.
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(screen.getByLabelText("Import .md files…"), [
      new File(["# Imported\n\nfrom disk"], "imported.md", { type: "text/markdown" }),
      new File(["no"], "notes.txt"),
    ]);

    expect(await screen.findByText("Imported 1 conspect, 1 not imported.")).toBeInTheDocument();
    expect(screen.getByText("notes.txt: not a Markdown file")).toBeInTheDocument();
    expect((await store.list())[0]?.markdown).toContain("from disk");
  });

  it("exports the library as a ZIP and a note as a .md file", async () => {
    const store = await newStore();
    await store.put(javaNote);
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    URL.createObjectURL = () => "blob:export";
    URL.revokeObjectURL = () => undefined;
    renderApp(store, "/settings");

    await userEvent.click(screen.getByRole("button", { name: "Export all (.zip)" }));
    expect(
      await screen.findByText("Exported 1 conspect as konspecter-conspects.zip."),
    ).toBeInTheDocument();

    await userEvent.click(within(recentNav()).getByRole("link", { name: "Java Collections" }));
    await userEvent.click(await screen.findByRole("button", { name: "Download .md" }));

    expect(downloads).toEqual(["konspecter-conspects.zip", "Java Collections.md"]);
  });
});

describe("backup and recovery", () => {
  async function storeWithCorruptedRecord() {
    databaseCount += 1;
    const name = `app-test-${String(databaseCount)}`;
    const store = await openNoteStore(name);
    await store.put(javaNote);
    const raw = await openDB(name);
    await raw.put("notes", { id: "bad", markdown: 42 }, "bad");
    raw.close();
    return store;
  }

  it("keeps the list usable and points to recovery", async () => {
    renderApp(await storeWithCorruptedRecord());

    expect(await listTitles()).toEqual(["Java Collections"]);
    const banner = await screen.findByRole("note");
    expect(banner).toHaveTextContent("Some stored conspects could not be read");
    expect(within(banner).getByRole("link")).toHaveAttribute("href", "/settings");
  });

  it("lets unreadable records be downloaded, then removed", async () => {
    const store = await storeWithCorruptedRecord();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    URL.createObjectURL = () => "blob:records";
    URL.revokeObjectURL = () => undefined;
    renderApp(store, "/settings");

    const alert = await screen.findByText(/1 stored record could not be read/);
    expect(alert).toBeInTheDocument();
    const remove = screen.getByRole("button", { name: "Remove them" });
    expect(remove).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Download them (.json)" }));
    await userEvent.click(remove);

    expect(await screen.findByText("Unreadable records removed.")).toBeInTheDocument();
    expect(await store.unreadableRecords()).toEqual([]);
    expect(await store.list()).toHaveLength(1);
  });

  it("rebuilds the indexes on request", async () => {
    const store = await newStore();
    await store.put(createNote("#java", new Date(), "n1"));
    renderApp(store, "/settings");

    await userEvent.click(screen.getByRole("button", { name: "Rebuild indexes" }));

    expect(await screen.findByText("Indexes rebuilt from 1 conspect.")).toBeInTheDocument();
  });
});

describe("onboarding", () => {
  it("welcomes a new user and can add an example note", async () => {
    const store = await newStore();
    renderApp(store);

    const welcome = await screen.findByRole("region", { name: "Welcome to Konspecter" });
    expect(
      within(welcome).getByRole("link", { name: "Create your first conspect" }),
    ).toHaveAttribute("href", "/conspects/new");
    await userEvent.click(within(welcome).getByRole("button", { name: "Add an example conspect" }));

    await waitFor(() => {
      expect(document.title).toBe("Welcome to Konspecter · Konspecter");
    });
    // The example opens in the text editor, and its tags reach the sidebar.
    expect(await textEditor()).toHaveTextContent("Headings and lists");
    const tree = await within(sidebar()).findByRole("navigation", { name: "Tags" });
    expect(await within(tree).findByRole("link", { name: "Konspecter" })).toBeInTheDocument();
  });
});

describe("keyboard shortcuts", () => {
  it("opens a new note with Ctrl+N and settings with Ctrl+, from anywhere", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/conspects/java");
    await userEvent.click(await textEditor());

    await userEvent.keyboard("{Control>},{/Control}");
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();

    await userEvent.keyboard("{Control>}n{/Control}");
    expect(await textEditor()).toHaveFocus();
    expect(await textEditor()).toHaveTextContent("");
  });

  it("toggles the sidebar with Ctrl+\\: in to the open note when shown, back to the editor", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/conspects/java");
    await userEvent.click(await textEditor());

    await userEvent.keyboard("{Control>}\\{/Control}");
    expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
    expect(await textEditor()).toHaveFocus();
    await userEvent.keyboard("{Control>}\\{/Control}");
    expect(sidebar()).toBeVisible();
    expect(within(recentNav()).getByRole("link", { name: "Java Collections" })).toHaveFocus();
    await userEvent.keyboard("{Control>}\\{/Control}");
    expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
    expect(await textEditor()).toHaveFocus();
  });

  it("switches between the text and Markdown editors with Ctrl+/, the caret following", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/conspects/java");
    await userEvent.click(await textEditor());

    await userEvent.keyboard("{Control>}/{/Control}");
    const source = await screen.findByRole("textbox", { name: "Markdown" });
    expect(source).toHaveFocus();
    expect(topBarButton("Markdown")).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Control>}/{/Control}");
    expect(await textEditor()).toHaveFocus();
    // Only the switch: CodeMirror's own Mod-/ (comment the line) did not run.
    expect(await store.get("java")).toEqual(javaNote);
  });

  it("starts another new note on Ctrl+N from a new note", async () => {
    const store = await newStore();
    renderApp(store, "/conspects/new");
    await userEvent.type(await textEditor(), "# First{Enter}one");
    await waitFor(async () => {
      expect(await store.list()).toHaveLength(1);
    });

    await userEvent.keyboard("{Control>}n{/Control}");

    await waitFor(async () => {
      expect(await textEditor()).toHaveTextContent("");
    });
    expect(await store.list()).toHaveLength(1);
  });

  it("navigates with single keys, but not while typing", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/conspects/java");
    const editor = await textEditor();
    await userEvent.click(editor);
    caretAtEnd(editor);

    await userEvent.keyboard("n/");
    expect(await textEditor()).toBe(editor);
    expect(editor).toHaveTextContent("dynamic array.n/");
    expect(findBox()).not.toHaveFocus();

    await userEvent.click(within(sidebar()).getByRole("link", { name: "Settings" }));
    await userEvent.keyboard("/");
    expect(searchBox()).toHaveFocus();
    expect(await listTitles()).toHaveLength(1);
  });

  it("goes to every note with Escape, also from the editor", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/conspects/java");
    await userEvent.click(await textEditor());

    await userEvent.keyboard("{Escape}");
    expect(await listTitles()).toEqual(["Java Collections"]);
    expect(screen.queryByRole("textbox", { name: "Conspect text" })).not.toBeInTheDocument();
  });

  it("leaves Escape to dialogs and the search box", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/conspects/java", { ...DEFAULT_SETTINGS, defaultEditor: "markdown" });
    const source = await screen.findByRole("textbox", { name: "Markdown" });

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await userEvent.click(findBox());
    await userEvent.keyboard("{Escape}");
    expect(findBox()).not.toHaveFocus();

    // Ctrl+F is the top bar's search, not CodeMirror's panel.
    await userEvent.click(source);
    await userEvent.keyboard("{Control>}f{/Control}");
    expect(findBox()).toHaveFocus();
    expect(document.querySelector(".cm-search")).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(findBox()).not.toHaveFocus();

    expect(screen.getByRole("textbox", { name: "Markdown" })).toBeInTheDocument();
    expect(await store.get("java")).toEqual(javaNote);
  });

  it("shows the shortcuts dialog and closes it with Escape", async () => {
    renderApp(await newStore());

    await userEvent.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveTextContent("New conspect");
    expect(dialog).toHaveTextContent("Ctrl+P");
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The close button (an icon in the dialog's corner) closes it too.
    await userEvent.keyboard("?");
    const reopened = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    await userEvent.click(within(reopened).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("small screens", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string): Partial<MediaQueryList> => ({
      matches: query === "(max-width: 760px)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    vi.stubGlobal("scrollTo", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const island = () => screen.getByRole("navigation", { name: "Main actions" });
  const islandButton = (name: string) => within(island()).getByRole("button", { name });
  const islandLink = (name: string) => within(island()).getByRole("link", { name });

  async function storeWithNotes() {
    const store = await newStore();
    await store.put(createNote("# Hash maps\n\nBuckets. #java", new Date("2020-01-01"), "maps"));
    await store.put(createNote("# Networking\n\nTCP handshakes.", new Date("2020-02-01"), "net"));
    return store;
  }

  it("gathers the sidebar, the list, search, new note and settings in the island", async () => {
    renderApp(await storeWithNotes());
    expect(await listTitles()).toEqual(["Networking", "Hash maps"]);

    expect(
      [...island().querySelectorAll("button, a")].map((control) =>
        control.getAttribute("aria-label"),
      ),
    ).toEqual(["Show sidebar", "All conspects", "Search conspects", "New conspect", "Settings"]);
    // The top bar keeps theme, mode and activity; the search is in the island.
    expect(within(topBar()).queryByRole("search")).not.toBeInTheDocument();
    expect(within(topBar()).queryByRole("link")).not.toBeInTheDocument();
    expect(topBarButton("Dark theme")).toBeInTheDocument();

    // The sidebar starts hidden; the island opens and closes it.
    expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
    await userEvent.click(islandButton("Show sidebar"));
    expect(sidebar()).toBeInTheDocument();
    expect(islandButton("Hide sidebar")).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(islandButton("Hide sidebar"));
    expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();

    // A link in the island closes the sidebar it covers.
    await userEvent.click(islandButton("Show sidebar"));
    await userEvent.click(islandLink("Settings"));
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
    await userEvent.click(islandLink("New conspect"));
    expect(await textEditor()).toHaveFocus();
  });

  it("turns the island into the search box with a close button, and back", async () => {
    renderApp(await storeWithNotes());
    await noteList();

    await userEvent.click(islandButton("Search conspects"));
    expect(searchBox()).toHaveFocus();
    expect(within(island()).queryByRole("link")).not.toBeInTheDocument();
    await userEvent.keyboard("tcp");
    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Networking"]);
    });

    await userEvent.click(islandButton("Close search"));
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Networking", "Hash maps"]);
    });
    expect(islandButton("Search conspects")).toBeInTheDocument();
  });

  it("shows the search while a tag filters the list, and ends it when a result opens", async () => {
    renderApp(await storeWithNotes(), "/?q=%23java");
    expect(await listTitles()).toEqual(["Hash maps"]);
    expect(within(island()).getByRole("list", { name: "Tag filters" })).toHaveTextContent("#java");

    await userEvent.click(screen.getByRole("link", { name: "Hash maps" }));
    expect(await textEditor()).toHaveTextContent("Buckets.");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("searches the open note from the island", async () => {
    renderApp(await storeWithNotes(), "/conspects/maps");
    const editor = await textEditor();

    await userEvent.click(islandButton("Search in this conspect"));
    expect(findBox()).toHaveFocus();
    await userEvent.keyboard("buck");
    expect(editor.querySelector(".find-match")).toHaveTextContent("Buck");

    await userEvent.click(islandButton("Close search"));
    expect(editor.querySelector(".find-match")).toBeNull();
  });

  it("keeps the note's details behind a button in the sidebar", async () => {
    renderApp(await storeWithNotes(), "/conspects/maps");
    await textEditor();
    await userEvent.click(islandButton("Show sidebar"));

    const toggle = within(sidebar()).getByRole("button", { name: "Details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const details = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(details).toHaveTextContent("Created");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("holds the text editor's tools: the one in effect, and every tool until one is used", async () => {
    renderApp(await storeWithNotes(), "/conspects/maps");
    const editor = await textEditor();
    expect(
      [...island().querySelectorAll("button, a")].map((control) =>
        control.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Show sidebar",
      "All conspects",
      "Search in this conspect",
      "Formatting",
      "New conspect",
      "Settings",
    ]);
    // No toolbar beside the text; the island's button shows the folded toolbar's tool.
    const tools = islandButton("Formatting");
    expect(tools).toHaveTextContent("B");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();

    await userEvent.click(editor);
    caretAtEnd(editor);
    await userEvent.click(tools);
    expect(tools).toHaveAttribute("aria-expanded", "true");
    const toolbar = within(island()).getByRole("toolbar", { name: "Formatting" });
    await userEvent.click(within(toolbar).getByRole("button", { name: "Heading" }));

    expect(editor.querySelector("h2")).toHaveTextContent("Buckets.");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(tools).toHaveAttribute("aria-expanded", "false");
    // The caret is in the heading now: that is the tool in effect.
    expect(tools).toHaveTextContent("H2");

    // Tapping elsewhere closes the tools unused.
    await userEvent.click(tools);
    await userEvent.click(editor);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("has no editor tools in the Markdown source", async () => {
    renderApp(await storeWithNotes(), "/conspects/maps");
    await textEditor();
    await markdownEditor();
    expect(within(island()).queryByRole("button", { name: "Formatting" })).not.toBeInTheDocument();
  });
});
