import { useSyncExternalStore } from "react";
import type { LibraryControls, LibraryFolder } from "../app/library";

const NO_FOLDERS: readonly LibraryFolder[] = [];
const noFolders = {
  subscribe: () => () => undefined,
  getSnapshot: () => NO_FOLDERS,
};

/** The connected folders, kept current (none without a desktop library). */
export function useLibraryFolders(library: LibraryControls | undefined): readonly LibraryFolder[] {
  const folders = library?.folders ?? noFolders;
  return useSyncExternalStore(folders.subscribe, folders.getSnapshot);
}
