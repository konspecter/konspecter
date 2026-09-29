import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { InvalidDocumentError } from "../../domain/document/document";
import { noteUpdated, readNote, type Note } from "../../domain/note/note";
import type { ReadingPositionMode } from "../../domain/reading/reading";
import type { EditorMode } from "../../domain/settings/settings";
import { Autosave } from "../../application/notes/autosave";
import { exportFiles } from "../../application/library/export-notes";
import type { NoteRepository } from "../../application/notes/note-repository";
import { exportToFolder, FolderError, isDesktop } from "../../infrastructure/desktop/desktop";
import { downloadFile } from "../../infrastructure/files/files";
import { requestPersistence } from "../../infrastructure/storage/persistence";
import type { Activity } from "../app/activity";
import { CoverImage } from "../components/CoverImage";
import { ErrorState, errorMessage } from "../components/ErrorState";
import { NoteDate } from "../components/NoteDate";
import { NoteNotFound } from "../components/NoteNotFound";
import { displayTitle } from "../components/note-title";
import { LazyNoteEditor } from "../editors/LazyNoteEditor";
import { useAsync } from "../hooks/use-async";
import { useReadingPosition } from "../hooks/use-reading-position";
import { useShortcuts } from "../hooks/use-shortcuts";

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
 * save gives it an id, or an edit becomes a conflict copy, the URL changes
 * but the editing session (and the editor, caret and all) stays mounted.
 */
export function NotePage({ store, mode, activity, readingPosition = "restore" }: NotePageProps) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [adopted, setAdopted] = useState<Adopted | null>(null);
  const continued = id !== undefined && adopted?.id === id ? adopted : null;

  const target = id !== undefined && continued === null ? id : null;
  const load = useCallback(
    () => (target === null ? Promise.resolve(undefined) : store.get(target)),
    [store, target],
  );
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
  if (id === undefined) {
    note = null;
  } else if (continued) {
    note = continued.note;
  } else if (loaded.status === "loading") {
    // A local read takes a moment; show nothing rather than a loading screen.
    return null;
  } else if (loaded.status === "error") {
    return (
      <ErrorState title="Could not load the note" error={loaded.error} onRetry={loaded.retry} />
    );
  } else if (!loaded.value) {
    return <NoteNotFound />;
  } else {
    note = loaded.value;
  }
  return (
    <NoteSession
      key={sessionKey}
      initial={note}
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
  store: NoteRepository;
  mode: EditorMode;
  activity: Activity;
  readingPosition: ReadingPositionMode;
  onAdopt: (note: Note) => void;
};

const changedOnDisk = (error: unknown) =>
  error instanceof FolderError && error.code === "changed_on_disk";

function NoteSession({
  initial,
  store,
  mode,
  activity,
  readingPosition,
  onAdopt,
}: NoteSessionProps) {
  const navigate = useNavigate();
  // What the editor was opened with; a new key remounts it with other text.
  const [opened, setOpened] = useState({ markdown: initial?.markdown ?? "", key: 0 });
  // The latest stored version: title, dates and cover come from it.
  const [saved, setSaved] = useState(initial);
  const [problem, setProblem] = useState<unknown>(null);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [ready, setReady] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

  // `onAdopt` stays the same for a session: its key is the session's key.
  const [autosave] = useState(() => {
    let endActivity: (() => void) | null = null;
    return new Autosave(
      store,
      initial,
      {
        onSaved: setSaved,
        onProblem: setProblem,
        onCreated: (note, reason) => {
          onAdopt(note);
          if (reason === "new") {
            // Now there is something worth keeping: ask the browser not to evict it.
            void requestPersistence();
          } else {
            setChangedElsewhere(false);
            setOpened((previous) => ({ markdown: note.markdown, key: previous.key + 1 }));
          }
        },
        onBusy: (busy) => {
          endActivity?.();
          endActivity = busy ? activity.begin() : null;
        },
      },
      { changedUnderneath: changedOnDisk },
    );
  });

  // Save whatever is pending when leaving the note, the page or the tab. Once
  // this session is gone, its saves no longer steer the page (no navigation).
  useEffect(() => {
    autosave.attach();
    const flush = () => void autosave.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      autosave.detach();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [autosave]);

  // The note changed elsewhere (sync, another program): show that version if
  // nothing is unsaved here; otherwise the next save keeps both.
  useEffect(() => {
    let active = true;
    const stop = store.onChange((change) => {
      const current = autosave.note;
      if (change.source !== "remote" || !current) return;
      if (change.previousId === current.id) {
        void navigate(`/notes/${encodeURIComponent(change.noteId)}`, { replace: true });
        return;
      }
      if (change.noteId !== current.id) return;
      if (autosave.dirty) {
        setChangedElsewhere(true);
        return;
      }
      void store.get(current.id).then((note) => {
        if (!active || autosave.dirty || autosave.note?.id !== current.id) return;
        if (!note) {
          setChangedElsewhere(true);
          return;
        }
        autosave.rebase(note);
        setSaved(note);
        setOpened((previous) => ({ markdown: note.markdown, key: previous.key + 1 }));
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
  const title = read ? displayTitle(read) : "New note";
  const metadata = read?.valid ? read.document.metadata : null;

  return (
    <article className="note-page" aria-label={title}>
      <title>{`${title} · Konspecter`}</title>
      <h1 className="visually-hidden">{title}</h1>
      {metadata?.cover && <CoverImage src={metadata.cover} />}
      {metadata?.conflictOf && (
        <p role="note" className="conflict-banner">
          This is a conflict copy: it holds a version that was changed in two places at once.
          Compare it with{" "}
          <Link to={`/notes/${encodeURIComponent(metadata.conflictOf)}`}>the original</Link>, keep
          what you need, then delete this copy.
        </p>
      )}
      {changedElsewhere && (
        <p role="note" className="conflict-banner">
          This note was changed elsewhere while you were editing it. Your version is saved as a
          conflict copy, and the other one stays in this note.
        </p>
      )}
      {reading.resumePosition !== null && (
        <div className="resume-reading" role="status">
          <span>You were {Math.round(reading.resumePosition * 100)}% through this note.</span>
          <button type="button" className="button" onClick={reading.resume}>
            Continue reading
          </button>
          <button type="button" className="button" onClick={reading.dismiss}>
            Start from the top
          </button>
        </div>
      )}
      <LazyNoteEditor
        key={opened.key}
        initialMarkdown={opened.markdown}
        mode={mode}
        onChange={handleChange}
        onReady={handleReady}
        autoFocus={initial === null}
        showMetadata={showMetadata}
      />
      {problem !== null && (
        <p role="alert" className="inline-error">
          {problem instanceof InvalidDocumentError
            ? `Not saved: ${problem.message}. Fix the frontmatter and it saves again.`
            : `Could not save the note: ${errorMessage(problem)}. Your text is kept; the next change tries again.`}
        </p>
      )}
      {saved && (
        <NoteFooter
          note={saved}
          store={store}
          showMetadata={showMetadata}
          onToggleMetadata={() => {
            setShowMetadata((shown) => !shown);
          }}
          onDelete={async () => {
            await autosave.dispose();
            await store.delete(saved.id);
            void navigate("/", { replace: true });
          }}
        />
      )}
    </article>
  );
}

type NoteFooterProps = {
  note: Note;
  store: NoteRepository;
  showMetadata: boolean;
  onToggleMetadata: () => void;
  onDelete: () => Promise<void>;
};

/** Dates and the less frequent actions, kept quiet under the text. */
function NoteFooter({ note, store, showMetadata, onToggleMetadata, onDelete }: NoteFooterProps) {
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const read = readNote(note);
  const updated = noteUpdated(read);
  const created = read.valid ? read.document.metadata.created : null;

  async function handleDelete() {
    if (!window.confirm(`Delete “${displayTitle(read)}”? This cannot be undone.`)) return;
    setDeleting(true);
    setFailure(null);
    try {
      await onDelete();
    } catch (error) {
      setFailure(new Error(`Could not delete the note: ${errorMessage(error)}`));
      setDeleting(false);
    }
  }

  return (
    <footer className="note-footer">
      {(created ?? updated) !== null && (
        <p className="note-meta">
          {created !== null && (
            <>
              Created <NoteDate value={created} />
            </>
          )}
          {created !== null && updated !== null && " · "}
          {updated !== null && (
            <>
              Edited <NoteDate value={updated} />
            </>
          )}
        </p>
      )}
      <div className="note-actions">
        <button
          type="button"
          className="link-button"
          aria-expanded={showMetadata}
          onClick={onToggleMetadata}
        >
          Title and cover
        </button>
        {!store.openExternally && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              const [file] = exportFiles([note]);
              if (!file) return;
              if (isDesktop()) {
                void exportToFolder([file]).catch(setFailure);
              } else {
                downloadFile(file.name, new Blob([file.contents], { type: "text/markdown" }));
              }
            }}
          >
            {isDesktop() ? "Export…" : "Download .md"}
          </button>
        )}
        {store.openExternally && (
          <button
            type="button"
            className="link-button"
            onClick={() => void store.openExternally?.(note.id).catch(setFailure)}
          >
            Open in external editor
          </button>
        )}
        {store.reveal && (
          <button
            type="button"
            className="link-button"
            onClick={() => void store.reveal?.(note.id).catch(setFailure)}
          >
            Show in Finder
          </button>
        )}
        <button
          type="button"
          className="link-button link-button-danger"
          disabled={deleting}
          onClick={() => void handleDelete()}
        >
          Delete
        </button>
      </div>
      {failure !== null && (
        <p role="alert" className="inline-error">
          {errorMessage(failure)}
        </p>
      )}
    </footer>
  );
}
