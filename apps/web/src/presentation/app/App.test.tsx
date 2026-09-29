import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openDB } from "idb";
import { MemoryRouter } from "react-router";
import { parseDocument } from "../../domain/document/document";
import { parseQuery } from "../../domain/search/query";
import { DEFAULT_SETTINGS, type Settings } from "../../domain/settings/settings";
import { createNote, type Note } from "../../domain/note/note";
import { openNoteStore, type NoteStore } from "../../infrastructure/storage/note-store";
import { setSourceValue, sourceValue } from "../editors/test-helpers";
import { FakeFolder } from "../../infrastructure/folder/fake-folder";
import { FolderStore } from "../../infrastructure/folder/folder-store";
import { FakeServer } from "../../infrastructure/sync/fake-server";
import { SyncEngine } from "../../infrastructure/sync/sync-engine";
import type { NoteRepository } from "../../application/notes/note-repository";
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
const textEditor = () => screen.findByRole("textbox", { name: "Note text" });

/** Switches to Markdown mode (the top bar's toggle) and returns the source text box. */
async function markdownEditor() {
  await userEvent.click(topBarButton("Markdown"));
  return screen.findByRole("textbox", { name: "Markdown" });
}

const sidebar = () => screen.getByRole("complementary", { name: "Sidebar" });
const topBar = () => screen.getByRole("banner");
const topBarButton = (name: string) => within(topBar()).getByRole("button", { name });
const searchBox = () => screen.getByRole("searchbox", { name: "Search notes" });
const noteList = () => screen.findByRole("list", { name: "Notes" });
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

  it("hides and shows the sidebar, and remembers the choice", async () => {
    renderApp(await newStore());

    await userEvent.click(within(sidebar()).getByRole("button", { name: "Hide sidebar" }));
    expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
    expect(localStorage.getItem("konspecter.sidebar")).toBe("closed");
    // Its controls move to the top bar meanwhile.
    expect(within(topBar()).getByRole("link", { name: "New note" })).toBeInTheDocument();

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

    await userEvent.click(within(sidebar()).getByRole("link", { name: "New note" }));
    expect(await textEditor()).toHaveFocus();
  });

  it("shows not found for an unknown route", async () => {
    renderApp(await newStore(), "/nowhere");

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});

describe("the note list", () => {
  it("lists every note, most recently edited first, here and in the sidebar", async () => {
    const store = await newStore();
    await store.put(emptyNote);
    await store.put(javaNote);
    await store.put(brokenNote);
    renderApp(store);

    expect(await listTitles()).toEqual(["Java Collections", "Untitled", "Unreadable note"]);
    const list = await noteList();
    expect(within(list).getByRole("link", { name: "Java Collections" })).toHaveAttribute(
      "href",
      "/notes/java",
    );
    expect(within(list).getByText("ArrayList — dynamic array.")).toBeInTheDocument();
    expect(recentTitles()).toEqual(["Java Collections", "Untitled", "Unreadable note"]);
  });

  it("shows an error when notes cannot be loaded, and retries", async () => {
    const store = await newStore();
    await store.put(javaNote);
    vi.spyOn(store, "list").mockRejectedValueOnce(new Error("Disk on fire"));
    renderApp(store);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load notes");
    expect(alert).toHaveTextContent("Disk on fire");

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

    await userEvent.click(within(sidebar()).getByRole("link", { name: "New note" }));
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
    expect(recentTitles()).toEqual(["Hash maps"]);
    expect(within(recentNav()).getByRole("link", { name: "Hash maps" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // There is no save button to press.
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("stores nothing when left blank", async () => {
    const store = await newStore();
    renderApp(store, "/notes/new");

    await textEditor();
    await userEvent.click(within(sidebar()).getByRole("link", { name: "Settings" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await store.list()).toEqual([]);
  });

  it("does not save invalid frontmatter, and explains why", async () => {
    const store = await newStore();
    renderApp(store, "/notes/new");

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
    renderApp(store, "/notes/new");

    const editor = await textEditor();
    await userEvent.type(editor, "Important{Enter}text");

    expect(await screen.findByRole("alert")).toHaveTextContent("Quota exceeded");
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
    renderApp(store, "/notes/c");

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
    renderApp(store, "/notes/java");

    await textEditor();
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Title and cover" });
    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Collections");
    await stored(store, "java", (markdown) => markdown.includes("title: Collections"));
    expect(await textEditor()).toHaveTextContent("ArrayList");
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
    renderApp(store, "/notes/maps");

    expect(await screen.findByRole("table")).toHaveTextContent("TreeMap");
    expect(screen.getByRole("status")).toHaveTextContent("This note uses tables");
    expect(document.querySelector("pre code.language-java .hljs-keyword")).toHaveTextContent("new");

    const editor = await markdownEditor();
    expect(sourceValue(editor)).toContain("| TreeMap | sorted |");
  });

  it("edits the whole document and bumps only the updated date", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/notes/java");

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
    renderApp(store, "/notes/java");

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
    renderApp(store, "/notes/broken");

    const source = await screen.findByRole("textbox", { name: "Markdown" });
    expect(screen.getByRole("status")).toHaveTextContent("Text editing is unavailable");
    setSourceValue(source, "---\ntitle: Repaired\n---\n\nStill here.");

    await stored(store, "broken", (markdown) => markdown.includes("Repaired"));
    expect(await screen.findByRole("heading", { level: 1, name: "Repaired" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows not found for an unknown note", async () => {
    renderApp(await newStore(), "/notes/missing");

    expect(await screen.findByRole("heading", { name: "Note not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to notes" })).toHaveAttribute("href", "/");
  });

  it("is deleted after confirmation", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/notes/java");

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete this note?" });
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
    renderApp(store, "/notes/java");

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
    expect(within(javaRow).getByLabelText("2 notes")).toBeInTheDocument();
    expect(within(tree).queryByRole("link", { name: "Collections" })).not.toBeInTheDocument();

    await userEvent.click(within(tree).getByRole("button", { name: "Expand #java" }));
    expect(within(tree).getByRole("link", { name: "Collections" })).toHaveAttribute(
      "href",
      "/?q=%23java%23collections",
    );
    expect(within(tree).getByRole("button", { name: "Collapse #java" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // #java has only child tags; its notes sit inside them.
    expect(within(javaRow).queryByRole("link", { name: "Lists" })).not.toBeInTheDocument();

    await userEvent.click(within(tree).getByRole("button", { name: "Expand #java#collections" }));
    expect(await within(tree).findByRole("link", { name: "Lists" })).toHaveAttribute(
      "href",
      "/notes/lists",
    );
    await userEvent.click(within(tree).getByRole("button", { name: "Expand #fp" }));
    // The note "Streams" (in #fp), beside the tag folder of the same name.
    await waitFor(() => {
      expect(
        within(tree)
          .getAllByRole("link", { name: "Streams" })
          .map((link) => link.getAttribute("href")),
      ).toEqual(["/notes/streams", "/?q=%23java%23streams"]);
    });
    expect(within(tree).queryByRole("link", { name: "Untagged" })).not.toBeInTheDocument();
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
      "/?q=%23java%23linked_list",
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
    await userEvent.click(within(tree).getByRole("button", { name: "Expand #parent_1" }));
    await userEvent.click(within(tree).getByRole("button", { name: "Expand #parent_1#child" }));
    expect(await within(tree).findByRole("link", { name: "Meta" })).toHaveAttribute(
      "href",
      "/notes/m",
    );
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
    expect(tree).toHaveTextContent("Write #tag or #parent#child in a note.");
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

  it("narrows to a child tag", async () => {
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

  it("opens with Ctrl+P from a note, listing every note by recent edit", async () => {
    renderApp(await storeWithNotes(), "/notes/maps");
    const editor = await textEditor();
    await userEvent.click(editor);

    await userEvent.keyboard("{Control>}p{/Control}");

    expect(searchBox()).toHaveFocus();
    expect(await listTitles()).toEqual(["Хеш-таблицы", "Networking", "Hash maps"]);
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
      "/notes/maps",
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

    expect(await screen.findByRole("heading", { name: "No matching notes" })).toBeInTheDocument();
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

  it("shows the list when the search box is clicked on a note, and opens results", async () => {
    renderApp(await storeWithNotes(), "/notes/net");
    await textEditor();

    await userEvent.click(searchBox());
    expect(await listTitles()).toHaveLength(3);
    await userEvent.keyboard("tcp");
    await waitFor(async () => {
      expect(await listTitles()).toEqual(["Networking"]);
    });
    await userEvent.keyboard("{Enter}");

    expect(await textEditor()).toHaveTextContent("TCP handshakes.");
  });
});

describe("settings and the top bar", () => {
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

  it("names tags with a capital first letter, or as written", async () => {
    const store = await newStore();
    await store.put(createNote("# N\n\n#новые_технологии", new Date(), "n"));
    renderWithSettings(store, "/settings");

    const tree = await within(sidebar()).findByRole("navigation", { name: "Tags" });
    expect(await within(tree).findByRole("link", { name: "Новые технологии" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "As written in notes" }));
    expect(await within(tree).findByRole("link", { name: "новые технологии" })).toBeInTheDocument();
    await waitFor(async () => {
      expect(await store.loadSettings()).toMatchObject({ tagNames: "as-written" });
    });
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
    renderWithSettings(store, "/notes/java");

    await textEditor();
    expect(topBarButton("Markdown")).toHaveAttribute("aria-pressed", "false");
    const source = await markdownEditor();

    expect(sourceValue(source)).toBe(javaNote.markdown);
    expect(topBarButton("Markdown")).toHaveAttribute("aria-pressed", "true");
    await waitFor(async () => {
      expect(await store.loadSettings()).toMatchObject({ defaultEditor: "markdown" });
    });

    await userEvent.click(within(sidebar()).getByRole("link", { name: "New note" }));
    expect(await screen.findByRole("textbox", { name: "Markdown" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Note text" })).not.toBeInTheDocument();
  });

  it("opens editors in the default mode chosen in settings", async () => {
    const store = await newStore();
    renderWithSettings(store, "/settings");

    await userEvent.click(screen.getByRole("radio", { name: "Markdown" }));
    await userEvent.click(within(sidebar()).getByRole("link", { name: "New note" }));

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
    renderWithSettings(store, "/notes/java", { ...DEFAULT_SETTINGS, readingPosition: "ask" });

    expect(await screen.findByText("You were 50% through this note.")).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: "Keep my notes on this device" }));

    expect(await screen.findByText(/stored persistently on this device/)).toBeInTheDocument();
    Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });
  });

  it("shows an error but keeps the change when saving fails", async () => {
    const store = await newStore();
    vi.spyOn(store, "saveSettings").mockRejectedValueOnce(new Error("Read-only"));
    renderWithSettings(store, "/settings");

    await userEvent.click(screen.getByRole("radio", { name: "Light" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save settings: Read-only",
    );
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("lists the keyboard shortcuts", async () => {
    renderWithSettings(await newStore(), "/settings");

    const section = screen.getByRole("region", { name: "Keyboard shortcuts" });
    expect(section).toHaveTextContent("Ctrl+PSearch");
    expect(section).toHaveTextContent("Ctrl+NNew note");
    expect(section).toHaveTextContent("Ctrl+,Settings");
  });
});

describe("the dates a save writes", () => {
  it("appear in the Markdown source at once, next to what is typed", async () => {
    const store = await newStore();
    const settings: Settings = { ...DEFAULT_SETTINGS, defaultEditor: "markdown" };
    renderApp(store, "/notes/new", settings);
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
    renderApp(store, "/notes/new", settings);
    const box = await screen.findByRole("textbox", {
      name: settings?.defaultEditor === "markdown" ? "Markdown" : "Note text",
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
    renderApp(store, "/notes/maps");

    await textEditor();
    const region = await within(sidebar()).findByRole("region", { name: "Details" });
    expect(region).toHaveTextContent("Created");
    expect(region).toHaveTextContent("7 words");
    expect(within(region).getByRole("link", { name: "#java#collections" })).toHaveAttribute(
      "href",
      "/?q=%23java%23collections",
    );
    expect(region).toHaveTextContent("authorAnn");
    const actions = within(region).getByRole("group", { name: "Note actions" });
    expect(within(actions).getByRole("button", { name: "Delete" })).toHaveAttribute(
      "title",
      "Delete",
    );

    await userEvent.click(within(sidebar()).getByRole("link", { name: "Maps" }));
    await userEvent.click(within(sidebar()).getByRole("link", { name: "Settings" }));
    expect(details()).not.toBeInTheDocument();
  });

  it("shows a new note's details before it is saved", async () => {
    renderApp(await newStore(), "/notes/new");

    const region = await within(sidebar()).findByRole("region", { name: "Details" });
    expect(region).toHaveTextContent("Not saved yet");
    expect(within(region).getByRole("button", { name: "Title and cover" })).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});

describe("the antenna", () => {
  it("transmits while a change is being saved, then rests", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/notes/java");

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
    render(
      <MemoryRouter>
        <App store={store} sync={sync} />
      </MemoryRouter>,
    );

    expect(
      await within(topBar()).findByRole("link", { name: "Sync: 1 not synced" }),
    ).toHaveAttribute("href", "/settings");
  });

  it("saves an edit as a conflict copy when a sync replaced the note meanwhile", async () => {
    const store = await newStore();
    await store.put(javaNote);
    // Synced: the server's version may replace it.
    await store.markPushed("java", { revision: 1, markdown: javaNote.markdown });
    renderApp(store, "/notes/java");
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
      () => {
        expect(screen.getByRole("note")).toHaveTextContent("This is a conflict copy");
      },
      { timeout: 3000 },
    );
    const banner = screen.getByRole("note");
    expect(within(banner).getByRole("link", { name: "the original" })).toHaveAttribute(
      "href",
      "/notes/java",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: /My edit \(conflict copy/ }),
    ).toBeInTheDocument();
    expect((await store.get("java"))?.markdown).toBe("# From another device");
    expect(await store.list()).toHaveLength(2);
  });
});

describe("file mode", () => {
  async function folderApp(path = "/") {
    const folder = new FakeFolder();
    const store = new FolderStore(folder, await newStore(), { graceMs: 5 });
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
    const { folder, render: show } = await folderApp("/notes/new");
    show();

    await userEvent.type(await textEditor(), "# Fresh idea{Enter}Body");
    await waitFor(() => {
      expect(folder.files.has("Fresh idea.md")).toBe(true);
    });

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete this note?" });
    expect(dialog).toHaveTextContent("will be moved to the system trash");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByRole("heading", { name: "Welcome to Konspecter" }),
    ).toBeInTheDocument();
    expect(folder.trashed).toEqual(["Fresh idea.md"]);
  });

  it("updates the list and the open note when files change on disk", async () => {
    const { folder, store, render: show } = await folderApp("/notes/live.md");
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
    const { folder, store, render: show } = await folderApp("/notes/old.md");
    folder.edit("old.md", "# Moving");
    await store.watch();
    show();
    expect(await textEditor()).toHaveTextContent("Moving");

    folder.move("old.md", "archive/new.md");
    folder.notify({ paths: ["old.md", "archive/new.md"], rescan: false });

    await waitFor(() => {
      const link = within(recentNav()).getByRole("link", { name: "Moving" });
      expect(link).toHaveAttribute("href", "/notes/archive%2Fnew.md");
      expect(link).toHaveAttribute("aria-current", "page");
    });
    expect(await textEditor()).toHaveTextContent("Moving");
  });

  it("opens a note in the external editor", async () => {
    const { folder, render: show } = await folderApp("/notes/ext.md");
    folder.edit("ext.md", "# External");
    show();

    await userEvent.click(await screen.findByRole("button", { name: "Open in external editor" }));
    await userEvent.click(screen.getByRole("button", { name: "Show in Finder" }));

    expect(folder.opened).toEqual(["ext.md"]);
    expect(folder.revealed).toEqual(["ext.md"]);
  });

  it("keeps both versions when a file changes on disk during an edit", async () => {
    const { folder, store, render: show } = await folderApp("/notes/race.md");
    folder.edit("race.md", "# Race\n\noriginal");
    await store.watch();
    show();
    await textEditor();
    const editor = await markdownEditor();
    setSourceValue(editor, "# Race\n\nmy edit");

    folder.edit("race.md", "# Race\n\nsaved in VS Code");
    folder.notify({ paths: ["race.md"], rescan: false });

    expect(
      await screen.findByText(/This is a conflict copy/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(folder.files.get("race.md")?.text).toBe("# Race\n\nsaved in VS Code");
    const copy = [...folder.files].find(([path]) => path !== "race.md");
    expect(copy?.[1].text).toContain("my edit");
    expect(copy?.[1].text).toContain("conflict_of: race.md");
  });

  it("keeps both versions when the file changes just before saving", async () => {
    const { folder, render: show } = await folderApp("/notes/race.md");
    folder.edit("race.md", "# Race\n\noriginal");
    show();
    await textEditor();
    const editor = await markdownEditor();
    // Written by another program, not yet reported by the watcher.
    folder.edit("race.md", "# Race\n\nunreported change");
    setSourceValue(editor, "# Race\n\nmy edit");

    expect(
      await screen.findByText(/This is a conflict copy/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(folder.files.get("race.md")?.text).toBe("# Race\n\nunreported change");
  });

  it("shows the library choice in settings", async () => {
    const store = await newStore();
    const importFolderSpy = vi.fn(() =>
      Promise.resolve({ imported: 3, duplicates: 0, rejected: [] }),
    );
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App
          store={store}
          library={{
            folder: "/Users/ada/Notes",
            chooseFolder: () => Promise.resolve(),
            closeFolder: () => Promise.resolve(),
            importFolder: importFolderSpy,
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("/Users/ada/Notes")).toBeInTheDocument();
    expect(screen.getByText(/Sync applies to the app library/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Import into the app library" }));
    expect(await screen.findByText("Imported 3 notes into the app library.")).toBeInTheDocument();
    expect(importFolderSpy).toHaveBeenCalled();
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

    expect(await screen.findByText("Imported 1 note, 1 not imported.")).toBeInTheDocument();
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
    expect(await screen.findByText("Exported 1 note as konspecter-notes.zip.")).toBeInTheDocument();

    await userEvent.click(within(recentNav()).getByRole("link", { name: "Java Collections" }));
    await userEvent.click(await screen.findByRole("button", { name: "Download .md" }));

    expect(downloads).toEqual(["konspecter-notes.zip", "Java Collections.md"]);
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
    expect(banner).toHaveTextContent("Some stored notes could not be read");
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

    expect(await screen.findByText("Indexes rebuilt from 1 note.")).toBeInTheDocument();
  });
});

describe("onboarding", () => {
  it("welcomes a new user and can add an example note", async () => {
    const store = await newStore();
    renderApp(store);

    const welcome = await screen.findByRole("region", { name: "Welcome to Konspecter" });
    expect(within(welcome).getByRole("link", { name: "Create your first note" })).toHaveAttribute(
      "href",
      "/notes/new",
    );
    await userEvent.click(within(welcome).getByRole("button", { name: "Add an example note" }));

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
    renderApp(store, "/notes/java");
    await userEvent.click(await textEditor());

    await userEvent.keyboard("{Control>},{/Control}");
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();

    await userEvent.keyboard("{Control>}n{/Control}");
    expect(await textEditor()).toHaveFocus();
    expect(await textEditor()).toHaveTextContent("");
  });

  it("toggles the sidebar with Ctrl+\\ and keeps the caret in the editor", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/notes/java");
    await userEvent.click(await textEditor());

    await userEvent.keyboard("{Control>}\\{/Control}");
    expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
    expect(await textEditor()).toHaveFocus();
    await userEvent.keyboard("{Control>}\\{/Control}");
    expect(sidebar()).toBeVisible();
    expect(await textEditor()).toHaveFocus();
  });

  it("switches between the text and Markdown editors with Ctrl+/, the caret following", async () => {
    const store = await newStore();
    await store.put(javaNote);
    renderApp(store, "/notes/java");
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
    renderApp(store, "/notes/new");
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
    renderApp(store, "/notes/java");
    const editor = await textEditor();
    await userEvent.click(editor);
    caretAtEnd(editor);

    await userEvent.keyboard("n/");
    expect(await textEditor()).toBe(editor);
    expect(editor).toHaveTextContent("dynamic array.n/");
    expect(searchBox()).not.toHaveFocus();

    await userEvent.click(within(sidebar()).getByRole("link", { name: "Settings" }));
    await userEvent.keyboard("/");
    expect(searchBox()).toHaveFocus();
    expect(await listTitles()).toHaveLength(1);
  });

  it("shows the shortcuts dialog and closes it with Escape", async () => {
    renderApp(await newStore());

    await userEvent.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveTextContent("New note");
    expect(dialog).toHaveTextContent("Ctrl+P");
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
