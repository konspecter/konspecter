import { useId, type Ref } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { formatKeys, SHORTCUTS } from "../app/shortcuts";
import { SearchIcon } from "./icons";

function firstResult(): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>("#content .note-results a");
}

/**
 * The top bar's search. Focusing it shows the note list; typing filters it
 * (the query lives in the list's URL, `/?q=`). ↓ moves into the results and
 * Enter opens the first one.
 */
export function SearchBox({ inputRef }: { inputRef?: Ref<HTMLInputElement> }) {
  const id = useId();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const onList = location.pathname === "/";
  const value = onList ? (searchParams.get("q") ?? "") : "";

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
      <label htmlFor={id} className="visually-hidden">
        Search notes
      </label>
      <input
        ref={inputRef}
        id={id}
        type="search"
        className="search-input"
        value={value}
        placeholder="Search"
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          if (!onList) void navigate("/");
        }}
        onChange={(event) => {
          const q = event.target.value;
          void navigate(q ? `/?q=${encodeURIComponent(q)}` : "/", { replace: onList });
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            const result = firstResult();
            if (result) {
              event.preventDefault();
              result.focus();
            }
          } else if (event.key === "Escape") {
            event.currentTarget.blur();
          }
        }}
      />
      {value === "" && (
        <kbd className="search-kbd" aria-hidden="true">
          {formatKeys(SHORTCUTS.search.keys)}
        </kbd>
      )}
    </form>
  );
}
