import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { isEmptyQuery, parseQuery, withoutTag } from "../../domain/search/query";
import { highlight, snippet, type SnippetPart } from "../../domain/search/snippet";
import type { NoteCatalog, NoteSummary } from "../../application/notes/note-catalog";
import type { NoteRepository } from "../../application/notes/note-repository";
import type { SearchHit } from "../../infrastructure/search/search-index";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { NoteDate } from "../components/NoteDate";
import { Snippet } from "../components/Snippet";
import { summaryTitle } from "../components/note-title";
import { useAsync } from "../hooks/use-async";

type NotesPageProps = {
  store: NoteRepository;
  catalog: NoteCatalog;
};

type Row = {
  readonly id: string;
  readonly title: readonly SnippetPart[];
  readonly updated: string | null;
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
    text: note.excerpt === "" ? [] : [{ text: note.excerpt, match: false }],
  };
}

function hitRow(hit: SearchHit): Row {
  // The indexed text starts with the heading the row already shows as its title.
  const text =
    hit.title !== "" && hit.text.startsWith(hit.title)
      ? hit.text.slice(hit.title.length)
      : hit.text;
  return {
    id: hit.id,
    title: highlight(hit.title || "Untitled", hit.terms),
    updated: hit.updated || null,
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
  const [searchParams, setSearchParams] = useSearchParams();
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

  const hitRows = useMemo(
    () => (found && "hits" in found ? found.hits.map(hitRow) : null),
    [found],
  );
  const noteRows = useMemo(
    () => (library.status === "ready" ? library.notes.map(summaryRow) : []),
    [library],
  );

  const setQuery = (q: string) => {
    setSearchParams(q ? { q } : {}, { replace: true });
  };

  let content;
  if (library.status === "error") {
    content = (
      <ErrorState
        title="Could not load notes"
        error={library.error}
        onRetry={() => void catalog.reload()}
      />
    );
  } else if (library.status === "loading") {
    content = null;
  } else if (searching && found && "error" in found) {
    content = <ErrorState title="Search failed" error={found.error} />;
  } else {
    const rows = searching && hitRows ? hitRows : noteRows;
    if (rows.length > 0) {
      content = <ResultList rows={rows} />;
    } else if (searching && found?.query === query) {
      content = <EmptyState title="No matching notes" />;
    } else if (!searching) {
      content = <Welcome store={store} />;
    } else {
      content = null;
    }
  }

  const count =
    library.status !== "ready"
      ? null
      : searching
        ? found && "hits" in found && found.query === query
          ? found.hits.length
          : null
        : library.notes.length;

  return (
    <>
      <title>{searching ? `${query} · Konspecter` : "Notes · Konspecter"}</title>
      <div className="list-header">
        <h1 className="list-title">{searching ? "Search results" : "All notes"}</h1>
        {count !== null && count > 0 && <span className="list-count">{count}</span>}
      </div>
      {parsed.tags.length > 0 && (
        <ul className="filter-chips" aria-label="Tag filters">
          {parsed.tags.map((tag) => (
            <li key={tag.name}>
              #{tag.name}
              <button
                type="button"
                aria-label={`Remove #${tag.name} filter`}
                onClick={() => {
                  setQuery(withoutTag(query, tag));
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {unreadable.status === "success" && unreadable.value.length > 0 && (
        <p role="note" className="conflict-banner">
          Some stored notes could not be read. They are kept safe; see{" "}
          <Link to="/settings">Settings → Backup &amp; recovery</Link>.
        </p>
      )}
      {content}
    </>
  );
}

const ResultList = memo(function ResultList({ rows }: { rows: readonly Row[] }) {
  return (
    <ol className="note-results" aria-label="Notes">
      {rows.map((row) => (
        <ResultRow key={row.id} row={row} />
      ))}
    </ol>
  );
});

const ResultRow = memo(function ResultRow({ row }: { row: Row }) {
  return (
    <li className="note-result">
      <div className="note-result-head">
        <Link to={`/notes/${encodeURIComponent(row.id)}`} className="note-result-title">
          {row.title.map((part, index) =>
            part.match ? <mark key={index}>{part.text}</mark> : part.text,
          )}
        </Link>
        {row.updated !== null && <NoteDate value={row.updated} />}
      </div>
      {row.text.length > 0 && <Snippet parts={row.text} />}
    </li>
  );
});

const EXAMPLE_NOTE = `# Welcome to Konspecter

Every note is a **Markdown** document. This one shows what that gives you.

## Headings and lists

- Plain lists, and numbered ones
- Links: [CommonMark](https://commonmark.org)

## Code

\`\`\`java
Map<String, Integer> counts = new HashMap<>();
\`\`\`

## Tags

Write a tag anywhere, like #konspecter or a nested one: #konspecter#getting-started.
The sidebar lists them, and search understands them: try \`#konspecter\`.

Everything you type is saved as you go. Switch to **Markdown** at the top to see the
source, or delete this note when you are done.
`;

function Welcome({ store }: { store: NoteRepository }) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <h2 id="welcome-title">Welcome to Konspecter</h2>
      <p>
        Technical notes as plain Markdown, kept on this device and working offline. Tag them
        anywhere with <code>#tags</code>, find them with full-text search, and sync them with a
        server when you want to.
      </p>
      <div className="actions">
        <Link to="/notes/new" className="button button-primary">
          Create your first note
        </Link>
        <button
          type="button"
          className="button"
          disabled={adding}
          onClick={() => {
            setAdding(true);
            void store.create(EXAMPLE_NOTE, new Date()).then((note) => {
              void navigate(`/notes/${encodeURIComponent(note.id)}`);
            });
          }}
        >
          Add an example note
        </button>
      </div>
      <p className="setting-hint">
        Have notes already? Import <code>.md</code> files or a folder in{" "}
        <Link to="/settings">Settings</Link>, where you can also connect sync.
      </p>
    </section>
  );
}
