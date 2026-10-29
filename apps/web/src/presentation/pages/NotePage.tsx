import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { InvalidDocumentError, updateMetadata } from "../../domain/document/document";
import { readNote, withoutTag, type Note } from "../../domain/note/note";
import type { EditorSelection, ReadingPositionMode } from "../../domain/reading/reading";
import type { EditorMode } from "../../domain/settings/settings";
import { Autosave, savesSettled } from "../../application/notes/autosave";
import { summarize, type NoteCatalog } from "../../application/notes/note-catalog";
import { pinChanges, setStoredPin } from "../../application/notes/note-pins";
import type { NoteRepository } from "../../application/notes/note-repository";
import { requestPersistence } from "../../infrastructure/storage/persistence";
import { saveBeforeClosing } from "../app/closing";
import { reportError } from "../app/errors";
import { pinKeyOf } from "../app/shortcuts";
import type { Activity } from "../app/activity";
import { CoverImage } from "../components/CoverImage";
import { ErrorState } from "../components/ErrorState";
import { Details } from "../components/details-slot";
import { NoteDetails } from "../components/NoteDetails";
import { NoteNotFound } from "../components/NoteNotFound";
import { newNoteMarkdown } from "../components/new-note";
import { listFind, NoteFindContext } from "../components/note-find";
import { TagSuggestContext } from "../components/tag-suggest";
import { headingInHash, type HeadingTarget } from "../components/note-heading";
import { displayTitle } from "../components/note-title";
import { LazyNoteEditor, preloadEditor } from "../editors/LazyNoteEditor";
import type { DocumentEdit } from "../editors/NoteEditor";
import { useAsync } from "../hooks/use-async";
import { useErrorMessage } from "../hooks/use-error-message";
import { useReadingPosition } from "../hooks/use-reading-position";
import { useShortcuts } from "../hooks/use-shortcuts";
import { t } from "../i18n/i18n";
import { rich } from "../i18n/rich";

type NotePageProps = {
  store: NoteRepository;
  /** Every note's summary: whose pin a key takes over (Mod+Alt+1…0). */
  catalog: NoteCatalog;
  mode: EditorMode;
  activity: Activity;
  readingPosition?: ReadingPositionMode;
};

/**
 * A session that started under another URL and continues as `id` (see
 * `adopt`). `from` is the id it had before: the URL still names it until the
 * navigation to `id` lands, a render after the state changed.
 */
type Adopted = {
  readonly id: string;
  readonly from: string | undefined;
  readonly key: string;
  readonly note: Note;
};

/**
 * A new note (/conspects/new) or an existing one (/conspects/:id), open in the
 * editor. Both routes render this component, so when a new note's first
 * save gives it an id, the URL changes but the editing session (and the
 * editor, caret and all) stays mounted.
 */
export function NotePage({
  store,
  catalog,
  mode,
  activity,
  readingPosition = "restore",
}: NotePageProps) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [adopted, setAdopted] = useState<Adopted | null>(null);
  // An adoption carries its session only over its own navigation. Gone to any
  // other note, it ends: the note it holds is the version as it was adopted,
  // and opening that note again later must read the latest from the store.
  const [shownId, setShownId] = useState(id);
  if (id !== shownId) {
    setShownId(id);
    if (adopted && id !== adopted.id) setAdopted(null);
  }
  const continued =
    id !== undefined && (adopted?.id === id || adopted?.from === id) ? adopted : null;
  // A heading followed in the tree (`#heading-2`): each navigation to it scrolls there.
  const headingIndex = headingInHash(location.hash);
  const heading = useMemo<HeadingTarget | null>(
    () => (headingIndex === null ? null : { index: headingIndex, key: location.key }),
    [headingIndex, location.key],
  );

  const target = id !== undefined && continued === null ? id : null;
  // After any save of the note still running (the editor just left it), so
  // the text shown is its latest. With it, where the caret was, to restore,
  // and the editor's code (the first time), so the note opens in one step.
  // An editor that fails to load reports that itself.
  const restoreCaret = readingPosition === "restore";
  const load = useCallback(async () => {
    if (target === null) return undefined;
    const editor = preloadEditor().catch(() => undefined);
    await savesSettled(store, target);
    const [found, reading] = await Promise.all([
      store.get(target),
      restoreCaret ? store.readingState(target).catch(() => null) : null,
      editor,
    ]);
    return found && { note: found, selection: reading?.selection ?? null };
  }, [store, target, restoreCaret]);
  const loaded = useAsync(load);

  const sessionKey =
    id === undefined ? `new:${location.key}` : continued ? continued.key : `note:${id}`;
  // A session adopts every id its note gets: a file can move again and again
  // (each pause while a tag is typed saves it into that tag's folder).
  const adopt = useCallback(
    (note: Note) => {
      setAdopted((previous) => ({
        id: note.id,
        from: previous?.key === sessionKey ? previous.id : id,
        key: sessionKey,
        note,
      }));
      void navigate(`/conspects/${encodeURIComponent(note.id)}`, { replace: true });
    },
    [sessionKey, id, navigate],
  );

  let note: Note | null;
  let selection: EditorSelection | null = null;
  if (id === undefined) {
    note = null;
  } else if (continued) {
    note = continued.note;
  } else if (loaded.status === "loading") {
    // A local read takes a moment; show nothing rather than a loading screen.
    return null;
  } else if (loaded.status === "error") {
    return <ErrorState title={t("note.loadFailed")} error={loaded.error} onRetry={loaded.retry} />;
  } else if (!loaded.value) {
    return <NoteNotFound />;
  } else {
    ({ note, selection } = loaded.value);
  }
  return (
    <NoteSession
      key={sessionKey}
      initial={note}
      initialSelection={selection}
      store={store}
      catalog={catalog}
      mode={mode}
      activity={activity}
      readingPosition={readingPosition}
      heading={heading}
      listQuery={listFind(location.state)}
      newMarkdown={id === undefined ? newNoteMarkdown(location.state) : ""}
      onAdopt={adopt}
    />
  );
}

type NoteSessionProps = {
  initial: Note | null;
  /** Where the caret was when the note was last open. */
  initialSelection: EditorSelection | null;
  store: NoteRepository;
  catalog: NoteCatalog;
  mode: EditorMode;
  activity: Activity;
  readingPosition: ReadingPositionMode;
  /** The heading to scroll to, if one was followed. */
  heading: HeadingTarget | null;
  /** The list's search the note was opened from, to search the note for. */
  listQuery: string | null;
  /** The text a new note starts with: the tag the list was filtered by, or nothing. */
  newMarkdown: string;
  onAdopt: (note: Note) => void;
};

function NoteSession({
  initial,
  initialSelection,
  store,
  catalog,
  mode,
  activity,
  readingPosition,
  heading,
  listQuery,
  newMarkdown,
  onAdopt,
}: NoteSessionProps) {
  const navigate = useNavigate();
  // A version stored elsewhere, for the editor to show in place.
  const [replacement, setReplacement] = useState<Note | null>(null);
  // A change made in the Details (a tag removed), for the editor to apply.
  const [edit, setEdit] = useState<DocumentEdit | null>(null);
  // The latest stored version: title, dates and cover come from it.
  const [saved, setSaved] = useState(initial);
  const [problem, setProblem] = useState<unknown>(null);
  const problemText = useErrorMessage(problem);
  const [deletedElsewhere, setDeletedElsewhere] = useState(false);
  const [ready, setReady] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  // A new note's text as it starts (the tag it was made with), and in the
  // Markdown source the caret after its frontmatter, where the text begins.
  const [startMarkdown] = useState(newMarkdown);
  const startSelection: EditorSelection | null =
    initial === null && startMarkdown !== "" && mode === "markdown"
      ? {
          editor: "markdown",
          anchor: startMarkdown.length,
          head: startMarkdown.length,
          focused: true,
        }
      : null;

  // `onAdopt` stays the same for a session: its key is the session's key.
  const [autosave] = useState(() => {
    let endActivity: (() => void) | null = null;
    return new Autosave(store, initial, {
      onSaved: (note) => {
        setSaved(note);
        setDeletedElsewhere(false); // Saving brought it back.
      },
      onProblem: setProblem,
      // The file was renamed after the title: the editing continues under the new id.
      onRenamed: onAdopt,
      onCreated: (note) => {
        onAdopt(note);
        // Now there is something worth keeping: ask the browser not to evict it.
        void requestPersistence();
      },
      onBusy: (busy) => {
        endActivity?.();
        endActivity = busy ? activity.begin() : null;
      },
    });
  });

  // Save whatever is pending when leaving the note, the page or the tab. Once
  // this session is gone, its saves no longer steer the page (no navigation).
  useEffect(() => {
    autosave.attach();
    const unregister = saveBeforeClosing(() => autosave.flush());
    const flush = () => void autosave.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unregister();
      autosave.detach();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [autosave]);

  // The note changed elsewhere (sync, another program): show that version,
  // unless something is unsaved here. Then the next save wins: the last write
  // wins, and this edit is the latest.
  useEffect(() => {
    let active = true;
    const stop = store.onChange((change) => {
      const current = autosave.note;
      if (change.source !== "remote" || !current) return;
      if (change.previousId === current.id) {
        void navigate(`/conspects/${encodeURIComponent(change.noteId)}`, { replace: true });
        return;
      }
      if (change.noteId !== current.id || autosave.dirty) return;
      void store.get(current.id).then((note) => {
        if (!active || autosave.dirty || autosave.note?.id !== current.id) return;
        setDeletedElsewhere(!note);
        if (!note) return;
        autosave.rebase(note);
        setSaved(note);
        setReplacement(note);
      });
    });
    return () => {
      active = false;
      stop();
    };
  }, [store, autosave, navigate]);

  // The next change is saved at once rather than after typing pauses: a pin
  // shows in Recent as soon as it is set.
  const saveNow = useRef(false);
  useShortcuts({
    save: () => void autosave.flush(),
    // Mod+Alt+1…0 pins this note to the key, or unpins it from the key it
    // holds. Its own frontmatter changes in the editor, so unsaved typing is
    // kept; other notes holding the key let go of it in the store. A note not
    // stored yet has no pin: the keys stay the browser's. Its pin is read from
    // its text as edited, not from the list of notes, which learns of a save
    // only once it is stored: pressed again before that, the key unpins.
    pinNote: (event: KeyboardEvent) => {
      const key = pinKeyOf(event);
      const current = autosave.note;
      const text = autosave.text;
      const library = catalog.getSnapshot();
      if (key === null || !current || text === null || library.status !== "ready") return false;
      const notes = [
        ...library.notes.filter((note) => note.id !== current.id),
        summarize({ id: current.id, markdown: text }),
      ];
      const now = new Date();
      for (const { noteId, pin } of pinChanges(notes, key, current.id)) {
        if (noteId !== current.id) {
          setStoredPin(store, noteId, pin, now).catch(reportError);
          continue;
        }
        saveNow.current = true;
        setEdit({ apply: (markdown) => updateMetadata(markdown, { pin }) });
      }
      return undefined;
    },
  });

  // The library's tags are offered as one is typed, but not this note's own:
  // a tag half typed, saved by a pause, is not offered back.
  const suggestTags = use(TagSuggestContext);
  const noteId = saved?.id ?? null;
  const suggestHere = useMemo(
    () => suggestTags && ((prefix: string) => suggestTags(prefix, noteId)),
    [suggestTags, noteId],
  );

  // The top bar's search searches this note; it ends with the session.
  const finding = use(NoteFindContext);
  const closeFind = finding?.onClose;
  useEffect(() => closeFind, [closeFind]);

  const handleChange = useCallback(
    (read: () => string) => {
      autosave.change(read);
      if (!saveNow.current) return;
      saveNow.current = false;
      void autosave.flush();
    },
    [autosave],
  );
  const handleReady = useCallback(() => {
    setReady(true);
  }, []);

  // Opened from the list's search results: the same search in the note, once
  // the editor is there, so it scrolls to the first match.
  const [openedFromSearch] = useState(listQuery);
  const startFind = finding?.onFind;
  useEffect(() => {
    if (ready && openedFromSearch !== null) startFind?.(openedFromSearch);
  }, [ready, openedFromSearch, startFind]);

  // A note opened at a heading or at a match stays there rather than going back to where it was read.
  const [openedAtHeading] = useState(heading !== null);
  const reading = useReadingPosition({
    store,
    noteId: saved?.id ?? "",
    mode: saved ? readingPosition : "off",
    ready,
    restore: !openedAtHeading && openedFromSearch === null,
  });

  const read = saved ? readNote(saved) : null;
  const title = read ? displayTitle(read) : t("note.new");
  const metadata = read?.valid ? read.document.metadata : null;

  return (
    <article className="note-page" aria-label={title}>
      <title>{t("app.title", { title })}</title>
      <h1 className="visually-hidden">{title}</h1>
      {metadata?.cover && <CoverImage src={metadata.cover} />}
      {metadata?.conflictOf && (
        <p role="note" className="conflict-banner">
          {rich("note.conflictCopy", {
            original: (
              <Link to={`/conspects/${encodeURIComponent(metadata.conflictOf)}`}>
                {t("note.theOriginal")}
              </Link>
            ),
          })}
        </p>
      )}
      {deletedElsewhere && (
        <p role="note" className="conflict-banner">
          {t("note.deletedElsewhere")}
        </p>
      )}
      {reading.resumePosition !== null && (
        <div className="resume-reading" role="status">
          <span>{t("note.resumeAt", { percent: Math.round(reading.resumePosition * 100) })}</span>
          <button type="button" className="button" onClick={reading.resume}>
            {t("note.continueReading")}
          </button>
          <button type="button" className="button" onClick={reading.dismiss}>
            {t("note.startFromTop")}
          </button>
        </div>
      )}
      <TagSuggestContext value={suggestHere}>
        <LazyNoteEditor
          initialMarkdown={initial?.markdown ?? startMarkdown}
          replacement={replacement}
          edit={edit}
          mode={mode}
          onChange={handleChange}
          onReady={handleReady}
          autoFocus={initial === null}
          titleFromFirstLine={initial === null}
          saved={saved}
          showMetadata={showMetadata}
          initialSelection={initialSelection ?? startSelection}
          onSelectionChange={reading.rememberSelection}
          heading={heading}
          {...(finding ? { find: finding.find, onFindCount: finding.onCount } : {})}
        />
      </TagSuggestContext>
      {problemText !== null && (
        <p role="alert" className="inline-error">
          {problem instanceof InvalidDocumentError
            ? t("note.notSavedInvalid", { reason: problem.message })
            : t("note.saveFailed", { error: problemText })}
        </p>
      )}
      <Details>
        <NoteDetails
          note={saved}
          store={store}
          showMetadata={showMetadata}
          onToggleMetadata={() => {
            setShowMetadata((shown) => !shown);
          }}
          onRemoveTag={(written) => {
            setEdit({ apply: (markdown) => withoutTag(markdown, written) });
          }}
          onDelete={async () => {
            if (!saved) return;
            await autosave.dispose();
            await store.delete(saved.id);
            void navigate("/", { replace: true });
          }}
        />
      </Details>
    </article>
  );
}
