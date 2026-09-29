import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ReadingPositionMode } from "../../domain/reading/reading";
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

function renderNote(store: NoteStore, mode: ReadingPositionMode) {
  return render(
    <MemoryRouter initialEntries={["/notes/n"]}>
      <Routes>
        <Route
          path="notes/:id"
          element={
            <NotePage store={store} mode="text" activity={new Activity()} readingPosition={mode} />
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
    expect(offer).toHaveTextContent("You were 42% through this note.");
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
