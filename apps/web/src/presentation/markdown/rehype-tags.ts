import type { Element, ElementContent, Root } from "hast";
import { tagRanges } from "../../domain/tag/tags";

/** Elements whose text is never a tag: code, and links showing their own URL. */
function skipped(element: Element): boolean {
  if (["code", "pre", "script", "style"].includes(element.tagName)) return true;
  if (element.tagName !== "a") return false;
  const text = element.children.map((child) => (child.type === "text" ? child.value : "")).join("");
  return text === element.properties.href;
}

function mark(children: ElementContent[]): ElementContent[] {
  return children.flatMap((child): ElementContent[] => {
    if (child.type === "element") {
      if (!skipped(child)) child.children = mark(child.children);
      return [child];
    }
    if (child.type !== "text") return [child];
    const ranges = tagRanges(child.value);
    if (ranges.length === 0) return [child];
    const parts: ElementContent[] = [];
    let last = 0;
    for (const { from, to } of ranges) {
      if (from > last) parts.push({ type: "text", value: child.value.slice(last, from) });
      parts.push({
        type: "element",
        tagName: "span",
        properties: { className: ["md-tag"] },
        children: [{ type: "text", value: child.value.slice(from, to) }],
      });
      last = to;
    }
    if (last < child.value.length) parts.push({ type: "text", value: child.value.slice(last) });
    return parts;
  });
}

/** Rehype plugin that wraps tags in the text in `<span class="md-tag">`, for styling. */
export function rehypeTags() {
  return (tree: Root) => {
    tree.children = tree.children.flatMap((child): Root["children"] =>
      child.type === "doctype" ? [child] : mark([child]),
    );
  };
}
