import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { InvalidDocumentError } from "../../domain/document/document";
import { readNote, withoutTag, type Note } from "../../domain/note/note";
import type { EditorSelection, ReadingPositionMode } from "../../domain/reading/reading";
import type { EditorMode } from "../../domain/settings/settings";
import { Autosave, savesSettled } from "../../application/notes/autosave";
import type { NoteRepository } from "../../application/notes/note-repository";
import { requestPersistence } from "../../infrastructure/storage/persistence";
import { saveBeforeClosing } from "../app/closing";
import type { Activity } from "../app/activity";
import { CoverImage } from "../components/CoverImage";
import { ErrorState, errorMessage } from "../components/ErrorState";
import { Details } from "../components/details-slot";
import { NoteDetails } from "../components/NoteDetails";
import { NoteNotFound } from "../components/NoteNotFound";
import { displayTitle } from "../components/note-title";
import { LazyNoteEditor } from "../editors/LazyNoteEditor";
import type { DocumentEdit } from "../editors/NoteEditor";
import { useAsync } from "../hooks/use-async";
import { useReadingPosition } from "../hooks/use-reading-position";
import { useShortcuts } from "../hooks/use-shortcuts";
import { t } from "../i18n/i18n";
import { rich } from "../i18n/rich";

type NotePageProps = {
  store: NoteRepository;
  mode: EditorMode;
  activity: Activity;
  readingPosition?: ReadingPositionMode;
};

/** A session that started under another URL and continues as `id` (see `adopt`). */
type Adopted = { readonly id: string; readonly key: string; readonly note: Note };

/**
 * A new note (/notes/new) or an existing one (/notes/:id), open in the
 * editor. Both routes render this component, so when a new note's first
 * save gives it an id, the URL changes but the editing session (and the
 * editor, caret and all) stays mounted.
 */
export function NotePage({ store, mode, activity, readingPosition = "restore" }: NotePageProps) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [adopted, setAdopted] = useState<Adopted | null>(null);
  const continued = id !== undefined && adopted?.id === id ? adopted : null;

  const target = id !== undefined && continued === null ? id : null;
  // After any save of the note still running (the editor just left it), so
  // the text shown is its latest. With it, where the caret was, to restore.
  const restoreCaret = readingPosition === "restore";
  const load = useCallback(async () => {
    if (target === null) return undefined;
    await savesSettled(store, target);
    const [found, reading] = await Promise.all([
      store.get(target),
      restoreCaret ? store.readingState(target).catch(() => null) : null,
    ]);
    return found && { note: found, selection: reading?.selection ?? null };
  }, [store, target, restoreCaret]);
  const loaded = useAsync(load);

  const sessionKey =
    id === undefined ? `new:${location.key}` : continued ? continued.key : `note:${id}`;
  const adopt = useCallback(
    (note: Note) => {
      setAdopted({ id: note.id, key: sessionKey, note });
      void navigate(`/notes/${encodeURIComponent(note.id)}`, { replace: true });
    },
    [sessionKey, navigate],
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
      mode={mode}
      activity={activity}
      readingPosition={readingPosition}
      onAdopt={adopt}
    />
  );
}

type NoteSessionProps = {
  initial: Note | null;
  /** Where the caret was when the note was last open. */
  initialSelection: EditorSelection | null;
  store: NoteRepository;
  mode: EditorMode;
  activity: Activity;
  readingPosition: ReadingPositionMode;
  onAdopt: (note: Note) => void;
};

function NoteSession({
  initial,
  initialSelection,
  store,
  mode,
  activity,
  readingPosition,
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
  const [deletedElsewhere, setDeletedElsewhere] = useState(false);
  const [ready, setReady] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

  // `onAdopt` stays the same for a session: its key is the session's key.
  const [autosave] = useState(() => {
    let endActivity: (() => void) | null = null;
    return new Autosave(store, initial, {
      onSaved: (note) => {
        setSaved(note);
        setDeletedElsewhere(false); // Saving brought it back.
      },
      onProblem: setProblem,
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
        void navigate(`/notes/${encodeURIComponent(change.noteId)}`, { replace: true });
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

  useShortcuts({ save: () => void autosave.flush() });

  const handleChange = useCallback(
    (read: () => string) => {
      autosave.change(read);
    },
    [autosave],
  );
  const handleReady = useCallback(() => {
    setReady(true);
  }, []);

  const reading = useReadingPosition({
    store,
    noteId: saved?.id ?? "",
    mode: saved ? readingPosition : "off",
    ready,
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
              <Link to={`/notes/${encodeURIComponent(metadata.conflictOf)}`}>
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
      <LazyNoteEditor
        initialMarkdown={initial?.markdown ?? ""}
        replacement={replacement}
        edit={edit}
        mode={mode}
        onChange={handleChange}
        onReady={handleReady}
        autoFocus={initial === null}
        titleFromFirstLine={initial === null}
        saved={saved}
        showMetadata={showMetadata}
        initialSelection={initialSelection}
        onSelectionChange={reading.rememberSelection}
      />
      {problem !== null && (
        <p role="alert" className="inline-error">
          {problem instanceof InvalidDocumentError
            ? t("note.notSavedInvalid", { reason: problem.message })
            : t("note.saveFailed", { error: errorMessage(problem) })}
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
