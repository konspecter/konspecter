import { memo, useEffect, useId, useRef, useState } from "react";
import {
  documentTitle,
  frontmatterTags,
  parseDocument,
  setFrontmatterTags,
  updateMetadata,
  type Metadata,
} from "../../domain/document/document";
import { firstLineTitle } from "../../domain/note/note";
import { parseTagName, writtenTags } from "../../domain/tag/tags";
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
 * Title, author, tags and cover fields over the document's frontmatter. An
 * empty field removes the key, so the title falls back to the body's first
 * line again. Everything else in the frontmatter is kept as written. Fields
 * stay out of the way unless `expanded` while they only repeat the body (the
 * title is its heading, the tags are written in it) or are empty. The tags
 * are the frontmatter's `tags` list; those written in the body are removed in
 * the text, so they have no remove button. A cover can be a URL or path typed
 * in, or an uploaded image stored as a `data:` URL.
 */
export const MetadataFields = memo(function MetadataFields({
  markdown,
  onChange,
  bodyTitle,
  expanded = false,
}: MetadataFieldsProps) {
  const titleId = useId();
  const authorId = useId();
  const tagsId = useId();
  const coverId = useId();
  const document = parseDocument(markdown);
  const { title, author, cover } = document.metadata;
  const tags = frontmatterTags(markdown);
  const derivedTitle =
    bodyTitle ?? documentTitle({ ...document, metadata: { ...document.metadata, title: null } });
  const inBody = new Set(writtenTags(document.body).map((written) => parseTagName(written)?.name));
  const writtenInBody = (written: string) => inBody.has(parseTagName(written)?.name);

  // An upload finishes later; it applies to the frontmatter as it is by then.
  const latest = useRef(markdown);
  useEffect(() => {
    latest.current = markdown;
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [tagRejected, setTagRejected] = useState<string | null>(null);

  function set(field: keyof Pick<Metadata, "title" | "author" | "cover">, value: string) {
    onChange(updateMetadata(latest.current, { [field]: value === "" ? null : value }));
  }

  function addTag(text: string) {
    const written = text.trim().replace(/^#/, "");
    if (written === "") return;
    const tag = parseTagName(written);
    if (!tag) {
      setTagRejected(written);
      return;
    }
    setTagRejected(null);
    setTagDraft("");
    const current = frontmatterTags(latest.current);
    if (current.some((existing) => parseTagName(existing)?.name === tag.name)) return;
    onChange(setFrontmatterTags(latest.current, [...current, written]));
  }

  function removeTag(index: number) {
    const current = frontmatterTags(latest.current);
    onChange(setFrontmatterTags(latest.current, current.toSpliced(index, 1)));
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
    tags: tags.some((written) => !writtenInBody(written)),
    cover: cover !== null,
  };
  const [had, setHad] = useState(says);
  if ((Object.keys(says) as (keyof typeof says)[]).some((field) => says[field] && !had[field])) {
    setHad({
      title: had.title || says.title,
      author: had.author || says.author,
      tags: had.tags || says.tags,
      cover: had.cover || says.cover,
    });
  }
  const showTitle = expanded || had.title || says.title;
  const showAuthor = expanded || had.author || says.author;
  const showTags = expanded || had.tags || says.tags;
  const showCover = expanded || had.cover || says.cover;
  if (!showTitle && !showAuthor && !showTags && !showCover) return null;
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
      {showTags && (
        <div className="metadata-row">
          <label htmlFor={tagsId} className="metadata-label">
            {t("editor.tags")}
          </label>
          <div className="tag-chips">
            {tags.map((written, index) => (
              <span
                key={`${String(index)}:${written}`}
                className="tag-chip"
                title={writtenInBody(written) ? t("editor.tagInText") : undefined}
              >
                #{written}
                {!writtenInBody(written) && (
                  <button
                    type="button"
                    className="tag-chip-remove"
                    aria-label={t("editor.removeTag", { tag: `#${written}` })}
                    title={t("editor.removeTag", { tag: `#${written}` })}
                    onClick={() => {
                      removeTag(index);
                    }}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            <input
              id={tagsId}
              className="metadata-input tag-input"
              value={tagDraft}
              placeholder={t("editor.addTag")}
              aria-invalid={tagRejected !== null}
              onChange={(event) => {
                const { value } = event.target;
                if (value.endsWith(",")) {
                  addTag(value.slice(0, -1));
                } else {
                  setTagDraft(value);
                  setTagRejected(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                addTag(tagDraft);
              }}
            />
          </div>
        </div>
      )}
      {tagRejected !== null && (
        <p role="alert" className="metadata-error">
          {t("editor.notATag", { tag: tagRejected })}
        </p>
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
