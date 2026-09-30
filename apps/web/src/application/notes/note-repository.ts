import type { Note } from "../../domain/note/note";
import type { EditorSelection, ReadingState } from "../../domain/reading/reading";
import type { SearchQuery } from "../../domain/search/query";
import type { Tag } from "../../domain/tag/tags";
import type { SearchHit } from "../../infrastructure/search/search-index";
import type { TagCount } from "../../infrastructure/storage/tag-index";

/** A stored record that failed validation, kept as it is. */
export type UnreadableRecord = {
  readonly key: string;
  readonly value: unknown;
  readonly reason: string;
};

export type NoteChange = {
  readonly noteId: string;
  /** "local": made in this app; "remote": arrived by sync or from another program. */
  readonly source: "local" | "remote";
  /** Set when the note was renamed (File Mode: the file moved) from this id. */
  readonly previousId?: string;
};

/**
 * Where the UI's notes live. Two backends implement it, and they are kept
 * apart on purpose:
 *
 * - `NoteStore`: the app's own library in IndexedDB, synced with a server.
 * - `FolderStore` (desktop File Mode): real `.md` files in a folder on disk.
 *
 * Pages depend on this interface only, so every screen works with either.
 */
export interface NoteRepository {
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | undefined>;
  /** Stores a new note; the backend chooses its id (a UUID, or a file name). */
  create(markdown: string, now: Date): Promise<Note>;
  /**
   * Saves an existing note and returns it as stored. Its id can change: in
   * File Mode a file that follows its title is renamed.
   */
  put(note: Note): Promise<Note>;
  delete(id: string): Promise<void>;
  tags(): Promise<TagCount[]>;
  notesWithTag(tag: Tag): Promise<Note[]>;
  search(query: SearchQuery): Promise<SearchHit[]>;
  readingState(noteId: string): Promise<ReadingState | null>;
  /** Saves the scroll position; the saved caret stays. */
  saveReadingPosition(noteId: string, position: number): Promise<void>;
  /** Saves the caret; the saved scroll position stays. */
  saveEditorSelection(noteId: string, selection: EditorSelection): Promise<void>;
  onChange(listener: (change: NoteChange) => void): () => void;
  /** App library only: stored records that are not readable notes (see Recovery). */
  unreadableRecords?(): Promise<UnreadableRecord[]>;
  /** App library only: removes unreadable records (after they were saved elsewhere). */
  removeUnreadable?(keys: readonly string[]): Promise<void>;
  /** App library only: discards derived indexes and rebuilds them from the notes. */
  rebuildIndexes?(): Promise<void>;
  /** File Mode only: opens the note's file in the system's default Markdown app. */
  openExternally?(id: string): Promise<void>;
  /** File Mode only: shows the note's file in the system file manager. */
  reveal?(id: string): Promise<void>;
}
