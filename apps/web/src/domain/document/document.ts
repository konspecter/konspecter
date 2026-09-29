import { Document, isMap, parseDocument as parseYaml } from "yaml";

/**
 * A note's Markdown text is the canonical document. It may start with a YAML
 * frontmatter block holding metadata:
 *
 *     ---
 *     title: Java Collections
 *     created: 2026-09-28T10:15:00Z
 *     updated: 2026-09-28T10:15:00Z
 *     cover: null
 *     ---
 *
 *     # Java Collections
 *
 * Every field is optional; `null` and an absent key mean the same thing.
 * Unknown keys are allowed and preserved when metadata is updated.
 * See docs/architecture/markdown-format.md.
 */
export type Metadata = {
  readonly title: string | null;
  /** ISO 8601 date or date-time with a time zone. */
  readonly created: string | null;
  /** ISO 8601 date or date-time with a time zone. */
  readonly updated: string | null;
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

const METADATA_KEYS = ["title", "created", "updated", "cover", "conflictOf"] as const;

/** How each field is spelled in the frontmatter. */
const FRONTMATTER_KEY: Record<keyof Metadata, string> = {
  title: "title",
  created: "created",
  updated: "updated",
  cover: "cover",
  conflictOf: "conflict_of",
};

const EMPTY_METADATA: Metadata = {
  title: null,
  created: null,
  updated: null,
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
  return {
    title: readText(record, "title"),
    created: readTimestamp(record, "created"),
    updated: readTimestamp(record, "updated"),
    cover: readText(record, "cover"),
    conflictOf: readText(record, "conflict_of"),
  };
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

/**
 * Writes a document in canonical form: non-null metadata in a fixed key order,
 * a blank line, then the body. Without metadata the result is just the body.
 */
export function serializeDocument(document: MarkdownDocument): string {
  const fields = Object.fromEntries(
    METADATA_KEYS.flatMap((key) => {
      const value = document.metadata[key];
      return value === null ? [] : [[FRONTMATTER_KEY[key], value]];
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
 * kept as written. Throws InvalidDocumentError if the document or the result
 * is invalid.
 */
export function updateMetadata(markdown: string, changes: Partial<Metadata>): string {
  const { yaml, rest } = splitFrontmatter(markdown);
  if (yaml === null) {
    const metadata = { ...parseDocument(markdown).metadata, ...changes };
    const result = serializeDocument({ metadata, body: markdown.replace(/^\uFEFF/, "") });
    parseDocument(result);
    return result;
  }

  const frontmatter = parseFrontmatter(yaml);
  for (const key of METADATA_KEYS) {
    const value = changes[key];
    if (value === undefined) continue;
    if (value === null) {
      frontmatter.delete(FRONTMATTER_KEY[key]);
    } else {
      frontmatter.set(FRONTMATTER_KEY[key], value);
    }
  }
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
  const title = document.metadata.title?.trim();
  if (title) {
    return title;
  }
  const firstLine = document.body.split("\n").find((line) => line.trim() !== "") ?? "";
  const heading = /^ {0,3}#{1,6}(?=\s|$)(.*)$/.exec(firstLine);
  if (!heading) {
    return firstLine.trim();
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
