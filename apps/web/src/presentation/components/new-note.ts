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

/** A new note's router state: the tag chain it starts with. */
export type NewNoteState = { readonly newNoteTag: string };

/**
 * What a new note starts with while the list is filtered by `activeTag`:
 * the chain of the folder it was chosen in, when the list's `state` says it
 * was chosen in the tree, else the tag alone. Nothing without a filter.
 */
export function newNoteState(activeTag: string | null, state: unknown): NewNoteState | undefined {
  if (activeTag === null) return undefined;
  const chain = treeChain(state);
  return { newNoteTag: chain?.split("#").at(-1) === activeTag ? chain : activeTag };
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
