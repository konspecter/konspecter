import { setFrontmatterTags } from "../../domain/document/document";

/**
 * The chain of the tree folder a tag was chosen in (`java#collections` for
 * Java › Collections), from its link's router state (`{ tagChain }`); null
 * when the tag was chosen otherwise.
 */
export function treeChain(state: unknown): string | null {
  return typeof state === "object" &&
    state !== null &&
    "tagChain" in state &&
    typeof state.tagChain === "string" &&
    state.tagChain !== ""
    ? state.tagChain
    : null;
}

/**
 * A new note's router state: the tag chain it starts with, and on the
 * desktop the folder (its id) it goes into; `folderChosen` once the folder
 * was asked for (the "ask each time" setting).
 */
export type NewNoteState = {
  readonly newNoteTag?: string;
  readonly folder?: string;
  readonly folderChosen?: true;
};

/**
 * What a new note starts with while the list is filtered by `activeTag`:
 * the chain of the folder it was chosen in, when the list's `state` says it
 * was chosen in the tree, else the tag alone. On the desktop, `folder` is
 * the open note's folder, where it goes. Nothing without either.
 */
export function newNoteState(
  activeTag: string | null,
  state: unknown,
  folder: string | null = null,
): NewNoteState | undefined {
  const chain = treeChain(state);
  const tag =
    activeTag === null
      ? {}
      : { newNoteTag: chain?.split("#").at(-1) === activeTag ? chain : activeTag };
  const where = folder === null ? {} : { folder };
  return activeTag === null && folder === null ? undefined : { ...tag, ...where };
}

/** The folder a new note goes into, from its router state, and whether it was chosen. */
export function newNoteFolder(state: unknown): { folder: string | null; chosen: boolean } {
  if (typeof state !== "object" || state === null) return { folder: null, chosen: false };
  const { folder, folderChosen } = state as Record<string, unknown>;
  return {
    folder: typeof folder === "string" && folder !== "" ? folder : null,
    chosen: folderChosen === true,
  };
}

/**
 * The text a new note starts with, from its router state: the tag chain in
 * the frontmatter, or nothing.
 */
export function newNoteMarkdown(state: unknown): string {
  const tag =
    typeof state === "object" &&
    state !== null &&
    "newNoteTag" in state &&
    typeof state.newNoteTag === "string"
      ? state.newNoteTag
      : "";
  return tag === "" ? "" : setFrontmatterTags("", [tag]);
}
