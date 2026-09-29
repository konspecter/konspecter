import { Document, isMap, isSeq, parseDocument as parseYaml } from "yaml";

/**
 * A note's Markdown text is the canonical document. It may start with a YAML
 * frontmatter block holding metadata:
 *
 *     ---
 *     title: Java Collections
 *     created: 2026-09-28T10:15:00Z
 *     updated: 2026-09-28T10:15:00Z
 *     author: Ann
 *     cover: null
 *     ---
 *
 *     # Java Collections
 *
 * Every field is optional; `null` and an absent key mean the same thing.
 * The dates are also read as `create_at` and `updated_at`. Unknown keys are
 * allowed and preserved when metadata is updated.
 * See docs/architecture/markdown-format.md.
 */
export type Metadata = {
  readonly title: string | null;
  /** ISO 8601 date or date-time with a time zone. */
  readonly created: string | null;
  /** ISO 8601 date or date-time with a time zone. */
  readonly updated: string | null;
  /** Who wrote the note; a list of authors reads as one text. */
  readonly author: string | null;
  /** URL or path of a cover image. */
  readonly cover: string | null;
  /** Id of the note this one is a conflict copy of (frontmatter `conflict_of`). */
  readonly conflictOf: string | null;
};

export type MarkdownDocument = {
  readonly metadata: Metadata;
  readonly body: string;
};

export class InvalidDocumentError extends Error {
  override readonly name = "InvalidDocumentError";
}

const METADATA_KEYS = ["title", "created", "updated", "author", "cover", "conflictOf"] as const;

/**
 * How each field may be spelled in the frontmatter, the spelling the app
 * writes first. Other tools write `create_at` and `updated_at`.
 */
const FRONTMATTER_KEYS: Record<keyof Metadata, readonly [string, ...string[]]> = {
  title: ["title"],
  created: ["created", "create_at"],
  updated: ["updated", "updated_at"],
  author: ["author"],
  cover: ["cover"],
  conflictOf: ["conflict_of"],
};

const EMPTY_METADATA: Metadata = {
  title: null,
  created: null,
  updated: null,
  author: null,
  cover: null,
  conflictOf: null,
};

const OPENING_DELIMITER = /^\uFEFF?---[ \t]*\r?\n/;
const CLOSING_DELIMITER = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m;
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2}))?$/;
const YAML_OPTIONS = { lineWidth: 0, flowCollectionPadding: false } as const;

type Split = {
  /** The YAML between the delimiters, or null when there is no frontmatter. */
  readonly yaml: string | null;
  /** Everything after the closing delimiter line (or the whole text). */
  readonly rest: string;
};

/**
 * Frontmatter is recognized only when the text starts with a `---` line and a
 * later line is `---` or `...`. Otherwise the whole text is the body.
 */
function splitFrontmatter(markdown: string): Split {
  const opening = OPENING_DELIMITER.exec(markdown);
  if (!opening) {
    return { yaml: null, rest: markdown };
  }
  const afterOpening = markdown.slice(opening[0].length);
  const closing = CLOSING_DELIMITER.exec(afterOpening);
  if (!closing) {
    return { yaml: null, rest: markdown };
  }
  return {
    yaml: afterOpening.slice(0, closing.index),
    rest: afterOpening.slice(closing.index + closing[0].length),
  };
}

/** The body starts after the frontmatter and the conventional blank line that follows it. */
function bodyAfterFrontmatter(rest: string): string {
  return rest.replace(/^\r?\n/, "");
}

function parseFrontmatter(yaml: string): Document {
  const document = parseYaml(yaml);
  const [error] = document.errors;
  if (error) {
    throw new InvalidDocumentError(`Frontmatter is not valid YAML: ${firstLine(error.message)}`);
  }
  if (document.contents !== null && !isMap(document.contents)) {
    throw new InvalidDocumentError("Frontmatter must be a set of key: value pairs");
  }
  return document;
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? text;
}

function readMetadata(frontmatter: Document): Metadata {
  const values: unknown = frontmatter.toJS();
  if (values === null || values === undefined) {
    return EMPTY_METADATA;
  }
  const record = values as Record<string, unknown>;
  const key = (field: keyof Metadata) => spellingOf(record, field);
  return {
    title: readText(record, key("title")),
    created: readTimestamp(record, key("created")),
    updated: readTimestamp(record, key("updated")),
    author: readAuthor(record, key("author")),
    cover: readText(record, key("cover")),
    conflictOf: readText(record, key("conflictOf")),
  };
}

/** The first spelling of the field that has a value, else the canonical one. */
function spellingOf(record: Record<string, unknown>, field: keyof Metadata): string {
  const spellings = FRONTMATTER_KEYS[field];
  return spellings.find((key) => record[key] !== null && record[key] !== undefined) ?? spellings[0];
}

function readAuthor(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.length === 0 ? null : value.join(", ");
  }
  return readText(record, key);
}

function readText(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new InvalidDocumentError(`Frontmatter "${key}" must be text (wrap it in quotes)`);
  }
  return value;
}

function readTimestamp(record: Record<string, unknown>, key: string): string | null {
  const value = readText(record, key);
  if (value !== null && !isTimestamp(value)) {
    throw new InvalidDocumentError(
      `Frontmatter "${key}" must be an ISO 8601 date such as 2026-09-28T10:15:00Z`,
    );
  }
  return value;
}

export function isTimestamp(value: string): boolean {
  const match = TIMESTAMP.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) {
    return false;
  }
  // Date.parse rolls impossible days over (2026-02-30 becomes March 2).
  const [year, month, day] = match.slice(1, 4).map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
}

/** Second-precision UTC timestamp, the format the app writes. */
export function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Parses and validates a document. Throws InvalidDocumentError. */
export function parseDocument(markdown: string): MarkdownDocument {
  const { yaml, rest } = splitFrontmatter(markdown);
  if (yaml === null) {
    return { metadata: EMPTY_METADATA, body: markdown.replace(/^\uFEFF/, "") };
  }
  return { metadata: readMetadata(parseFrontmatter(yaml)), body: bodyAfterFrontmatter(rest) };
}

const TAGS_KEY = "tags";

/**
 * The tags listed in the frontmatter's `tags` field, as written, without a
 * leading "#": a list (`- java#collections`) or one string (`java, go` or
 * `java go`). Whether each is a valid tag is for the tag rules to decide.
 * Empty without valid frontmatter or without the field.
 */
export function frontmatterTags(markdown: string): string[] {
  const { yaml } = splitFrontmatter(markdown);
  if (yaml === null) return [];
  let values: unknown;
  try {
    values = parseFrontmatter(yaml).toJS();
  } catch {
    return [];
  }
  if (values === null || typeof values !== "object") return [];
  const field = (values as Record<string, unknown>)[TAGS_KEY];
  const items = Array.isArray(field)
    ? field
    : typeof field === "string"
      ? field.split(/[\s,]+/)
      : [];
  return items
    .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
    .map((item) => String(item).trim().replace(/^#/, ""))
    .filter((item) => item !== "");
}

/**
 * The frontmatter fields Konspecter does not manage itself (anything but
 * title, dates, author, cover, conflict_of and tags), in written order, with each value as
 * display text. Empty when there is no valid frontmatter.
 */
export function otherMetadata(markdown: string): { key: string; value: string }[] {
  const { yaml } = splitFrontmatter(markdown);
  if (yaml === null) return [];
  let values: unknown;
  try {
    values = parseFrontmatter(yaml).toJS();
  } catch {
    return [];
  }
  if (values === null || typeof values !== "object") return [];
  // Tags are shown with the note's other tags (`frontmatterTags`).
  const managed = new Set<string>([...Object.values(FRONTMATTER_KEYS).flat(), TAGS_KEY]);
  return Object.entries(values as Record<string, unknown>)
    .filter(([key, value]) => !managed.has(key) && value !== null && value !== undefined)
    .map(([key, value]) => ({ key, value: displayValue(value) }));
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

/**
 * Writes a document in canonical form: non-null metadata in a fixed key order,
 * a blank line, then the body. Without metadata the result is just the body.
 */
export function serializeDocument(document: MarkdownDocument): string {
  const fields = Object.fromEntries(
    METADATA_KEYS.flatMap((key) => {
      const value = document.metadata[key];
      return value === null ? [] : [[FRONTMATTER_KEYS[key][0], value]];
    }),
  );
  const hasMetadata = Object.keys(fields).length > 0;
  // A body that itself looks like frontmatter needs an empty block in front of
  // it, or it would be read back as metadata.
  if (!hasMetadata && splitFrontmatter(document.body).yaml === null) {
    return document.body;
  }
  const yaml = hasMetadata ? new Document(fields).toString(YAML_OPTIONS) : "";
  return `---\n${yaml}---\n\n${document.body}`;
}

/**
 * Sets (or, with null, removes) metadata fields in a document's text. The rest
 * of the frontmatter, including unknown keys and comments, and the body are
 * kept as written. A field is written under the spellings the document
 * already uses (`updated_at` stays `updated_at`). Throws InvalidDocumentError
 * if the document or the result is invalid.
 */
export function updateMetadata(markdown: string, changes: Partial<Metadata>): string {
  const { yaml } = splitFrontmatter(markdown);
  if (yaml === null) {
    const metadata = { ...parseDocument(markdown).metadata, ...changes };
    const result = serializeDocument({ metadata, body: markdown.replace(/^\uFEFF/, "") });
    parseDocument(result);
    return result;
  }
  return editFrontmatter(markdown, (frontmatter) => {
    for (const field of METADATA_KEYS) {
      const value = changes[field];
      if (value === undefined) continue;
      const spellings = FRONTMATTER_KEYS[field];
      if (value === null) {
        for (const key of spellings) frontmatter.delete(key);
        continue;
      }
      const present = spellings.filter((key) => frontmatter.has(key));
      for (const key of present.length > 0 ? present : [spellings[0]]) {
        frontmatter.set(key, value);
      }
    }
  });
}

/**
 * Replaces the frontmatter's `tags` field with `tags` (as written, without a
 * leading "#"), or removes it when there are none. A field written as
 * `[a, b]` keeps that style. Everything else is kept as written. Throws
 * InvalidDocumentError if the document is invalid.
 */
export function setFrontmatterTags(markdown: string, tags: readonly string[]): string {
  const { yaml } = splitFrontmatter(markdown);
  if (yaml === null) {
    if (tags.length === 0) return markdown;
    const block = new Document({ [TAGS_KEY]: [...tags] }).toString(YAML_OPTIONS);
    return `---\n${block}---\n\n${markdown.replace(/^\uFEFF/, "")}`;
  }
  return editFrontmatter(markdown, (frontmatter) => {
    if (tags.length === 0) {
      frontmatter.delete(TAGS_KEY);
      return;
    }
    const previous = frontmatter.get(TAGS_KEY, true);
    const list = frontmatter.createNode([...tags]);
    if (isSeq(previous) && previous.flow) list.flow = true;
    frontmatter.set(TAGS_KEY, list);
  });
}

/** Applies `edit` to an existing frontmatter block and keeps the body as written. */
function editFrontmatter(markdown: string, edit: (frontmatter: Document) => void): string {
  const { yaml, rest } = splitFrontmatter(markdown);
  const frontmatter = parseFrontmatter(yaml ?? "");
  edit(frontmatter);
  readMetadata(frontmatter);

  const hasContent = isMap(frontmatter.contents) && frontmatter.contents.items.length > 0;
  const updatedYaml = hasContent ? frontmatter.toString(YAML_OPTIONS) : "";
  return `---\n${updatedYaml}---\n${rest}`;
}

/**
 * The document's title: the `title` field, or else the first non-blank line of
 * the body without ATX heading markers. Empty for a document with neither.
 */
export function documentTitle(document: MarkdownDocument): string {
  return document.metadata.title?.trim() || bodyFirstLine(document.body);
}

/** A body's first non-blank line without ATX heading markers ("## Title ##" → "Title"). */
export function bodyFirstLine(body: string): string {
  const line = body.split("\n").find((text) => text.trim() !== "") ?? "";
  const heading = /^ {0,3}#{1,6}(?=\s|$)(.*)$/.exec(line);
  if (!heading) {
    return line.trim();
  }
  // Drop the optional closing sequence, as in "## Title ##".
  return (heading[1] ?? "").replace(/(?:^|\s)#+\s*$/, "").trim();
}

/**
 * Replaces the document's body and keeps its frontmatter block exactly as
 * written, including the blank line after it.
 */
export function replaceBody(markdown: string, body: string): string {
  const { yaml, rest } = splitFrontmatter(markdown);
  if (yaml === null) {
    return serializeDocument({ metadata: EMPTY_METADATA, body });
  }
  const frontmatter = markdown.slice(0, markdown.length - rest.length);
  const separator = /^\r?\n/.exec(rest)?.[0] ?? "";
  return frontmatter + separator + body;
}
