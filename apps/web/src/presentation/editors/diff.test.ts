import { diffSequences, textChanges } from "./diff";

/** Applies changes (in positions of `a`) the way an editor does. */
function apply(a: string, changes: { from: number; to: number; insert: string }[]): string {
  let result = a;
  for (const change of [...changes].reverse()) {
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  return result;
}

/** The test texts are ASCII: one item per character. */
const chars = (text: string) => Array.from(text);
const same = (x: string, y: string) => x === y;

describe("diffSequences", () => {
  it("finds each differing stretch and leaves the rest", () => {
    expect(diffSequences(chars("abcdef"), chars("aXcdeY"), same)).toEqual([
      { fromA: 1, toA: 2, fromB: 1, toB: 2 },
      { fromA: 5, toA: 6, fromB: 5, toB: 6 },
    ]);
    expect(diffSequences(chars("abc"), chars("abc"), same)).toEqual([]);
    expect(diffSequences([], chars("ab"), same)).toEqual([{ fromA: 0, toA: 0, fromB: 0, toB: 2 }]);
    expect(diffSequences(chars("ab"), [], same)).toEqual([{ fromA: 0, toA: 2, fromB: 0, toB: 0 }]);
  });

  it("handles insertions, deletions and moves", () => {
    const cases: [string, string][] = [
      ["abcabba", "cbabac"],
      ["kitten", "sitting"],
      ["aaaa", "aa"],
      ["", ""],
      ["x", "y"],
    ];
    for (const [a, b] of cases) {
      const hunks = diffSequences(chars(a), chars(b), same) ?? [];
      // Rebuilding b from a and the hunks gives b back.
      let rebuilt = "";
      let x = 0;
      for (const hunk of hunks) {
        rebuilt += a.slice(x, hunk.fromA) + b.slice(hunk.fromB, hunk.toB);
        x = hunk.toA;
      }
      expect(rebuilt + a.slice(x)).toBe(b);
    }
  });

  it("rebuilds b from a for many random pairs, keeping every match it reports", () => {
    let seed = 42;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const word = () =>
      Array.from({ length: Math.floor(random() * 12) }, () => "abc"[Math.floor(random() * 3)]).join(
        "",
      );
    for (let run = 0; run < 500; run += 1) {
      const a = word();
      const b = word();
      const hunks = diffSequences(chars(a), chars(b), same) ?? [];
      let rebuilt = "";
      let x = 0;
      let y = 0;
      for (const hunk of hunks) {
        // Between hunks, a and b match.
        expect(a.slice(x, hunk.fromA)).toBe(b.slice(y, hunk.fromB));
        rebuilt += a.slice(x, hunk.fromA) + b.slice(hunk.fromB, hunk.toB);
        x = hunk.toA;
        y = hunk.toB;
      }
      expect(a.slice(x)).toBe(b.slice(y));
      expect(rebuilt + a.slice(x)).toBe(b);
    }
  });

  it("gives up on sequences too different to be worth it", () => {
    const a = Array.from({ length: 600 }, (_, i) => `a${String(i)}`);
    const b = Array.from({ length: 600 }, (_, i) => `b${String(i)}`);
    expect(diffSequences(a, b, same)).toBeNull();
  });
});

describe("textChanges", () => {
  it("touches only the lines that changed, narrowed to their characters", () => {
    const a = "---\nupdated: 2026-09-29T10:00:00Z\n---\n# Java\n\nfirst paragraph\n\nsecond";
    const b =
      "---\nupdated: 2026-09-29T10:05:00Z\n---\n# Java\n\nfirst paragraph\n\nsecond, edited";

    const changes = textChanges(a, b);

    expect(changes).toHaveLength(2);
    const firstLine = a.indexOf("first paragraph");
    for (const change of changes) {
      expect(change.to <= firstLine || change.from >= firstLine + "first paragraph".length).toBe(
        true,
      );
    }
    expect(apply(a, changes)).toBe(b);
  });

  it("turns any text into any other", () => {
    const texts = ["", "one", "one\n", "one\ntwo\nthree", "two\nthree\nfour\n", "\n\n", "x\ny"];
    for (const a of texts) {
      for (const b of texts) expect(apply(a, textChanges(a, b))).toBe(b);
    }
  });
});
