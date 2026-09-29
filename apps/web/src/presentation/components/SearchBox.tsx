import { useId, useState, type Ref } from "react";
import { useLocation, useMatch, useNavigate, useSearchParams } from "react-router";
import { joinQuery, queryParts, takeTags, type QueryParts } from "../../domain/search/query";
import type { Tag } from "../../domain/tag/tags";
import { formatKeys, SHORTCUTS } from "../app/shortcuts";
import { SearchIcon } from "./icons";
import { t } from "../i18n/i18n";

type Shown = QueryParts & {
  /** The query the chips and text make up. */
  readonly query: string;
  /** Queries sent to the URL that it has not shown yet. */
  readonly sent: readonly string[];
};

/** The note a search was started over (router state), if it was. */
function startedOver(state: unknown): string | null {
  return typeof state === "object" &&
    state !== null &&
    "from" in state &&
    typeof state.from === "string"
    ? state.from
    : null;
}

function firstResult(): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>("#content .note-results a");
}

/**
 * The top bar's search. Focusing it shows the note list, except over an open
 * note: that stays while the field is empty, and emptying the field again
 * returns to it. Typing filters the list (the query lives in the list's URL,
 * `/?q=`). Tag filters are chips inside
 * the field, before the text: a tag becomes one when a space follows it, a
 * tag chosen elsewhere (the sidebar) arrives as one, × or Backspace at the
 * start removes one. ↓ moves into the results (↑ and ↓ move on there, see
 * `NotesPage`) and Enter opens the first one.
 */
export function SearchBox({ inputRef }: { inputRef?: Ref<HTMLInputElement> }) {
  const id = useId();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const onList = location.pathname === "/";
  const onNote = useMatch("/notes/:id") !== null;
  const query = onList ? (searchParams.get("q") ?? "") : "";

  // The query split into chips and text. The URL is the truth: when it
  // changes from elsewhere (a tag in the sidebar, Back), it is split again.
  // The router applies navigations as transitions, so the URL can lag behind
  // what was typed: queries this box sent itself are not "from elsewhere".
  const [shown, setShown] = useState<Shown>(() => ({ query, ...queryParts(query), sent: [] }));
  const [seen, setSeen] = useState(query);
  let { tags, text } = shown;
  if (query !== seen) {
    setSeen(query);
    if (!shown.sent.includes(query)) {
      ({ tags, text } = queryParts(query));
      setShown({ query, tags, text, sent: [] });
    } else if (query === shown.query) {
      setShown({ ...shown, sent: [] });
    }
  }

  function change(nextTags: readonly Tag[], nextText: string) {
    const next = joinQuery(nextTags, nextText);
    setShown({ query: next, tags: nextTags, text: nextText, sent: [...shown.sent, next] });
    const from = onNote ? location.pathname : onList ? startedOver(location.state) : null;
    if (next === "" && onList && from !== null) {
      void navigate(from, { replace: true });
      return;
    }
    void navigate(next ? `/?q=${encodeURIComponent(next)}` : "/", {
      replace: onList,
      ...(from !== null ? { state: { from } } : {}),
    });
  }

  function withTags(added: readonly Tag[]): Tag[] {
    const known = new Set(tags.map((tag) => tag.name));
    return [...tags, ...added.filter((tag) => !known.has(tag.name))];
  }

  return (
    <form
      role="search"
      className="search-box"
      onSubmit={(event) => {
        event.preventDefault();
        firstResult()?.click();
      }}
    >
      <SearchIcon />
      {tags.length > 0 && (
        <ul className="search-chips" aria-label={t("list.tagFilters")}>
          {tags.map((tag) => (
            <li key={tag.name}>
              #{tag.name}
              <button
                type="button"
                aria-label={t("list.removeTag", { tag: tag.name })}
                onClick={() => {
                  change(
                    tags.filter((other) => other.name !== tag.name),
                    text,
                  );
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor={id} className="visually-hidden">
        {t("topbar.search")}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="search"
        className="search-input"
        value={text}
        placeholder={tags.length > 0 ? "" : t("topbar.searchPlaceholder")}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          if (!onList && !onNote) void navigate("/");
        }}
        onChange={(event) => {
          const typed = takeTags(event.target.value);
          change(withTags(typed.tags), typed.text);
        }}
        onBlur={() => {
          // A tag typed at the end becomes a chip too once the field is left.
          const parts = queryParts(text);
          if (parts.tags.length > 0) change(withTags(parts.tags), parts.text);
        }}
        onKeyDown={(event) => {
          const input = event.currentTarget;
          if (event.key === "ArrowDown") {
            const result = firstResult();
            if (result) {
              event.preventDefault();
              result.focus();
            }
          } else if (event.key === "Escape") {
            input.blur();
          } else if (
            event.key === "Backspace" &&
            tags.length > 0 &&
            input.selectionStart === 0 &&
            input.selectionEnd === 0
          ) {
            event.preventDefault();
            change(tags.slice(0, -1), text);
          }
        }}
      />
      {query === "" && (
        <kbd className="search-kbd" aria-hidden="true">
          {formatKeys(SHORTCUTS.search.keys)}
        </kbd>
      )}
    </form>
  );
}
