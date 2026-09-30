/**
 * Portable file names for exported notes: the same rule as the desktop's
 * folder export (src-tauri/src/folder.rs `file_stem_for`). Letters and digits
 * of any script, spaces, `-` and `_` are kept; everything else becomes a space.
 * File Mode names its files by `slugFor` instead.
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

/** Cyrillic letters (Russian, Ukrainian, Belarusian) in Latin, for slugs. */
const CYRILLIC: Readonly<Record<string, string>> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  є: "ye",
  і: "i",
  ї: "yi",
  ґ: "g",
  ў: "u",
};

/**
 * The file name stem a title stands for when files follow their titles:
 * lower case, Cyrillic transliterated, accents dropped from Latin letters,
 * words joined by `-` ("Hello мир!" → "hello-mir"). Letters of other
 * scripts are kept as they are.
 */
export function slugFor(title: string): string {
  const latin = Array.from(title.toLowerCase(), (char) => CYRILLIC[char] ?? char)
    .join("")
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC");
  const slug = latin.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  // Count code points, not UTF-16 units, so no character is cut in half.
  const cut = Array.from(slug).slice(0, 80).join("").replace(/-+$/, "");
  return cut === "" ? "untitled" : cut;
}

/** Whether a file name stem is the slug, or the slug made unique ("hello-mir-2"). */
export function stemFitsSlug(stem: string, slug: string): boolean {
  return (
    stem === slug || (stem.startsWith(`${slug}-`) && /^\d+$/.test(stem.slice(slug.length + 1)))
  );
}

/** `dir/slug.md`, `dir/slug-2.md` …: the names to try, in order, for a slug. */
export function* slugFileNames(dir: string, slug: string): Generator<string> {
  yield `${dir}${slug}.md`;
  for (let n = 2; ; n += 1) yield `${dir}${slug}-${String(n)}.md`;
}
