/**
 * Portable file names for notes: the same rule as the desktop's File Mode
 * (src-tauri/src/folder.rs `file_stem_for`). Letters and digits of any script,
 * spaces, `-` and `_` are kept; everything else becomes a space.
 */
export function fileStemFor(title: string): string {
  const cleaned = title
    .replace(/[^\p{L}\p{N} _-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  // Count code points, not UTF-16 units, so no character is cut in half.
  const stem = Array.from(cleaned).slice(0, 80).join("").trim();
  return stem === "" ? "Untitled" : stem;
}

/** `Title.md`, `Title 2.md` … for a list of titles, case-insensitively unique. */
export function uniqueFileNames(titles: readonly string[]): string[] {
  const taken = new Set<string>();
  return titles.map((title) => {
    const stem = fileStemFor(title);
    for (let n = 1; ; n += 1) {
      const name = n === 1 ? `${stem}.md` : `${stem} ${String(n)}.md`;
      if (!taken.has(name.toLowerCase())) {
        taken.add(name.toLowerCase());
        return name;
      }
    }
  });
}
