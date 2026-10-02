import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { isEmptyQuery, parseQuery } from "../../domain/search/query";
import { highlight, snippet, type SnippetPart } from "../../domain/search/snippet";
import type { NoteCatalog, NoteSummary } from "../../application/notes/note-catalog";
import type { NoteRepository } from "../../application/notes/note-repository";
import type { SearchHit } from "../../infrastructure/search/search-index";
import { isDisplayableCover } from "../components/CoverImage";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { NoteDate } from "../components/NoteDate";
import { Snippet } from "../components/Snippet";
import { summaryTitle } from "../components/note-title";
import { useAsync } from "../hooks/use-async";
import { t } from "../i18n/i18n";
import { rich } from "../i18n/rich";

type NotesPageProps = {
  store: NoteRepository;
  catalog: NoteCatalog;
};

type Row = {
  readonly id: string;
  readonly title: readonly SnippetPart[];
  readonly updated: string | null;
  readonly cover: string | null;
  readonly tags: readonly string[];
  /** The start of the text, or where a search matched it. */
  readonly text: readonly SnippetPart[];
};

type Found =
  | { readonly query: string; readonly hits: readonly SearchHit[] }
  | { readonly query: string; readonly error: unknown };

function summaryRow(note: NoteSummary): Row {
  return {
    id: note.id,
    title: [{ text: summaryTitle(note), match: false }],
    updated: note.updated,
    cover: note.cover,
    tags: note.tags,
    text: note.excerpt === "" ? [] : [{ text: note.excerpt, match: false }],
  };
}

function hitRow(hit: SearchHit, note: NoteSummary | undefined): Row {
  // The indexed text starts with the heading the row already shows as its title.
  const text =
    hit.title !== "" && hit.text.startsWith(hit.title)
      ? hit.text.slice(hit.title.length)
      : hit.text;
  return {
    id: hit.id,
    title: highlight(hit.title || t("note.untitled"), hit.terms),
    updated: hit.updated || null,
    cover: note?.cover ?? null,
    tags: note?.tags ?? [],
    text: snippet(text, hit.terms),
  };
}

/** Most recently edited first, like the list before filtering; undated last. */
function byRecentEdit(a: SearchHit, b: SearchHit): number {
  const aTime = a.updated ? Date.parse(a.updated) : Number.NEGATIVE_INFINITY;
  const bTime = b.updated ? Date.parse(b.updated) : Number.NEGATIVE_INFINITY;
  if (aTime !== bTime) return bTime > aTime ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Every note, most recently edited first; the top bar's search filters it as
 * you type (`?q=`, words and `#tag` filters) and marks what matched. While a
 * search runs, the previous list stays, so typing never blanks the page.
 */
export function NotesPage({ store, catalog }: NotesPageProps) {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const parsed = useMemo(() => parseQuery(query), [query]);
  const searching = !isEmptyQuery(parsed);
  const library = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
  const [found, setFound] = useState<Found | null>(null);

  // Search again when the query changes and whenever a note changes (the
  // library snapshot is new then), so the results stay current.
  useEffect(() => {
    if (!searching) return;
    let current = true;
    store.search(parsed).then(
      (hits) => {
        if (current) setFound({ query, hits: [...hits].sort(byRecentEdit) });
      },
      (error: unknown) => {
        if (current) setFound({ query, error });
      },
    );
    return () => {
      current = false;
    };
  }, [store, parsed, query, searching, library]);

  const loadUnreadable = useCallback(
    () => (store.unreadableRecords ? store.unreadableRecords() : Promise.resolve([])),
    [store],
  );
  const unreadable = useAsync(loadUnreadable);

  const hitRows = useMemo(() => {
    if (!found || !("hits" in found)) return null;
    const notes = new Map(
      library.status === "ready" ? library.notes.map((note) => [note.id, note]) : [],
    );
    return found.hits.map((hit) => hitRow(hit, notes.get(hit.id)));
  }, [found, library]);
  const noteRows = useMemo(
    () => (library.status === "ready" ? library.notes.map(summaryRow) : []),
    [library],
  );

  let content;
  if (library.status === "error") {
    content = (
      <ErrorState
        title={t("list.loadFailed")}
        error={library.error}
        onRetry={() => void catalog.reload()}
      />
    );
  } else if (library.status === "loading") {
    content = null;
  } else if (searching && found && "error" in found) {
    content = <ErrorState title={t("list.searchFailed")} error={found.error} />;
  } else {
    const rows = searching && hitRows ? hitRows : noteRows;
    if (rows.length > 0) {
      content = <ResultList rows={rows} />;
    } else if (searching && found?.query === query) {
      content = <EmptyState title={t("list.noMatches")} />;
    } else if (!searching) {
      content = <Welcome store={store} />;
    } else {
      content = null;
    }
  }

  return (
    <>
      <title>{t("app.title", { title: searching ? query : t("list.notes") })}</title>
      {/* The app holds only notes: the list needs no visible heading. Tag filters are
          chips in the search box. */}
      <h1 className="visually-hidden">{searching ? t("list.searchResults") : t("list.notes")}</h1>
      {unreadable.status === "success" && unreadable.value.length > 0 && (
        <p role="note" className="conflict-banner">
          {rich("list.unreadable", {
            link: <Link to="/settings">{t("list.unreadableLink")}</Link>,
          })}
        </p>
      )}
      {content}
    </>
  );
}

/**
 * The arrow keys move through the grid: ↑ and ↓ a row, ← and → a column
 * (one column on small screens). ↑ on the first row goes back to the search
 * box (whose ↓ comes here); ↓ under a short last row goes to its last note.
 */
function moveFocus(event: KeyboardEvent<HTMLOListElement>) {
  const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (step === undefined) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>(".note-result-title")];
  const index = links.findIndex((link) => link === document.activeElement);
  if (index === -1) return;
  const vertical = event.key === "ArrowDown" || event.key === "ArrowUp";
  const columns = vertical ? gridColumns(event.currentTarget) : 1;
  const next = index + step * columns;
  let target: HTMLElement | null | undefined = links[next];
  if (next < 0) {
    target = document.querySelector<HTMLInputElement>("[role=search] input");
  } else if (!target && vertical && step > 0) {
    const lastRow = Math.floor((links.length - 1) / columns);
    if (Math.floor(index / columns) < lastRow) target = links.at(-1);
  }
  event.preventDefault();
  target?.focus();
}

/** How many columns the list's grid has now (one where there is no layout). */
function gridColumns(list: HTMLElement): number {
  const tracks = getComputedStyle(list).gridTemplateColumns.split(" ").filter(Boolean);
  return Math.max(1, tracks.length);
}

const ResultList = memo(function ResultList({ rows }: { rows: readonly Row[] }) {
  return (
    <ol className="note-results" aria-label={t("list.notes")} onKeyDown={moveFocus}>
      {rows.map((row) => (
        <ResultRow key={row.id} row={row} />
      ))}
    </ol>
  );
});

/**
 * A conspect, the same in the list and in search results: its cover beside
 * four lines of text, about as tall as the cover: the title; the date it was
 * last edited and its tags; two of the text (where a search matched it).
 */
const ResultRow = memo(function ResultRow({ row }: { row: Row }) {
  return (
    <li className="note-result">
      <ListCover id={row.id} cover={row.cover} title={row.title} />
      <div className="note-result-body">
        <Link to={`/notes/${encodeURIComponent(row.id)}`} className="note-result-title">
          {row.title.map((part, index) =>
            part.match ? <mark key={index}>{part.text}</mark> : part.text,
          )}
        </Link>
        {(row.updated !== null || row.tags.length > 0) && (
          <p className="note-result-meta">
            {row.updated !== null && <NoteDate value={row.updated} />}
            {row.tags.length > 0 && (
              <span className="note-result-tags">{row.tags.map((tag) => `#${tag}`).join(" ")}</span>
            )}
          </p>
        )}
        {row.text.length > 0 && <Snippet parts={row.text} />}
      </div>
    </li>
  );
});

/**
 * The note's cover, or its title's first letter on a pastel colour that the
 * note's id picks, so each note keeps its colour.
 */
function ListCover({
  id,
  cover,
  title,
}: {
  id: string;
  cover: string | null;
  title: readonly SnippetPart[];
}) {
  if (cover !== null && isDisplayableCover(cover)) {
    return <img className="note-result-cover" src={cover} alt="" loading="lazy" />;
  }
  const text = title.map((part) => part.text).join("");
  const letter = (
    /[\p{L}\p{N}]/u.exec(text)?.[0] ??
    graphemes.segment(text)[Symbol.iterator]().next().value?.segment ??
    ""
  ).toLocaleUpperCase();
  return (
    <span
      className="note-result-cover note-result-letter"
      style={{ "--cover-hue": placeholderHue(id) } as CSSProperties}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

const graphemes = new Intl.Segmenter();

/** A hue from 0 to 359 from the id's characters (FNV-1a). */
function placeholderHue(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0) % 360;
}

function Welcome({ store }: { store: NoteRepository }) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <h2 id="welcome-title">{t("welcome.title")}</h2>
      <p>{rich("welcome.text", { tags: <code>#tags</code> })}</p>
      <div className="actions">
        <Link to="/notes/new" className="button button-primary">
          {t("welcome.create")}
        </Link>
        <button
          type="button"
          className="button"
          disabled={adding}
          onClick={() => {
            setAdding(true);
            void store.create(t("welcome.exampleNote"), new Date()).then((note) => {
              void navigate(`/notes/${encodeURIComponent(note.id)}`);
            });
          }}
        >
          {t("welcome.example")}
        </button>
      </div>
      <p className="setting-hint">
        {rich("welcome.import", {
          md: <code>.md</code>,
          settings: <Link to="/settings">{t("sidebar.settings")}</Link>,
        })}
      </p>
    </section>
  );
}
