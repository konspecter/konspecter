import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { configure } from "@testing-library/react";

// Lazy editors and IndexedDB take longer on a busy CI machine than the default second.
configure({ asyncUtilTimeout: 5_000 });

// jsdom has no layout. ProseMirror measures the DOM to map selections and
// scroll, so give it empty geometry to work with.
const emptyRects = Object.assign([], { item: () => null }) as unknown as DOMRectList;
Element.prototype.getClientRects = () => emptyRects;
Range.prototype.getClientRects = () => emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();
document.elementFromPoint = () => null;

// Per-device preferences (sidebar, toolbar) start fresh in every test.
beforeEach(() => {
  localStorage.clear();
});
