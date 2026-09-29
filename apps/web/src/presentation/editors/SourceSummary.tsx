import { memo, useDeferredValue, useMemo } from "react";
import { noteTitle, noteWrittenTags, readNote } from "../../domain/note/note";
import { t } from "../i18n/i18n";

/**
 * Above the Markdown source: the title and tags the app reads from the
 * document (the heading or `title:`, the `#tags` in the text and the `tags:`
 * list), read-only. They live in the text alone; nothing is written into the
 * frontmatter for them (one source). Follows the typing, a step behind.
 */
export const SourceSummary = memo(function SourceSummary({ markdown }: { markdown: string }) {
  const deferred = useDeferredValue(markdown);
  const { title, tags } = useMemo(() => {
    const read = readNote({ id: "", markdown: deferred });
    return { title: read.valid ? noteTitle(read) : "", tags: noteWrittenTags(read) };
  }, [deferred]);
  if (title === "" && tags.length === 0) return null;

  return (
    <dl className="source-summary" aria-label={t("editor.found")}>
      {title !== "" && (
        <div>
          <dt>{t("editor.found.title")}</dt>
          <dd>{title}</dd>
        </div>
      )}
      {tags.length > 0 && (
        <div>
          <dt>{t("editor.found.tags")}</dt>
          <dd>
            {tags.map((tag) => (
              <span key={tag} className="md-tag">
                #{tag}
              </span>
            ))}
          </dd>
        </div>
      )}
    </dl>
  );
});
