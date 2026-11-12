import { use, useId, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { KnownTag } from "../../domain/tag/tag-suggestions";
import { TagSuggestContext } from "../components/tag-suggest";

/**
 * A tag being typed in a field or an editor: where its name starts and the
 * caret (in the field's own positions), and the name so far.
 */
export type TagTyping = { readonly from: number; readonly to: number; readonly prefix: string };

export type TagCompletion = {
  /** The tag being typed while suggestions are shown, else null. */
  readonly typing: TagTyping | null;
  readonly suggestions: readonly KnownTag[];
  readonly selected: number;
  readonly listId: string;
  /** The selected option's element id, while suggestions are shown. */
  readonly activeId: string | undefined;
  readonly optionId: (index: number) => string;
  /** Handles a key for the shown suggestions; true when it was theirs. */
  readonly keyDown: (event: KeyboardEvent | ReactKeyboardEvent) => boolean;
  readonly choose: (index: number) => void;
};

/** Whether the list shows its first tag at the bottom (a phone: nearest the finger). */
function bottomUp(listId: string): boolean {
  const list = document.getElementById(listId);
  return list !== null && getComputedStyle(list).flexDirection === "column-reverse";
}

/**
 * The library's tags offered for the tag being typed (`typing`, null when
 * none is): ↑ and ↓ choose one (as the list is drawn), Enter takes it (`accept` writes it in place
 * of the name typed), Escape closes the list until another tag is typed.
 * With `passExact`, Enter on a tag that is just what is typed is not taken:
 * it closes the list and goes on (a new line in an editor).
 */
export function useTagCompletion(
  typing: TagTyping | null,
  accept: (tag: KnownTag, typing: TagTyping) => void,
  { passExact = false }: { passExact?: boolean } = {},
): TagCompletion {
  const suggest = use(TagSuggestContext);
  const listId = useId();
  const [choice, setChoice] = useState({ from: -1, prefix: "", index: 0 });
  const [dismissed, setDismissed] = useState<number | null>(null);
  if (typing === null && dismissed !== null) setDismissed(null);

  const found =
    typing && suggest && dismissed !== typing.from ? suggest(typing.prefix) : ([] as KnownTag[]);
  // A list of just the tag typed has nothing to offer.
  const only = found.length === 1 ? found[0] : undefined;
  const suggestions = only?.name === typing?.prefix.toLowerCase() ? [] : found;
  const open = typing !== null && suggestions.length > 0 ? typing : null;
  const same = open !== null && choice.from === open.from && choice.prefix === open.prefix;
  const selected = same ? Math.min(choice.index, suggestions.length - 1) : 0;
  const optionId = (index: number) => `${listId}-${String(index)}`;

  function select(index: number) {
    if (open) setChoice({ from: open.from, prefix: open.prefix, index });
  }

  return {
    typing: open,
    suggestions,
    selected,
    listId,
    activeId: open ? optionId(selected) : undefined,
    optionId,
    keyDown: (event) => {
      const native = "nativeEvent" in event ? event.nativeEvent : event;
      // Keys that compose a character (an input method) are not ours.
      if (!open || native.isComposing || event.altKey || event.ctrlKey || event.metaKey) {
        return false;
      }
      const count = suggestions.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        // A phone shows the list bottom-up: the arrows follow the screen.
        const next = event.key === (bottomUp(listId) ? "ArrowUp" : "ArrowDown");
        select((selected + (next ? 1 : count - 1)) % count);
      } else if (event.key === "Escape") {
        setDismissed(open.from);
      } else if (event.key === "Enter" && !event.shiftKey) {
        const tag = suggestions[selected];
        if (!tag) return false;
        if (passExact && tag.name === open.prefix.toLowerCase()) {
          setDismissed(open.from);
          return false;
        }
        accept(tag, open);
      } else {
        return false;
      }
      event.preventDefault();
      return true;
    },
    choose: (index) => {
      const tag = suggestions[index];
      if (open && tag) accept(tag, open);
    },
  };
}
