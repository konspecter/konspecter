import { memo, useEffect, useId, useRef, useState } from "react";
import {
  documentTitle,
  parseDocument,
  updateMetadata,
  type Metadata,
} from "../../domain/document/document";
import { firstLineTitle } from "../../domain/note/note";
import { coverDataUrl } from "../../infrastructure/files/cover-image";
import { isEmbeddedCover, uploadedCoverLabel } from "../components/CoverImage";
import { t } from "../i18n/i18n";

type MetadataFieldsProps = {
  /** The whole document; the fields read and write its frontmatter. */
  markdown: string;
  onChange: (markdown: string) => void;
  /** The body's first line while it is edited elsewhere (the text editor). */
  bodyTitle?: string | undefined;
  /** Shows every field even when empty; otherwise only fields with a value appear. */
  expanded?: boolean;
};

/**
 * Title, author and cover fields over the document's frontmatter. An empty
 * field removes the key, so the title falls back to the body's first line
 * again. Everything else in the frontmatter is kept as written. Fields stay
 * out of the way unless `expanded` while they only repeat the body (the title
 * is its heading) or are empty. Tags are not edited here: they are written in
 * the text, and removed from the frontmatter in the note's Details. A cover
 * can be a URL or path typed in, or an uploaded image stored as a `data:` URL.
 */
export const MetadataFields = memo(function MetadataFields({
  markdown,
  onChange,
  bodyTitle,
  expanded = false,
}: MetadataFieldsProps) {
  const titleId = useId();
  const authorId = useId();
  const coverId = useId();
  const document = parseDocument(markdown);
  const { title, author, cover } = document.metadata;
  const derivedTitle =
    bodyTitle ?? documentTitle({ ...document, metadata: { ...document.metadata, title: null } });

  // An upload finishes later; it applies to the frontmatter as it is by then.
  const latest = useRef(markdown);
  useEffect(() => {
    latest.current = markdown;
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFailed, setUploadFailed] = useState(false);

  function set(field: keyof Pick<Metadata, "title" | "author" | "cover">, value: string) {
    onChange(updateMetadata(latest.current, { [field]: value === "" ? null : value }));
  }

  async function upload(file: File) {
    try {
      const dataUrl = await coverDataUrl(file);
      setUploadFailed(false);
      set("cover", dataUrl);
    } catch {
      setUploadFailed(true);
    }
  }

  // Whether each field says something the body does not. A field that did
  // once stays, also while its value is being cleared.
  const says = {
    title: title !== null && title.trim() !== firstLineTitle(document.body),
    author: author !== null,
    cover: cover !== null,
  };
  const [had, setHad] = useState(says);
  if ((Object.keys(says) as (keyof typeof says)[]).some((field) => says[field] && !had[field])) {
    setHad({
      title: had.title || says.title,
      author: had.author || says.author,
      cover: had.cover || says.cover,
    });
  }
  const showTitle = expanded || had.title || says.title;
  const showAuthor = expanded || had.author || says.author;
  const showCover = expanded || had.cover || says.cover;
  if (!showTitle && !showAuthor && !showCover) return null;
  // An uploaded cover is shown by its size, not as a page of base64.
  const uploaded = cover !== null && isEmbeddedCover(cover) ? uploadedCoverLabel(cover) : null;

  return (
    <div className="metadata-fields">
      {showTitle && (
        <>
          <label htmlFor={titleId} className="visually-hidden">
            {t("editor.title")}
          </label>
          <input
            id={titleId}
            className="title-field"
            value={title ?? ""}
            placeholder={derivedTitle || t("editor.title")}
            onChange={(event) => {
              set("title", event.target.value);
            }}
          />
        </>
      )}
      {showAuthor && (
        <div className="metadata-row">
          <label htmlFor={authorId} className="metadata-label">
            {t("editor.author")}
          </label>
          <input
            id={authorId}
            className="metadata-input"
            value={author ?? ""}
            onChange={(event) => {
              set("author", event.target.value);
            }}
          />
        </div>
      )}
      {showCover && (
        <div className="metadata-row">
          {uploaded !== null ? (
            <>
              <span className="metadata-label">{t("editor.cover")}</span>
              <span className="metadata-input cover-uploaded">{uploaded}</span>
            </>
          ) : (
            <>
              <label htmlFor={coverId} className="metadata-label">
                {t("editor.cover")}
              </label>
              <input
                id={coverId}
                className="metadata-input"
                value={cover ?? ""}
                placeholder="https://…"
                inputMode="url"
                onChange={(event) => {
                  set("cover", event.target.value);
                }}
              />
            </>
          )}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              fileInput.current?.click();
            }}
          >
            {uploaded !== null ? t("editor.coverReplace") : t("editor.coverUpload")}
          </button>
          {uploaded !== null && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                set("cover", "");
              }}
            >
              {t("editor.coverRemove")}
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
            hidden
            aria-label={t("editor.coverUpload")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
        </div>
      )}
      {uploadFailed && (
        <p role="alert" className="metadata-error">
          {t("editor.coverUploadFailed")}
        </p>
      )}
    </div>
  );
});
