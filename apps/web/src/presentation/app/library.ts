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

/**
 * The desktop's folder, where every note is a file (see
 * docs/architecture/filesystem-mode.md and ADR-024).
 */
export type LibraryControls = {
  /** The folder's path; null only when not even the default folder could be opened. */
  readonly folder: string | null;
  /** Opens the system folder picker; the app reloads on the chosen folder. */
  chooseFolder: () => Promise<void>;
  /** File Mode: reformats the folder so its files are in their tags' folders. */
  reformat?: FolderReformat | undefined;
  /** File Mode: the folder's ignore rules. */
  ignore?: FolderIgnore | undefined;
};
