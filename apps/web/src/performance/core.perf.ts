/**
 * Performance measurements of the core logic. Run with
 * `pnpm --filter @konspecter/web bench`; results are in docs/performance.md.
 */
import { Bench } from "tinybench";
import { parseDocument } from "../domain/document/document";
import { plainText } from "../domain/document/plain-text";
import { readNotes, type Note } from "../domain/note/note";
import { parseQuery } from "../domain/search/query";
import { parseTags } from "../domain/tag/tags";
import { SearchIndex } from "../infrastructure/search/search-index";
import { FakeServer } from "../infrastructure/sync/fake-server";
import { SyncEngine } from "../infrastructure/sync/sync-engine";
import { openNoteStore } from "../infrastructure/storage/note-store";
import { syntheticNote } from "./generate";

const small = syntheticNote(1, 4);
const large = syntheticNote(2, 200);
const library = (count: number): Note[] =>
  Array.from({ length: count }, (_, i) => ({ id: `n${String(i)}`, markdown: syntheticNote(i, 4) }));
const thousand = library(1000);
const fiveThousand = library(5000);
const index5k = new SearchIndex(fiveThousand);

function time(label: string, run: () => void | Promise<void>) {
  return async () => {
    const start = performance.now();
    await run();
    return { label, ms: performance.now() - start };
  };
}

it("measures the core logic", { timeout: 300_000 }, async () => {
  const bench = new Bench({ time: 500 });
  bench
    .add("parseDocument 4 KB", () => parseDocument(small))
    .add("parseDocument 200 KB", () => parseDocument(large))
    .add("parseTags 200 KB body", () => parseTags(parseDocument(large).body))
    .add("plainText 200 KB body", () => plainText(parseDocument(large).body))
    .add("readNotes + sort, 1,000 notes", () => readNotes(thousand))
    .add("readNotes + sort, 5,000 notes", () => readNotes(fiveThousand))
    .add("search 'hash map', 5,000 notes", () => index5k.search(parseQuery("hash map")))
    .add("search 'que #topic3', 5,000 notes", () => index5k.search(parseQuery("que #topic3")));
  await bench.run();
  for (const task of bench.tasks) {
    const result = task.result;
    if (result.state !== "completed") continue;
    console.log(
      `PERF ${task.name}: mean ${result.latency.mean.toFixed(3)} ms, p99 ${result.latency.p99.toFixed(3)} ms`,
    );
  }

  const oneOff = [];
  oneOff.push(
    await time("build search index, 1,000 notes", () => {
      expect(new SearchIndex(thousand)).toBeDefined();
    })(),
  );
  oneOff.push(
    await time("build search index, 5,000 notes", () => {
      expect(new SearchIndex(fiveThousand)).toBeDefined();
    })(),
  );
  // The longest time the page is blocked while the index builds in chunks.
  let longest = 0;
  let last = performance.now();
  const probe = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 0);
  oneOff.push(
    await time("build search index in chunks, 5,000 notes", async () => {
      await SearchIndex.build(fiveThousand);
    })(),
  );
  clearInterval(probe);
  oneOff.push({ label: "longest main-thread block during chunked build", ms: longest });

  const store = await openNoteStore("perf-store");
  oneOff.push(
    await time("store.put × 1,000 (with tag index)", async () => {
      for (const note of thousand) await store.put(note);
    })(),
  );
  oneOff.push(
    await time("store.list + readNotes, 1,000", async () => void readNotes(await store.list()))(),
  );
  oneOff.push(await time("rebuild tag index, 1,000", () => store.rebuildIndexes())());

  const server = new FakeServer();
  server.maxMarkdownLength = 5 * 1024 * 1024;
  const engine = new SyncEngine(store, {
    fetch: server.fetch,
    scheduler: { set: () => null, clear: () => undefined },
    isOnline: () => true,
  });
  oneOff.push(
    await time("first sync: push 1,000 notes", () =>
      engine.connect({ serverUrl: "https://s", token: "ksp_ada" }).then(() => undefined),
    )(),
  );
  const other = await openNoteStore("perf-store-2");
  const engine2 = new SyncEngine(other, {
    fetch: server.fetch,
    scheduler: { set: () => null, clear: () => undefined },
    isOnline: () => true,
  });
  oneOff.push(
    await time("first sync: pull 1,000 notes", () =>
      engine2.connect({ serverUrl: "https://s", token: "ksp_ada" }).then(() => undefined),
    )(),
  );
  oneOff.push(await time("idle sync cycle (nothing to do)", () => engine2.syncNow())());
  for (const { label, ms } of oneOff) console.log(`PERF ${label}: ${ms.toFixed(1)} ms`);
  expect(server.notes.size).toBe(1000);
  expect((await other.list()).length).toBe(1000);
});
