import type { ImportReport } from "../../application/library/import-markdown";

/** File Mode: the files with tags outside their first chain's folder, and moving them there (ADR-013). */
export type FolderReformat = {
  misplaced(): Promise<readonly string[]>;
  /** Moves them; returns how many moved. */
  apply(): Promise<number>;
};

/** File Mode: the open folder's `.konspecterignore` (its rules, or the default without one). */
export type FolderIgnore = {
  read(): Promise<string>;
  /** Writes the file; the folder is read again by the new rules. */
  save(text: string): Promise<void>;
};

/** Choosing where notes live, on the desktop (see docs/architecture/filesystem-mode.md). */
export type LibraryControls = {
  /** The open Markdown folder's path, or null for the app library. */
  readonly folder: string | null;
  /** Opens the system folder picker; the app reloads on the chosen folder. */
  chooseFolder: () => Promise<void>;
  /** Returns to the app library. */
  closeFolder: () => Promise<void>;
  /** Copies every Markdown file of the open folder into the app library. */
  importFolder: () => Promise<ImportReport>;
  /** File Mode: reformats the folder so its files are in their tags' folders. */
  reformat?: FolderReformat | undefined;
  /** File Mode: the folder's ignore rules. */
  ignore?: FolderIgnore | undefined;
};
