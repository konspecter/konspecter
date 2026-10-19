/**
 * A heading of the open note to scroll to (a heading in the tree was
 * followed): its `index` among the body's headings up to h3 (`Heading.index`)
 * and the navigation that asked, so following the same link again scrolls
 * again.
 */
export type HeadingTarget = { readonly index: number; readonly key: string };

/** `#heading-2`: the note's second heading. The hash counts from 1, the index from 0. */
const HASH = /^#heading-([1-9]\d{0,5})$/;

/** The address of a note opened at one of its headings. */
export function headingPath(noteId: string, index: number): string {
  return `/conspects/${encodeURIComponent(noteId)}#heading-${String(index + 1)}`;
}

/** The heading index a location's hash names, if it names one. */
export function headingInHash(hash: string): number | null {
  const match = HASH.exec(hash);
  return match ? Number(match[1]) - 1 : null;
}

/** Room left above a heading scrolled to, under the top bar. */
const HEADING_ROOM = 12;

/** How far from the window's top a heading scrolled to stands: under the sticky top bar. */
export function headingTop(): number {
  return (document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0) + HEADING_ROOM;
}

/** Scrolls the page so that `rect` (a heading, in window coordinates) is at the top of what can be seen. */
export function revealHeading(rect: DOMRect): void {
  window.scrollTo({ top: window.scrollY + rect.top - headingTop() });
}
