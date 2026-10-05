import { frontmatterTags, setFrontmatterTags } from "../document/document";
import { parseTagChain } from "../tag/tags";
import { noteWrittenTags, readNote, type ReadNote } from "./note";

/**
 * File Mode keeps the folder tree and the tag tree the same: a note's folder
 * is its first tag chain, `java/collections/maps.md` ⇄ `#java#collections`
 * (ADR-013). These are the rules, without any file access.
 */

/**
 * A folder's name as a tag name: everything a tag cannot hold becomes `_`
 * ("My Notes" → "My_Notes", which the tag tree shows as "My Notes"). Null
 * when nothing is left.
 */
export function folderTagName(folder: string): string | null {
  const name = folder.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "");
  return name === "" ? null : name;
}

/**
 * The tag chain a file's folders stand for, as written:
 * `java/collections/maps.md` → `java#collections`, and "" at the top level.
 * Null when they stand for none: a folder whose name gives no tag, or a
 * first folder whose name is only digits (`2024/`), which is no tag.
 */
export function pathChain(path: string): string | null {
  const folders = path.split("/").slice(0, -1);
  if (folders.length === 0) return "";
  const names = folders.map(folderTagName);
  if (names.some((name) => name === null)) return null;
  const chain = names.join("#");
  return parseTagChain(chain) ? chain : null;
}

/** The chain that places a note: its first (frontmatter, then body), as written; "" without tags. */
export function placingChain(read: ReadNote): string {
  return noteWrittenTags(read)[0] ?? "";
}

/** Whether two chains (as written, "" for none) are the same tags in the same order. */
export function sameChain(a: string, b: string): boolean {
  if (a === "" || b === "") return a === b;
  const first = parseTagChain(a);
  return first !== null && first.name === parseTagChain(b)?.name;
}

/** Whether the file at `path` is in the folder its note's first chain names. */
export function inChainFolder(path: string, read: ReadNote): boolean {
  const chain = pathChain(path);
  return chain !== null && sameChain(chain, placingChain(read));
}

/** Every folder that holds one of the files, at every level (`a/b/c.md` → `a`, `a/b`). */
export function foldersOf(paths: Iterable<string>): Set<string> {
  const folders = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/").slice(0, -1);
    parts.forEach((_, index) => folders.add(parts.slice(0, index + 1).join("/")));
  }
  return folders;
}

/**
 * The folder for a chain, ending in "/" ("" for none): at each level an
 * existing folder whose name gives that tag (ignoring case, as tags do) is
 * used, and a new one is named after the tag as the chain writes it.
 */
export function chainFolder(chain: string, folders: Iterable<string>): string {
  const parsed = parseTagChain(chain);
  if (!parsed) return "";
  const spellings = chain.trim().replace(/^#/, "").split("#");
  const known = [...folders];
  let folder = "";
  parsed.tags.forEach((tag, index) => {
    const existing = known.find((candidate) => {
      const slash = candidate.lastIndexOf("/") + 1;
      return (
        candidate.slice(0, slash) === folder &&
        folderTagName(candidate.slice(slash))?.toLowerCase() === tag.name
      );
    });
    folder = `${existing ?? folder + (spellings[index] ?? tag.name)}/`;
  });
  return folder;
}

/**
 * `markdown` with `chain` first in its frontmatter's `tags`, in place of
 * `replaced` when the field lists that one (a file that moved folders). An
 * empty `chain` only takes `replaced` out. Everything else stays as written;
 * returns `markdown` itself when nothing changes. Throws InvalidDocumentError
 * for invalid frontmatter.
 */
export function withFolderChain(markdown: string, chain: string, replaced = ""): string {
  const listed = frontmatterTags(markdown);
  const rest = listed.filter(
    (entry) => !sameChain(entry, chain) && (replaced === "" || !sameChain(entry, replaced)),
  );
  const tags = chain === "" ? rest : [chain, ...rest];
  const unchanged = tags.length === listed.length && tags.every((tag, i) => tag === listed[i]);
  return unchanged ? markdown : setFrontmatterTags(markdown, tags);
}

/**
 * What a file found on disk should say so that its folders and its tags
 * agree, or null when it says so already (or cannot be changed: invalid
 * frontmatter, folders that make no tag):
 *
 * - a file without tags in folders gets its folders' chain;
 * - a file that moved here from `movedFrom` (another program renamed it)
 *   while its first chain was the old folders' gets the new folders' chain
 *   instead (at the top level: none).
 *
 * A file with tags of its own is otherwise left as it is.
 */
export function withFolderTags(path: string, markdown: string, movedFrom?: string): string | null {
  const read = readNote({ id: path, markdown });
  const chain = pathChain(path);
  if (!read.valid || chain === null) return null;
  const current = placingChain(read);
  let next = markdown;
  try {
    if (movedFrom !== undefined) {
      const before = pathChain(movedFrom);
      if (before !== null && sameChain(before, current) && !sameChain(chain, current)) {
        next = withFolderChain(markdown, chain, current);
      }
    } else if (current === "" && chain !== "") {
      next = withFolderChain(markdown, chain);
    }
  } catch {
    return null;
  }
  return next === markdown ? null : next;
}
