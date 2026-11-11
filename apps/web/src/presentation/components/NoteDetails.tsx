import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { exportFiles } from "../../application/library/export-notes";
import type { NoteRepository } from "../../application/notes/note-repository";
import { otherMetadata } from "../../domain/document/document";
import { documentStats } from "../../domain/document/stats";
import {
  listedOnlyTags,
  noteUpdated,
  noteWrittenTags,
  readNote,
  type Note,
} from "../../domain/note/note";
import { writtenTagList } from "../../domain/tag/tags";
import { exportToFolder, isDesktop } from "../../infrastructure/desktop/desktop";
import { downloadFile } from "../../infrastructure/files/files";
import { useErrorMessage } from "../hooks/use-error-message";
import {
  DownloadIcon,
  ExternalIcon,
  RevealIcon,
  TitleCoverIcon,
  TrashIcon,
} from "@konspecter/ui/icons";
import { NoteDate } from "./NoteDate";
import { displayTitle } from "./note-title";
import { t, tn } from "../i18n/i18n";
import { ConfirmDialog } from "./ConfirmDialog";
import { isEmbeddedCover, uploadedCoverLabel } from "./CoverImage";
import { ColorPicker } from "./ColorPicker";

type NoteDetailsProps = {
  /** The stored note; null while a new note has not been saved yet. */
  note: Note | null;
  store: NoteRepository;
  showMetadata: boolean;
  onToggleMetadata: () => void;
  /** Removes a tag from the frontmatter's `tags` list (one the body does not write). */
  onRemoveTag?: (written: string) => void;
  /** Sets the note's colour in its frontmatter (`color`), or removes it with null. */
  onSetColor?: (color: string | null) => void;
  onDelete: () => Promise<void>;
};

/**
 * The open note's details, shown in the sidebar's footer: what the document
 * says about itself (dates, author, length, tags, cover, other frontmatter fields)
 * and the less frequent actions, as icon buttons. A tag only the frontmatter
 * lists can be removed here; one written in the text is removed there.
 */
export function NoteDetails({
  note,
  store,
  showMetadata,
  onToggleMetadata,
  onRemoveTag,
  onSetColor,
  onDelete,
}: NoteDetailsProps) {
  const headingId = useId();
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; deleting: boolean } | null>(null);
  const failureText = useErrorMessage(failure?.error ?? null);
  const fail = (error: unknown) => {
    setFailure({ error, deleting: false });
  };
  const read = note ? readNote(note) : null;
  // The colour just picked, shown until the save it made comes back as `note`.
  const [picked, setPicked] = useState<{ color: string | null; markdown: string } | null>(null);
  const color =
    picked !== null && picked.markdown === note?.markdown
      ? picked.color
      : read?.valid
        ? read.document.metadata.color
        : null;

  async function handleDelete() {
    setConfirming(false);
    setDeleting(true);
    setFailure(null);
    try {
      await onDelete();
    } catch (error) {
      setFailure({ error, deleting: true });
      setDeleting(false);
    }
  }

  const rows: [string, ReactNode][] = [];
  if (!read || !note) {
    rows.push([t("details.status"), t("details.notSaved")]);
  } else {
    const created = read.valid ? read.document.metadata.created : null;
    const updated = noteUpdated(read);
    if (created !== null) rows.push([t("details.created"), <NoteDate value={created} withTime />]);
    if (updated !== null) rows.push([t("details.edited"), <NoteDate value={updated} withTime />]);
    if (read.valid) {
      const { author } = read.document.metadata;
      if (author) rows.push([t("details.author"), author]);
      const stats = documentStats(read.document.body);
      // A line each: one line of all three would wrap at other places as the
      // numbers grow, and the panel would change its height while typing.
      rows.push([
        t("details.length"),
        stats.words === 0 ? (
          t("details.empty")
        ) : (
          <span className="details-length">
            <span>{tn("details.words", stats.words)}</span>
            <span>{tn("details.characters", stats.characters)}</span>
            <span>{t("details.readingTime", { minutes: stats.readingMinutes })}</span>
          </span>
        ),
      ]);
      const tags = writtenTagList(noteWrittenTags(read));
      const removable = new Set(listedOnlyTags(read));
      if (tags.length > 0) {
        rows.push([
          t("details.tags"),
          <span className="details-tags">
            {tags.map(({ tag, written }) => {
              const label = t("details.removeTag", { tag: `#${written}` });
              return (
                <span key={tag.name} className="details-tag">
                  <Link to={`/?q=${encodeURIComponent(`#${tag.name}`)}`}>#{written}</Link>
                  {onRemoveTag && removable.has(tag.name) && (
                    <button
                      type="button"
                      className="details-tag-remove"
                      aria-label={label}
                      title={label}
                      onClick={() => {
                        onRemoveTag(written);
                      }}
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
          </span>,
        ]);
      }
      const { cover } = read.document.metadata;
      if (cover) {
        rows.push([t("details.cover"), isEmbeddedCover(cover) ? uploadedCoverLabel(cover) : cover]);
      }
      for (const { key, value } of otherMetadata(note.markdown)) rows.push([key, value]);
    } else {
      rows.push([t("details.frontmatter"), t("details.unreadable")]);
    }
    if (store.reveal) rows.push([t("details.file"), note.id]);
  }

  return (
    <section className="note-details" aria-labelledby={headingId}>
      <h2 id={headingId} className="sidebar-heading">
        {t("details.title")}
      </h2>
      <dl className="details-list">
        {rows.map(([term, value]) => (
          <div key={term} className="details-row">
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="details-actions" role="group" aria-label={t("details.actions")}>
        {note && read?.valid && onSetColor && (
          <ColorPicker
            id={note.id}
            color={color}
            onPick={(next) => {
              setPicked({ color: next, markdown: note.markdown });
              onSetColor(next);
            }}
          />
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={t("details.properties")}
          title={t("details.properties")}
          aria-expanded={showMetadata}
          onClick={onToggleMetadata}
        >
          <TitleCoverIcon />
        </button>
        {note && !store.openExternally && (
          <button
            type="button"
            className="icon-button"
            aria-label={isDesktop() ? t("details.export") : t("details.download")}
            title={isDesktop() ? t("details.export") : t("details.download")}
            onClick={() => {
              const [file] = exportFiles([note]);
              if (!file) return;
              if (isDesktop()) {
                void exportToFolder([file]).catch(fail);
              } else {
                downloadFile(file.name, new Blob([file.contents], { type: "text/markdown" }));
              }
            }}
          >
            <DownloadIcon />
          </button>
        )}
        {note && store.openExternally && (
          <button
            type="button"
            className="icon-button"
            aria-label={t("details.openExternally")}
            title={t("details.openExternally")}
            onClick={() => void store.openExternally?.(note.id).catch(fail)}
          >
            <ExternalIcon />
          </button>
        )}
        {note && store.reveal && (
          <button
            type="button"
            className="icon-button"
            aria-label={t("details.reveal")}
            title={t("details.reveal")}
            onClick={() => void store.reveal?.(note.id).catch(fail)}
          >
            <RevealIcon />
          </button>
        )}
        {note && (
          <button
            type="button"
            className="icon-button icon-button-danger"
            aria-label={t("details.delete")}
            title={t("details.delete")}
            disabled={deleting}
            onClick={() => {
              setConfirming(true);
            }}
          >
            <TrashIcon />
          </button>
        )}
      </div>
      {failure !== null && failureText !== null && (
        <p role="alert" className="inline-error">
          {failure.deleting ? t("details.deleteFailed", { error: failureText }) : failureText}
        </p>
      )}
      {confirming && read && (
        <ConfirmDialog
          title={t("details.deleteTitle")}
          message={t(store.reveal ? "details.confirmDeleteFile" : "details.confirmDelete", {
            title: displayTitle(read),
          })}
          confirmLabel={t("details.delete")}
          danger
          onConfirm={() => void handleDelete()}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      )}
    </section>
  );
}
