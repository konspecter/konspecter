import { parseDocument } from "../document/document";
import type { Note } from "../note/note";
import type { RemoteNote } from "./sync-state";

/**
 * How a conflict is settled: the last write wins, by edit time.
 *
 * - Of two edits, the one whose `updated` date is later wins; the other is
 *   replaced. Ties, and versions without a date, go to the server's version:
 *   it is already on the other devices.
 * - Edits beat deletions: a note deleted on one side but edited on the other
 *   stays, with the edit.
 * - Identical versions, or deletions on both sides, simply settle.
 */
export type Resolution =
  /** The local version is replaced by (or deleted like) the server's. */
  | { readonly kind: "take-remote"; readonly remote: RemoteNote }
  /** The local version stays and is uploaded over the server's. */
  | { readonly kind: "keep-local"; readonly remote: RemoteNote };

/**
 * @param local the local note, or null if it was deleted locally
 * @param remote the server's current version (deleted: a tombstone)
 */
export function planResolution(local: Note | null, remote: RemoteNote): Resolution {
  if (local === null) return { kind: "take-remote", remote };
  if (remote.deleted) return { kind: "keep-local", remote };
  if (local.markdown === remote.markdown) return { kind: "take-remote", remote };
  return editedAt(local.markdown) > editedAt(remote.markdown)
    ? { kind: "keep-local", remote }
    : { kind: "take-remote", remote };
}

/** When a version was last edited (its `updated` date); -Infinity when it has none. */
function editedAt(markdown: string): number {
  try {
    const updated = parseDocument(markdown).metadata.updated;
    const time = updated === null ? Number.NaN : Date.parse(updated);
    return Number.isNaN(time) ? -Infinity : time;
  } catch {
    return -Infinity; // Invalid frontmatter: no date to go by.
  }
}
