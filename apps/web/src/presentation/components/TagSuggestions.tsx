import { useLayoutEffect, useRef, type CSSProperties, type Ref } from "react";
import { createPortal } from "react-dom";
import type { TagCompletion } from "../hooks/use-tag-completion";
import { t } from "../i18n/i18n";
import { coveredBelow } from "../editors/place";

/** The tags offered for the one being typed (`useTagCompletion`), while there are any. */
export function TagSuggestionList({
  completion,
  className,
  style,
  ref,
}: {
  completion: TagCompletion;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLUListElement>;
}) {
  if (!completion.typing) return null;
  return (
    <ul
      ref={ref}
      id={completion.listId}
      role="listbox"
      aria-label={t("tags.suggestions")}
      className={className ? `tag-suggestions ${className}` : "tag-suggestions"}
      style={style}
    >
      {completion.suggestions.map((tag, index) => (
        <li
          key={tag.name}
          id={completion.optionId(index)}
          role="option"
          aria-selected={index === completion.selected}
          // The field keeps the focus and the caret.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            completion.choose(index);
          }}
        >
          <span className="tag-suggestion-name">#{tag.spelling}</span>
          <span className="tag-suggestion-count">{tag.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** Room below the caret the list needs; with less, it opens above. */
const ROOM = 260;
const WIDTH = 240;

/**
 * The suggestions in an editor, at the caret: under the start of the tag's
 * name (`at` gives its box in the window), or above it near the bottom of
 * what can be seen. In the page's coordinates, so it scrolls with the text.
 */
export function CaretTagSuggestions({
  completion,
  at,
}: {
  completion: TagCompletion;
  at: (position: number) => { left: number; top: number; bottom: number } | null;
}) {
  const list = useRef<HTMLUListElement>(null);
  const from = completion.typing?.from ?? null;
  // After each change the text may have moved: the list follows the caret.
  useLayoutEffect(() => {
    const element = list.current;
    const box = from === null ? null : at(from);
    if (!element || !box) return;
    const above = box.bottom + ROOM > window.innerHeight - coveredBelow();
    const left = Math.max(8, Math.min(box.left, window.innerWidth - WIDTH - 8));
    element.style.left = `${String(left + window.scrollX)}px`;
    element.style.top = `${String((above ? box.top - 4 : box.bottom + 4) + window.scrollY)}px`;
    element.style.transform = above ? "translateY(-100%)" : "";
  });
  if (!completion.typing) return null;
  return createPortal(
    <TagSuggestionList ref={list} completion={completion} className="tag-suggestions-caret" />,
    document.body,
  );
}
