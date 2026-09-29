import {
  documentTitle,
  formatTimestamp,
  parseDocument,
  updateMetadata,
} from "../document/document";
import type { Note } from "../note/note";
import type { RemoteNote } from "./sync-state";

/**
 * How a conflict is settled. The strategy is deterministic and never loses a
 * version:
 *
 * - The server's version keeps the note's id: it is already on other devices.
 * - A local edit that differs from it is kept as a new "conflict copy" note.
 * - Edits beat deletions: a note deleted here but edited elsewhere comes back.
 * - Identical versions, or deletions on both sides, simply settle.
 */
export type Resolution =
  | { readonly kind: "take-remote"; readonly remote: RemoteNote }
  | { readonly kind: "copy-local"; readonly remote: RemoteNote; readonly copyMarkdown: string };

/**
 * @param local the local note, or null if it was deleted locally
 * @param remote the server's current version (deleted: a tombstone)
 */
export function planResolution(local: Note | null, remote: RemoteNote, now: Date): Resolution {
  if (local === null || (!remote.deleted && local.markdown === remote.markdown)) {
    return { kind: "take-remote", remote };
  }
  return { kind: "copy-local", remote, copyMarkdown: conflictCopyMarkdown(local, now) };
}

/**
 * The local version as a separate note: same content, a title that says what
 * it is, and `conflict_of` pointing at the original. A document whose
 * frontmatter cannot be edited is copied unchanged: keeping the text matters
 * more than labelling it.
 */
export function conflictCopyMarkdown(local: Note, now: Date): string {
  try {
    const title = documentTitle(parseDocument(local.markdown)) || "Untitled";
    const when = formatTimestamp(now)
      .replace("T", " ")
      .replace(/:\d{2}Z$/, " UTC");
    return updateMetadata(local.markdown, {
      title: `${title} (conflict copy ${when})`,
      conflictOf: local.id,
    });
  } catch {
    return local.markdown;
  }
}
