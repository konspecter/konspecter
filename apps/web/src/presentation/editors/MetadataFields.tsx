import { memo, useId, useState } from "react";
import {
  documentTitle,
  parseDocument,
  updateMetadata,
  type Metadata,
} from "../../domain/document/document";

type MetadataFieldsProps = {
  /** The whole document; the fields read and write its frontmatter. */
  markdown: string;
  onChange: (markdown: string) => void;
  /** The body's first line while it is edited elsewhere (the text editor). */
  bodyTitle?: string | undefined;
  /** Shows both fields even when empty; otherwise only fields with a value appear. */
  expanded?: boolean;
};

/**
 * Title and cover fields over the document's frontmatter. An empty field
 * removes the key, so the title falls back to the body's first line again.
 * Everything else in the frontmatter is kept as written. Empty fields stay
 * out of the way (the body's heading is the title) unless `expanded`.
 */
export const MetadataFields = memo(function MetadataFields({
  markdown,
  onChange,
  bodyTitle,
  expanded = false,
}: MetadataFieldsProps) {
  const titleId = useId();
  const coverId = useId();
  const document = parseDocument(markdown);
  const { title, cover } = document.metadata;
  const derivedTitle =
    bodyTitle ??
    documentTitle({
      ...document,
      metadata: { ...document.metadata, title: null },
    });

  function set(field: keyof Pick<Metadata, "title" | "cover">, value: string) {
    onChange(updateMetadata(markdown, { [field]: value === "" ? null : value }));
  }

  // A field that had a value stays while it is being cleared.
  const [had] = useState({ title: title !== null, cover: cover !== null });
  const showTitle = expanded || had.title || title !== null;
  const showCover = expanded || had.cover || cover !== null;
  if (!showTitle && !showCover) return null;

  return (
    <div className="metadata-fields">
      {showTitle && (
        <>
          <label htmlFor={titleId} className="visually-hidden">
            Title
          </label>
          <input
            id={titleId}
            className="title-field"
            value={title ?? ""}
            placeholder={derivedTitle || "Title"}
            onChange={(event) => {
              set("title", event.target.value);
            }}
          />
        </>
      )}
      {showCover && (
        <div className="metadata-row">
          <label htmlFor={coverId}>Cover image</label>
          <input
            id={coverId}
            className="cover-field"
            value={cover ?? ""}
            placeholder="https://…"
            inputMode="url"
            onChange={(event) => {
              set("cover", event.target.value);
            }}
          />
        </div>
      )}
    </div>
  );
});
