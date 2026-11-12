import { useLayoutEffect, useRef, type CSSProperties, type Ref } from "react";
import { createPortal } from "react-dom";
import type { TagCompletion } from "../hooks/use-tag-completion";
import { t } from "../i18n/i18n";
import { visibleArea } from "../editors/place";

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
  const list = useRef<HTMLUListElement>(null);
  // A list that scrolls keeps the chosen tag (↑/↓) in sight.
  useLayoutEffect(() => {
    const element = list.current;
    const option = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!element || !option) return;
    if (option.offsetTop < element.scrollTop) element.scrollTop = option.offsetTop;
    const bottom = option.offsetTop + option.offsetHeight - element.clientHeight;
    if (bottom > element.scrollTop) element.scrollTop = bottom;
  }, [completion.selected]);
  if (!completion.typing) return null;
  return (
    <ul
      ref={(element) => {
        list.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      }}
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

/** The gap between the caret, or an edge of what can be seen, and the list. */
const GAP = 4;
const EDGE = 8;

/**
 * The suggestions in an editor, at the caret: under the start of the tag's
 * name (`at` gives its box in the window), or above it when there is not room
 * for it below and more above. No taller than that room (it scrolls), as on a
 * phone, with its bigger rows. In the page's coordinates, so it scrolls with
 * the text.
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
    const visible = visibleArea();
    const roomBelow = visible.bottom - box.bottom - GAP - EDGE;
    const roomAbove = box.top - visible.top - GAP - EDGE;
    const above = element.scrollHeight > roomBelow && roomAbove > roomBelow;
    element.style.maxHeight = `${String(Math.max(0, above ? roomAbove : roomBelow))}px`;
    const width = element.offsetWidth;
    const left = Math.max(EDGE, Math.min(box.left, window.innerWidth - width - EDGE));
    element.style.left = `${String(left + window.scrollX)}px`;
    element.style.top = `${String((above ? box.top - GAP : box.bottom + GAP) + window.scrollY)}px`;
    element.style.transform = above ? "translateY(-100%)" : "";
  });
  if (!completion.typing) return null;
  return createPortal(
    <TagSuggestionList ref={list} completion={completion} className="tag-suggestions-caret" />,
    document.body,
  );
}
