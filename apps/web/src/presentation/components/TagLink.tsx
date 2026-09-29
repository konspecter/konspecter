import { Link } from "react-router";
import type { Tag } from "../../domain/tag/tags";

/** The note list filtered to the tag and the tags below it (a search for `#tag`). */
export function tagPath(tag: Tag): string {
  return `/?q=${encodeURIComponent(`#${tag.name}`)}`;
}

type TagLinkProps = {
  tag: Tag;
  /** Defaults to the full name with a leading "#". */
  label?: string;
  current?: boolean;
};

export function TagLink({ tag, label, current = false }: TagLinkProps) {
  return (
    <Link to={tagPath(tag)} className="tag-link" {...(current ? { "aria-current": "page" } : {})}>
      {label ?? `#${tag.name}`}
    </Link>
  );
}
