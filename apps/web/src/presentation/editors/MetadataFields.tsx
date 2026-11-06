import { memo, useEffect, useId, useRef, useState } from "react";
import { parseDocument, updateMetadata, type Metadata } from "../../domain/document/document";
import { coverDataUrl } from "../../infrastructure/files/cover-image";
import { isEmbeddedCover, uploadedCoverLabel } from "../components/CoverImage";
import { t } from "../i18n/i18n";

type MetadataFieldsProps = {
  /** The whole document; the fields read and write its frontmatter. */
  markdown: string;
  onChange: (markdown: string) => void;
  /** Shows every field even when empty; otherwise only fields with a value appear. */
  expanded?: boolean;
};

/**
 * Author and cover fields over the document's frontmatter. An empty field
 * removes the key. Everything else in the frontmatter is kept as written.
 * Fields stay out of the way unless `expanded` while they are empty. There is
 * no title field: the title is read in the editor itself (the body's first
 * line), and a `title` set apart from it is edited in Markdown mode. Tags are
 * not edited here: they are written in the text, and removed from the
 * frontmatter in the note's Details. A cover can be a URL or path typed in,
 * or an uploaded image stored as a `data:` URL.
 */
export const MetadataFields = memo(function MetadataFields({
  markdown,
  onChange,
  expanded = false,
}: MetadataFieldsProps) {
  const authorId = useId();
  const coverId = useId();
  const { author, cover } = parseDocument(markdown).metadata;

  // An upload finishes later; it applies to the frontmatter as it is by then.
  const latest = useRef(markdown);
  useEffect(() => {
    latest.current = markdown;
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFailed, setUploadFailed] = useState(false);

  function set(field: keyof Pick<Metadata, "author" | "cover">, value: string) {
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

  // Whether each field has a value. A field that did once stays, also while
  // its value is being cleared, until the fields are hidden: then the ones
  // emptied meanwhile go too.
  const says = {
    author: author !== null,
    cover: cover !== null,
  };
  const [remembered, setRemembered] = useState(says);
  const [wasExpanded, setWasExpanded] = useState(expanded);
  let had = remembered;
  if (expanded !== wasExpanded) {
    setWasExpanded(expanded);
    if (!expanded) {
      had = says;
      setRemembered(says);
    }
  }
  if ((Object.keys(says) as (keyof typeof says)[]).some((field) => says[field] && !had[field])) {
    setRemembered({
      author: had.author || says.author,
      cover: had.cover || says.cover,
    });
  }
  const showAuthor = expanded || had.author || says.author;
  const showCover = expanded || had.cover || says.cover;
  if (!showAuthor && !showCover) return null;
  // An uploaded cover is shown by its size, not as a page of base64.
  const uploaded = cover !== null && isEmbeddedCover(cover) ? uploadedCoverLabel(cover) : null;

  return (
    <div className="metadata-fields">
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
