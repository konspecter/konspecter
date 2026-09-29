/** A stretch that differs: `a[fromA, toA)` became `b[fromB, toB)`. */
export type Hunk = {
  readonly fromA: number;
  readonly toA: number;
  readonly fromB: number;
  readonly toB: number;
};

/** Beyond this many inserted or deleted items the sequences count as unrelated. */
const MAX_EDITS = 500;

/**
 * The stretches where `b` differs from `a`, in order, with everything in
 * between left as it is (Myers' O(ND) diff). Editors apply them one by one,
 * so text outside them, and a caret in it, stays where it is. Null when the
 * sequences are too different to be worth it: replace the whole then.
 */
export function diffSequences<T>(
  a: readonly T[],
  b: readonly T[],
  equal: (x: T, y: T) => boolean,
): Hunk[] | null {
  const n = a.length;
  const m = b.length;
  // Round d finds the furthest x reachable with d edits on each diagonal
  // k = x - y, reading the previous round's (stored at index k + d + 1). Every
  // round's input is kept, so the path can be traced back.
  const rounds: Int32Array[] = [];
  let furthest = new Int32Array(3); // Round 0 reads diagonal 1 as x = 0.
  for (let d = 0; d <= Math.min(n + m, MAX_EDITS); d += 1) {
    const previous = furthest;
    rounds.push(previous);
    const at = (k: number) => previous[k + d + 1] ?? 0;
    furthest = new Int32Array(2 * d + 5);
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? at(k + 1) : at(k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && equal(a[x] as T, b[y] as T)) {
        x += 1;
        y += 1;
      }
      furthest[k + d + 2] = x;
      if (x >= n && y >= m) return hunks(traceBack(rounds, n, m), n, m);
    }
  }
  return null;
}

/** The runs where a and b match, from the end to the start, as [x, y, length]. */
function traceBack(
  rounds: readonly Int32Array[],
  n: number,
  m: number,
): [number, number, number][] {
  const matches: [number, number, number][] = [];
  let x = n;
  let y = m;
  for (let d = rounds.length - 1; d > 0; d -= 1) {
    const previous = rounds[d] as Int32Array; // round d's input: after round d - 1
    const at = (k: number) => previous[k + d + 1] ?? 0;
    const k = x - y;
    const fromK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const fromX = at(fromK);
    const fromY = fromX - fromK;
    // After the step from (fromX, fromY) comes a run of matches up to (x, y).
    const startX = fromK === k + 1 ? fromX : fromX + 1;
    const length = x - startX;
    if (length > 0) matches.push([startX, startX - k, length]);
    x = fromX;
    y = fromY;
  }
  if (x > 0) matches.push([0, 0, x]); // Round 0: a common start.
  return matches.reverse();
}

function hunks(matches: readonly [number, number, number][], n: number, m: number): Hunk[] {
  const result: Hunk[] = [];
  let x = 0;
  let y = 0;
  for (const [matchX, matchY, length] of [...matches, [n, m, 0] as [number, number, number]]) {
    if (matchX > x || matchY > y) result.push({ fromA: x, toA: matchX, fromB: y, toB: matchY });
    x = matchX + length;
    y = matchY + length;
  }
  return result;
}

/** The lines of `text`, each with its line break, so they add up to the text. */
export function linesOf(text: string): string[] {
  return text === "" ? [] : text.split(/(?<=\n)/);
}

/** Narrows `a[from, to)` → `b[fromB, toB)` to the characters that differ. */
export function narrow(
  a: string,
  b: string,
  hunk: Hunk,
): { from: number; to: number; insert: string } {
  let { fromA, toA, fromB, toB } = hunk;
  while (fromA < toA && fromB < toB && a[fromA] === b[fromB]) {
    fromA += 1;
    fromB += 1;
  }
  while (toA > fromA && toB > fromB && a[toA - 1] === b[toB - 1]) {
    toA -= 1;
    toB -= 1;
  }
  return { from: fromA, to: toA, insert: b.slice(fromB, toB) };
}

/**
 * The changes that turn text `a` into `b`, line by line and then narrowed to
 * the characters, in positions of `a`: unchanged lines are not touched.
 */
export function textChanges(a: string, b: string): { from: number; to: number; insert: string }[] {
  if (a === b) return [];
  const linesA = linesOf(a);
  const linesB = linesOf(b);
  const diff = diffSequences(linesA, linesB, (x, y) => x === y);
  if (diff === null) return [narrow(a, b, { fromA: 0, toA: a.length, fromB: 0, toB: b.length })];
  const offsetsA = offsets(linesA);
  const offsetsB = offsets(linesB);
  return diff.map((hunk) =>
    narrow(a, b, {
      fromA: offsetsA[hunk.fromA] ?? a.length,
      toA: offsetsA[hunk.toA] ?? a.length,
      fromB: offsetsB[hunk.fromB] ?? b.length,
      toB: offsetsB[hunk.toB] ?? b.length,
    }),
  );
}

/** Where each item starts, and at the end the total length. */
export function offsets(items: readonly { length: number }[]): number[] {
  const result = [0];
  for (const item of items) result.push((result.at(-1) ?? 0) + item.length);
  return result;
}
