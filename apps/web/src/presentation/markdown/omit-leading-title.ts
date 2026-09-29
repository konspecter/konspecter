import type { Element, ElementContent, Root, RootContent } from "hast";

type Options = {
  /** The title shown above the rendered body. */
  title: string;
  /** True when the title was derived from the body rather than set in frontmatter. */
  derived: boolean;
};

/**
 * Rehype plugin that removes the body's leading `<h1>` when the page already
 * shows it as the note title, so the title is not rendered twice.
 */
export function omitLeadingTitle({ title, derived }: Options) {
  return (tree: Root) => {
    const first = tree.children.find((node) => !isBlankText(node));
    if (
      first?.type === "element" &&
      first.tagName === "h1" &&
      (derived || textContent(first).trim() === title)
    ) {
      // Rehype plugins transform the tree in place.
      tree.children = tree.children.filter((node) => node !== first);
    }
  };
}

function isBlankText(node: RootContent): boolean {
  return node.type === "text" && node.value.trim() === "";
}

function textContent(node: Element | ElementContent): string {
  if (node.type === "text") {
    return node.value;
  }
  if (node.type === "element") {
    return node.children.map(textContent).join("");
  }
  return "";
}
