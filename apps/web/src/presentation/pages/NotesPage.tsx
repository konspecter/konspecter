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
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { isEmptyQuery, parseQuery } from "../../domain/search/query";
import { highlight, snippet, type SnippetPart } from "../../domain/search/snippet";
import type { TagNames } from "../../domain/settings/settings";
import { tagGroups, tagTree, type TagGroup, type TagNode } from "../../domain/tag/tags";
import type { NoteCatalog, NoteSummary } from "../../application/notes/note-catalog";
import type { NoteRepository } from "../../application/notes/note-repository";
import { isNativeMobile } from "../../infrastructure/mobile/mobile";
import type { SearchHit } from "../../infrastructure/search/search-index";
import type { LibraryControls } from "../app/library";
import type { ShortcutName } from "../app/shortcuts";
import { isDisplayableCover } from "../components/CoverImage";
import { colorStyle } from "../components/note-color";
import { treeChain } from "../components/new-note";
import { EmptyState } from "../components/EmptyState";
import { AddFolderButton } from "../components/LibraryFolders";
import { ErrorState } from "../components/ErrorState";
import { NoteDate } from "../components/NoteDate";
import { ShortcutList } from "../components/ShortcutsDialog";
import { Snippet } from "../components/Snippet";
import { summaryTitle } from "../components/note-title";
import { useAsync } from "../hooks/use-async";
import { useLibraryFolders } from "../hooks/use-library-folders";
import { useNarrow } from "../hooks/use-narrow";
import { t } from "../i18n/i18n";
import { rich } from "../i18n/rich";

type NotesPageProps = {
  store: NoteRepository;
  catalog: NoteCatalog;
  /** The desktop's folder; absent on the web and mobile. */
  library?: LibraryControls | undefined;
  /** How the tags are named in the groups of a tag's list, as in the sidebar. */
  tagNames?: TagNames;
};

type Row = {
  readonly id: string;
  readonly title: readonly SnippetPart[];
  readonly updated: string | null;
  readonly cover: string | null;
  /** The note's own colour; null for its default. */
  readonly color: string | null;
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
    color: note.color,
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
    color: note?.color ?? null,
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
export function NotesPage({
  store,
  catalog,
  library: controls,
  tagNames = "capitalized",
}: NotesPageProps) {
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
  // A tag's list on a small screen, where the sidebar shows only the tag's own notes:
  // the notes of the folders below it come grouped under their tags.
  const narrow = useNarrow();
  const groupTag =
    narrow && parsed.words.length === 0 && parsed.tags.length === 1
      ? (parsed.tags[0]?.name ?? null)
      : null;
  const [tree, setTree] = useState<readonly TagNode[] | null>(null);
  useEffect(() => {
    if (groupTag === null) return;
    let current = true;
    store
      .tags()
      .then((counts) => tagTree(counts, { capitalize: tagNames === "capitalized" }))
      .then(
        (next) => {
          if (current) setTree(next);
        },
        () => undefined, // The groups are a convenience: without them the list is whole.
      );
    return () => {
      current = false;
    };
  }, [store, groupTag, tagNames, library]);
  // The folder the tag was chosen in, when it shows in more than one.
  const chain = treeChain(useLocation().state);
  const groups = useMemo(
    () => (groupTag === null || tree === null ? null : tagGroups(tree, groupTag, chain)),
    [groupTag, tree, chain],
  );

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
    if (rows.length > 0 && groups && groups.groups.length > 0 && rows === hitRows) {
      content = <GroupedList rows={rows} groups={groups} />;
    } else if (rows.length > 0) {
      // A result opens with the same words searched in the note (tags are not text).
      content = <ResultList rows={rows} find={searching ? parsed.words.join(" ") : ""} />;
    } else if (searching && found?.query === query) {
      content = <EmptyState title={t("list.noMatches")} />;
    } else if (!searching) {
      content = <Welcome store={store} library={controls} />;
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
 * Tab goes from note to note as links do; Shift+Tab on the first one goes
 * back to the search box too (whose Tab comes here).
 */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key === "Tab") {
    backToSearch(event);
    return;
  }
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

/** Shift+Tab on the first note: back to the search box. */
function backToSearch(event: KeyboardEvent<HTMLElement>) {
  if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
  const first = event.currentTarget.querySelector<HTMLAnchorElement>(".note-result-title");
  const search = document.querySelector<HTMLInputElement>("[role=search] input");
  if (first !== document.activeElement || !search) return;
  event.preventDefault();
  search.focus();
}

/** How many columns the list's grid has now (one where there is no layout). */
function gridColumns(list: HTMLElement): number {
  const tracks = getComputedStyle(list).gridTemplateColumns.split(" ").filter(Boolean);
  return Math.max(1, tracks.length);
}

const ResultList = memo(function ResultList({
  rows,
  find,
}: {
  rows: readonly Row[];
  /** The words searched for, to search the note opened for them too. */
  find: string;
}) {
  return (
    <ol className="note-results" aria-label={t("list.notes")} onKeyDown={moveFocus}>
      {rows.map((row) => (
        <ResultRow key={row.id} row={row} find={find} />
      ))}
    </ol>
  );
});

/** A folder below the tag, with the found notes in it and the folders below it. */
type FoundGroup = TagGroup & { readonly rows: readonly Row[]; readonly children: FoundGroup[] };

/**
 * The groups nested as their folders are (`groups` come depth first, each
 * with its level), each with the rows found in it; only those with a row in
 * them or below them.
 */
function nestGroups(groups: readonly TagGroup[], rows: readonly Row[]): FoundGroup[] {
  const roots: FoundGroup[] = [];
  const open: FoundGroup[] = [];
  for (const group of groups) {
    const ids = new Set(group.noteIds);
    const found: FoundGroup = {
      ...group,
      rows: rows.filter((row) => ids.has(row.id)),
      children: [],
    };
    open.length = group.level - 1;
    (open.at(-1)?.children ?? roots).push(found);
    open.push(found);
  }
  const prune = (list: FoundGroup[]): FoundGroup[] =>
    list
      .map((group) => ({ ...group, children: prune(group.children) }))
      .filter((group) => group.rows.length > 0 || group.children.length > 0);
  return prune(roots);
}

/**
 * A tag's list on a small screen: the notes in the tag's folder itself (and
 * any found nowhere below it), then those of every folder below it, depth
 * first, under a thin line with the tag's name (a link to its own list),
 * each level a little further in. A note in several folders shows in each; a
 * folder with no found note in it or below it shows no line. Each group holds
 * the groups below it, so as the page scrolls the lines of the group being
 * read and of those above it stay stacked at the top (`app.css`). One column,
 * so the arrow keys go through every group.
 */
function GroupedList({
  rows,
  groups,
}: {
  rows: readonly Row[];
  groups: NonNullable<ReturnType<typeof tagGroups>>;
}) {
  const nested = nestGroups(groups.groups, rows);
  const own = new Set(groups.noteIds);
  const below = new Set<string>();
  const collect = (list: readonly FoundGroup[]) => {
    for (const group of list) {
      group.rows.forEach((row) => below.add(row.id));
      collect(group.children);
    }
  };
  collect(nested);
  const top = rows.filter((row) => own.has(row.id) || !below.has(row.id));
  return (
    <div className="note-groups" onKeyDown={moveFocus}>
      {top.length > 0 && (
        <ol className="note-results" aria-label={t("list.notes")}>
          {top.map((row) => (
            <ResultRow key={row.id} row={row} find="" />
          ))}
        </ol>
      )}
      {nested.map((group) => (
        <NoteGroup key={group.chain} group={group} />
      ))}
    </div>
  );
}

function NoteGroup({ group }: { group: FoundGroup }) {
  return (
    <section className="note-group" style={{ "--level": group.level } as CSSProperties}>
      <div className="tag-divider">
        <Link
          to={`/?q=${encodeURIComponent(`#${group.tag.name}`)}`}
          // As a tree folder's name: a new note made there starts with this chain.
          state={{ tagChain: group.chain }}
        >
          {group.label}
        </Link>
      </div>
      {group.rows.length > 0 && (
        <ol className="note-results" aria-label={group.label}>
          {group.rows.map((row) => (
            <ResultRow key={row.id} row={row} find="" />
          ))}
        </ol>
      )}
      {group.children.map((child) => (
        <NoteGroup key={child.chain} group={child} />
      ))}
    </section>
  );
}

/**
 * A conspect, the same in the list and in search results: its cover beside
 * four lines of text, about as tall as the cover: the title; the date it was
 * last edited and its tags; two of the text (where a search matched it). On a
 * small screen the row is smaller: a small cover with the date on it as a
 * chip, then the title and the tags, no text.
 */
const ResultRow = memo(function ResultRow({ row, find }: { row: Row; find: string }) {
  return (
    <li className="note-result">
      <div className="note-result-preview">
        <ListCover id={row.id} cover={row.cover} color={row.color} title={row.title} />
        {/* Shown instead of the date beside the title on a small screen (`app.css`). */}
        {row.updated !== null && (
          <span className="note-result-date-chip">
            <NoteDate value={row.updated} short />
          </span>
        )}
      </div>
      <div className="note-result-body">
        <Link
          to={`/conspects/${encodeURIComponent(row.id)}`}
          className="note-result-title"
          {...(find !== "" ? { state: { find } } : {})}
        >
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
 * The note's cover, or its title's first letter on the note's colour: the one
 * its frontmatter sets, or else a pastel its id picks, so each note keeps it.
 */
function ListCover({
  id,
  cover,
  color,
  title,
}: {
  id: string;
  cover: string | null;
  color: string | null;
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
      style={colorStyle(id, color)}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

const graphemes = new Intl.Segmenter();

/** The keys the welcome shows: enough to start; "?" shows the rest. */
const WELCOME_KEYS: readonly ShortcutName[] = [
  "newNote",
  "search",
  "find",
  "editorMode",
  "toggleSidebar",
];

function Welcome({
  store,
  library,
}: {
  store: NoteRepository;
  library: LibraryControls | undefined;
}) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  // A desktop without folders has nowhere to keep a conspect yet.
  const folders = useLibraryFolders(library);
  const noFolder = library !== undefined && folders.every((folder) => !folder.available);
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <h2 id="welcome-title">{t("welcome.title")}</h2>
      <p>{rich("welcome.text", { tags: <code>#tags</code> })}</p>
      {library && <WelcomeFolder library={library} />}
      <div className="actions" hidden={noFolder}>
        <Link to="/conspects/new" className="button button-primary">
          {t("welcome.create")}
        </Link>
        <button
          type="button"
          className="button"
          disabled={adding}
          onClick={() => {
            setAdding(true);
            void store.create(t("welcome.exampleNote"), new Date()).then((note) => {
              void navigate(`/conspects/${encodeURIComponent(note.id)}`);
            });
          }}
        >
          {t("welcome.example")}
        </button>
        {/* A phone usually joins notes kept elsewhere: sync is one tap away. */}
        {isNativeMobile() && (
          <Link to="/settings#sync" className="button">
            {t("welcome.sync")}
          </Link>
        )}
      </div>
      <p className="setting-hint">
        {rich("welcome.import", {
          md: <code>.md</code>,
          settings: <Link to="/settings">{t("welcome.settings")}</Link>,
        })}
      </p>
      <div className="welcome-keys">
        <p className="setting-hint">{rich("welcome.keys", { help: <kbd>?</kbd> })}</p>
        <ShortcutList only={WELCOME_KEYS} />
      </div>
    </section>
  );
}

/**
 * The desktop's folders: ~/Konspecter at first (ADR-024), more added at will
 * (ADR-030). Without any, a folder is what the welcome asks for first.
 */
function WelcomeFolder({ library }: { library: LibraryControls }) {
  const folders = useLibraryFolders(library);
  return (
    <div className="welcome-folder">
      <p className="setting-hint">
        {folders.length === 0
          ? rich("welcome.noFolder", { md: <code>.md</code> })
          : rich("welcome.folder", {
              folder: <strong>{folders.map((folder) => folder.path).join(", ")}</strong>,
              md: <code>.md</code>,
            })}
      </p>
      <AddFolderButton
        library={library}
        label={t("welcome.addFolder")}
        primary={folders.length === 0}
      />
    </div>
  );
}
