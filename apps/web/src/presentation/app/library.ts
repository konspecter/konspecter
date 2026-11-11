import type { LibraryFolder } from "../../infrastructure/desktop/desktop";
import type { TagCount } from "../../infrastructure/storage/tag-index";

export { folderLabel, type LibraryFolder } from "../../infrastructure/desktop/desktop";

/** File Mode: the files with tags outside their first chain's folder, and moving them there (ADR-013). */
export type FolderReformat = {
  misplaced(): Promise<readonly string[]>;
  /** Moves them; returns how many moved. */
  apply(): Promise<number>;
};

/** File Mode: a folder's `.konspecterignore` (its rules, or the default without one). */
export type FolderIgnore = {
  read(): Promise<string>;
  /** Writes the file; the folder is read again by the new rules. */
  save(text: string): Promise<void>;
};

/**
 * The desktop's folders, where every note is a file (see
 * docs/architecture/filesystem-mode.md and ADR-030).
 */
export type LibraryControls = {
  /** The connected folders, in order; `subscribe` hears of a new alias. */
  readonly folders: {
    readonly subscribe: (listener: () => void) => () => void;
    readonly getSnapshot: () => readonly LibraryFolder[];
  };
  /** The folder a note is in (its id), by the note's id. */
  folderOf(noteId: string): string | null;
  /** One folder's tags, for its root in the tree. */
  tags(folder: string): Promise<TagCount[]>;
  /**
   * Opens the system folder picker and connects the chosen folder; the app
   * then reloads with it. Fails with a `FolderError` ("folder_connected",
   * "folder_overlaps") for a folder connected already, or inside or around one.
   */
  add(): Promise<void>;
  /** Disconnects a folder, its files left where they are; the app then reloads. */
  remove(folder: string): Promise<void>;
  /** Names a folder in the app; null goes back to its own name. */
  setAlias(folder: string, alias: string | null): Promise<void>;
  /** Opens the folder in the system file manager. */
  reveal(folder: string): Promise<void>;
  /** Reformats one folder, or every one, so its files are in their tags' folders. */
  reformat(folder?: string): FolderReformat;
  /** One folder's ignore rules. */
  ignore(folder: string): FolderIgnore;
};
