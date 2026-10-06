import ignore from "ignore";

/** The rules' file at the root of a Markdown folder (File Mode). */
export const IGNORE_FILE = ".konspecterignore";

/**
 * What is skipped unless the rules say otherwise: hidden files and folders
 * (`.git`, `.obsidian` …) and the usual build and dependency folders. The
 * desktop app has the same default for a folder without the file
 * (src-tauri/src/folder.rs `DEFAULT_IGNORE`).
 */
export const DEFAULT_IGNORE = [".*", "node_modules", "vendors", "dist", "bin", ""].join("\n");

/** Which paths a folder's reading skips, from rules written like `.gitignore`. */
export type IgnoreRules = {
  /**
   * Whether a file (a path relative to the folder, with `/`) is skipped: it
   * matches, or a folder it is in does. As in git, nothing inside a skipped
   * folder can be included again.
   */
  ignores(path: string): boolean;
  /** Whether a folder ("a/b" or "a/b/") is skipped. The top level ("") never is. */
  ignoresFolder(folder: string): boolean;
};

export function ignoreRules(text: string): IgnoreRules {
  const matcher = ignore().add(text);
  const test = (path: string): boolean => {
    try {
      return matcher.ignores(path);
    } catch {
      // Not a relative path (absolute, "./…"): nothing a folder lists.
      return false;
    }
  };
  return {
    ignores: test,
    ignoresFolder: (folder) => {
      const trimmed = folder.replace(/\/+$/, "");
      return trimmed !== "" && test(`${trimmed}/`);
    },
  };
}
