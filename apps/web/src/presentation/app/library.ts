import type { ImportReport } from "../../application/library/import-markdown";

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
};
