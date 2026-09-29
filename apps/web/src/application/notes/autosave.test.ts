import { parseDocument } from "../../domain/document/document";
import { createNote, type Note } from "../../domain/note/note";
import { openNoteStore } from "../../infrastructure/storage/note-store";
import { mustGet } from "../../infrastructure/storage/test-utils";
import { Autosave, type AutosaveEvents } from "./autosave";

let count = 0;
const newStore = () => openNoteStore(`autosave-test-${String((count += 1))}`);
const at = (iso: string) => () => new Date(iso);

function events() {
  return {
    onCreated: vi.fn<NonNullable<AutosaveEvents["onCreated"]>>(),
    onSaved: vi.fn<NonNullable<AutosaveEvents["onSaved"]>>(),
    onProblem: vi.fn<NonNullable<AutosaveEvents["onProblem"]>>(),
    onBusy: vi.fn<NonNullable<AutosaveEvents["onBusy"]>>(),
  };
}

describe("a new note", () => {
  it("is created by the first non-blank save, then updated in place", async () => {
    const store = await newStore();
    const on = events();
    const autosave = new Autosave(store, null, on, { now: at("2024-05-01T10:00:00Z") });

    autosave.change(() => "   ");
    await autosave.flush();
    expect(await store.list()).toEqual([]);

    autosave.change(() => "# Draft");
    await autosave.flush();
    const created = on.onCreated.mock.calls[0]?.[0];
    expect(on.onCreated).toHaveBeenCalledWith(expect.objectContaining({}), "new");
    expect(autosave.note?.id).toBe(created?.id);

    autosave.change(() => "# Draft\n\nMore");
    await autosave.flush();
    const notes = await store.list();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.markdown).toContain("More");
    expect(on.onCreated).toHaveBeenCalledTimes(1);
    expect(autosave.dirty).toBe(false);
  });
});

describe("a new note's first save", () => {
  it("waits longer while the first line is typed, so a file gets the whole title", async () => {
    const store = await newStore();
    const create = vi.spyOn(store, "create");
    const autosave = new Autosave(store, null, {}, { delay: 5, createDelay: 60 });

    autosave.change(() => "# Hash m");
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(create).not.toHaveBeenCalled();

    autosave.change(() => "# Hash maps\n\nB");
    await vi.waitFor(() => {
      expect(create).toHaveBeenCalledWith("# Hash maps\n\nB", expect.any(Date));
    });
  });

  it("is stored after the longer delay even if the line is never finished", async () => {
    const store = await newStore();
    const autosave = new Autosave(store, null, {}, { delay: 5, createDelay: 30 });

    autosave.change(() => "# Just a title");
    await vi.waitFor(async () => {
      expect(await store.list()).toHaveLength(1);
    });
  });
});

describe("coalescing", () => {
  it("saves once after a quiet delay, reading the text only then", async () => {
    const store = await newStore();
    const base = createNote("# A", new Date("2024-01-01"), "a");
    await store.put(base);
    const put = vi.spyOn(store, "put");
    const autosave = new Autosave(store, base, {}, { delay: 20 });
    const read = vi.fn(() => "# A\n\nabc");

    autosave.change(() => "# A\n\na");
    autosave.change(() => "# A\n\nab");
    autosave.change(read);
    expect(autosave.dirty).toBe(true);
    expect(read).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(put).toHaveBeenCalledTimes(1);
    });
    await autosave.flush();
    expect(read).toHaveBeenCalledTimes(1);
    expect((await mustGet(store, "a")).markdown).toContain("abc");
  });

  it("saves during continuous typing after the maximum wait", async () => {
    const store = await newStore();
    const base = createNote("# A", new Date("2024-01-01"), "a");
    await store.put(base);
    const put = vi.spyOn(store, "put");
    const autosave = new Autosave(store, base, {}, { delay: 1000, maxWait: 30 });

    const started = Date.now();
    while (Date.now() - started < 120) {
      autosave.change(() => `# A\n\n${String(Date.now())}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(put).toHaveBeenCalled();
    await autosave.dispose();
  });

  it("skips a save when the text did not change", async () => {
    const store = await newStore();
    const base = createNote("# A", new Date("2024-01-01"), "a");
    await store.put(base);
    const put = vi.spyOn(store, "put");
    const autosave = new Autosave(store, base);

    autosave.change(() => base.markdown);
    await autosave.flush();
    expect(put).not.toHaveBeenCalled();
  });

  it("reports busy from the first change until written", async () => {
    const store = await newStore();
    const on = events();
    const autosave = new Autosave(store, null, on);

    autosave.change(() => "# X");
    expect(on.onBusy).toHaveBeenLastCalledWith(true);
    await autosave.flush();
    expect(on.onBusy).toHaveBeenLastCalledWith(false);
    expect(on.onBusy).toHaveBeenCalledTimes(2);
  });
});

describe("dates", () => {
  it("bumps updated and keeps created", async () => {
    const store = await newStore();
    const base = createNote("# A", new Date("2024-01-01T00:00:00Z"), "a");
    await store.put(base);
    const autosave = new Autosave(store, base, {}, { now: at("2024-02-01T00:00:00Z") });

    autosave.change(() => "# A\n\nedited");
    await autosave.flush();
    const { metadata } = parseDocument((await mustGet(store, "a")).markdown);
    expect(metadata.created).toBe("2024-01-01T00:00:00Z");
    expect(metadata.updated).toBe("2024-02-01T00:00:00Z");
  });
});

describe("problems", () => {
  it("does not save invalid frontmatter, and says why", async () => {
    const store = await newStore();
    const on = events();
    const autosave = new Autosave(store, null, on);

    autosave.change(() => "---\ntitle: [\n---\n\nText");
    await autosave.flush();
    expect(await store.list()).toEqual([]);
    expect(on.onProblem).toHaveBeenLastCalledWith(expect.any(Error));
    expect(autosave.dirty).toBe(true);

    autosave.change(() => "---\ntitle: Fixed\n---\n\nText");
    await autosave.flush();
    expect(await store.list()).toHaveLength(1);
    expect(on.onProblem).toHaveBeenLastCalledWith(null);
    expect(autosave.dirty).toBe(false);
  });

  it("keeps the text of a failed write and tries again on flush", async () => {
    const store = await newStore();
    const base = createNote("# A", new Date("2024-01-01"), "a");
    await store.put(base);
    const on = events();
    vi.spyOn(store, "put").mockRejectedValueOnce(new Error("Disk full"));
    const autosave = new Autosave(store, base, on);

    autosave.change(() => "# A\n\nkept");
    await autosave.flush();
    expect(on.onProblem).toHaveBeenLastCalledWith(new Error("Disk full"));
    expect(on.onBusy).toHaveBeenLastCalledWith(false);

    await autosave.flush();
    expect((await mustGet(store, "a")).markdown).toContain("kept");
    expect(on.onProblem).toHaveBeenLastCalledWith(null);
  });
});

describe("conflicts", () => {
  async function changedElsewhere() {
    const store = await newStore();
    const base = createNote("# Shared\n\noriginal", new Date("2024-01-01"), "shared");
    await store.put(base);
    const on = events();
    const autosave = new Autosave(store, base, on, { now: at("2024-03-01T12:00:00Z") });
    const theirs: Note = { id: "shared", markdown: "# Shared\n\ntheirs" };
    await store.put(theirs);
    return { store, autosave, on, theirs };
  }

  it("saves over a version changed elsewhere as a conflict copy, and continues there", async () => {
    const { store, autosave, on, theirs } = await changedElsewhere();

    autosave.change(() => "# Shared\n\nmine");
    await autosave.flush();

    expect((await mustGet(store, "shared")).markdown).toBe(theirs.markdown);
    const copy = on.onCreated.mock.calls[0]?.[0];
    expect(on.onCreated.mock.calls[0]?.[1]).toBe("conflict");
    const { metadata, body } = parseDocument(copy?.markdown ?? "");
    expect(metadata.conflictOf).toBe("shared");
    expect(metadata.title).toBe("Shared (conflict copy 2024-03-01 12:00 UTC)");
    expect(body).toContain("mine");

    autosave.change(() => "# Shared\n\nmine, more");
    await autosave.flush();
    expect(await store.list()).toHaveLength(2);
    expect((await mustGet(store, copy?.id ?? "")).markdown).toContain("mine, more");
  });

  it("keeps text typed while the copy was written in the copy", async () => {
    const { store, autosave, on } = await changedElsewhere();
    const create = store.create.bind(store);
    vi.spyOn(store, "create").mockImplementation(async (markdown, now) => {
      autosave.change(() => "# Shared\n\nmine, typed meanwhile");
      return create(markdown, now);
    });

    autosave.change(() => "# Shared\n\nmine");
    await autosave.flush();

    const copy = on.onCreated.mock.calls[0]?.[0];
    const { metadata, body } = parseDocument(copy?.markdown ?? "");
    expect(body).toContain("typed meanwhile");
    expect(metadata.conflictOf).toBe("shared");
    expect((await mustGet(store, copy?.id ?? "")).markdown).toBe(copy?.markdown);
    expect(autosave.dirty).toBe(false);
  });

  it("treats a write refused as changed underneath as a conflict", async () => {
    const store = await newStore();
    const base = createNote("# A", new Date("2024-01-01"), "a");
    await store.put(base);
    const on = events();
    const refused = new Error("changed on disk");
    vi.spyOn(store, "put").mockRejectedValueOnce(refused);
    const autosave = new Autosave(store, base, on, {
      changedUnderneath: (error) => error === refused,
    });

    autosave.change(() => "# A\n\nmine");
    await autosave.flush();
    expect(on.onCreated).toHaveBeenCalledWith(expect.anything(), "conflict");
  });

  it("adopts a version reloaded from elsewhere", async () => {
    const { store, autosave, theirs } = await changedElsewhere();

    autosave.rebase(theirs);
    autosave.change(() => "# Shared\n\ntheirs, edited");
    await autosave.flush();
    expect(await store.list()).toHaveLength(1);
    expect((await mustGet(store, "shared")).markdown).toContain("theirs, edited");
  });
});

describe("dispose", () => {
  it("drops pending changes and waits for a write in flight", async () => {
    const store = await newStore();
    const base = createNote("# A", new Date("2024-01-01"), "a");
    await store.put(base);
    const put = vi.spyOn(store, "put");
    const autosave = new Autosave(store, base, {}, { delay: 5 });

    autosave.change(() => "# A\n\nfirst");
    const flushing = autosave.flush();
    autosave.change(() => "# A\n\nsecond");
    await autosave.dispose();
    await flushing;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(put).toHaveBeenCalledTimes(1);
    autosave.change(() => "# A\n\nthird");
    await autosave.flush();
    expect(put).toHaveBeenCalledTimes(1);
  });
});
