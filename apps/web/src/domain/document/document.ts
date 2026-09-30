import {
  Document,
  isCollection,
  isMap,
  isScalar,
  Scalar,
  parseDocument as parseYaml,
  type Node,
} from "yaml";

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
  /** Where the YAML starts in the text (after the opening delimiter line). */
  readonly start: number;
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
    return { yaml: null, start: 0, rest: markdown };
  }
  const afterOpening = markdown.slice(opening[0].length);
  const closing = CLOSING_DELIMITER.exec(afterOpening);
  if (!closing) {
    return { yaml: null, start: 0, rest: markdown };
  }
  return {
    yaml: afterOpening.slice(0, closing.index),
    start: opening[0].length,
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
    // The parser's own wording is not shown; the line says where to look.
    const line = error.linePos?.[0].line;
    throw new InvalidDocumentError(
      line === undefined
        ? "Frontmatter is not valid YAML"
        : `Frontmatter line ${String(line)} is not valid YAML`,
    );
  }
  if (document.contents !== null && !isMap(document.contents)) {
    throw new InvalidDocumentError("Frontmatter must be a set of key: value pairs");
  }
  return document;
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
  const fields = fieldsOf(parseFrontmatter(yaml));
  const edits = METADATA_KEYS.flatMap((field): FieldEdit[] => {
    const value = changes[field];
    if (value === undefined) return [];
    const spellings = FRONTMATTER_KEYS[field];
    if (value === null) return spellings.map((key) => ({ key, value: null }));
    const present = spellings.filter((key) => fields.has(key));
    return (present.length > 0 ? present : [spellings[0]]).map((key) => ({ key, value }));
  });
  return editFrontmatter(markdown, edits);
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
  return editFrontmatter(markdown, [
    { key: TAGS_KEY, value: tags.length === 0 ? null : [...tags] },
  ]);
}

/** A frontmatter key set to a value (text or a list of texts), or removed with null. */
type FieldEdit = { readonly key: string; readonly value: string | readonly string[] | null };

/** The keys a frontmatter block has (none when it is empty). */
function fieldsOf(frontmatter: Document): Set<string> {
  const { contents } = frontmatter;
  if (!isMap(contents)) return new Set();
  return new Set(
    contents.items.flatMap((pair) => (isScalar(pair.key) ? [String(pair.key.value)] : [])),
  );
}

/**
 * Applies `edits` to an existing frontmatter block. Only the lines of the
 * edited keys change: every other line, and the delimiters and the body, stay
 * byte for byte as written (an editor showing the text sees nothing else
 * move). Throws InvalidDocumentError if the document or the result is invalid.
 */
function editFrontmatter(markdown: string, edits: readonly FieldEdit[]): string {
  const { yaml, start } = splitFrontmatter(markdown);
  const original = yaml ?? "";
  let edited = original;
  for (const edit of edits) edited = editField(edited, edit);
  const result = parseFrontmatter(edited);
  readMetadata(result);
  return markdown.slice(0, start) + edited + markdown.slice(start + original.length);
}

/** `yaml` with one field set or removed, rewriting only that field's lines. */
function editField(yaml: string, { key, value }: FieldEdit): string {
  const frontmatter = parseFrontmatter(yaml);
  const { contents } = frontmatter;
  if (contents !== null && (!isMap(contents) || contents.flow)) {
    return rewriteField(frontmatter, key, value);
  }
  const pair = contents?.items.find((item) => isScalar(item.key) && item.key.value === key);
  const newline = yaml.includes("\r\n") ? "\r\n" : "\n";
  let edited: string;
  if (pair === undefined) {
    if (value === null) return yaml;
    // A new key goes last, indented like the others.
    const first = contents?.items[0]?.key;
    const indent = isScalar(first) && first.range ? columnOf(yaml, first.range[0]) : "";
    const lines = yaml === "" || yaml.endsWith("\n") ? yaml : yaml + newline;
    edited = lines + indent + renderField(key, value, null, indent, newline) + newline;
  } else {
    const keyNode = pair.key as Scalar;
    const valueNode = isScalar(pair.value) || isCollection(pair.value) ? pair.value : null;
    const from = keyNode.range?.[0] ?? 0;
    // Up to the end of the value, not the line breaks or comment after it.
    let to = Math.max(keyNode.range?.[1] ?? from, valueNode?.range?.[1] ?? from);
    while (to > from && /\s/.test(yaml[to - 1] ?? "")) to -= 1;
    if (value === null) {
      const lineStart = yaml.lastIndexOf("\n", from - 1) + 1;
      const lineEnd = yaml.indexOf("\n", to);
      edited = yaml.slice(0, lineStart) + (lineEnd === -1 ? "" : yaml.slice(lineEnd + 1));
    } else {
      const indent = columnOf(yaml, from);
      edited =
        yaml.slice(0, from) + renderField(key, value, valueNode, indent, newline) + yaml.slice(to);
    }
  }
  // Whatever YAML the lines turn out to mean, the field must say just this.
  const check = parseYaml(edited);
  const written: unknown = isMap(check.contents) ? check.get(key) : undefined;
  const expected = value === null ? undefined : value;
  if (check.errors.length > 0 || JSON.stringify(toJS(written)) !== JSON.stringify(expected)) {
    return rewriteField(frontmatter, key, value);
  }
  return edited;
}

function toJS(value: unknown): unknown {
  return value !== null && typeof value === "object" && "toJSON" in value
    ? (value as { toJSON: () => unknown }).toJSON()
    : value;
}

/** The whitespace between the start of `offset`'s line and `offset`. */
function columnOf(text: string, offset: number): string {
  const indent = text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset);
  return /^[ \t]*$/.test(indent) ? indent : "";
}

/**
 * `key: value` as YAML, in the style of the value it replaces: a list stays
 * in flow style (`[a, b]`), a quoted text keeps its quotes.
 */
function renderField(
  key: string,
  value: string | readonly string[],
  previous: Node | null,
  indent: string,
  newline: string,
): string {
  const document = new Document({});
  const node = document.createNode(value);
  if (isCollection(node) && isCollection(previous) && previous.flow) node.flow = true;
  if (
    isScalar(node) &&
    isScalar(previous) &&
    (previous.type === Scalar.QUOTE_DOUBLE || previous.type === Scalar.QUOTE_SINGLE)
  ) {
    node.type = previous.type;
  }
  document.set(key, node);
  return document
    .toString(YAML_OPTIONS)
    .replace(/\n$/, "")
    .replace(/\n/g, newline + indent);
}

/** The fallback for YAML whose lines cannot be edited one field at a time: rewrites it all. */
function rewriteField(frontmatter: Document, key: string, value: FieldEdit["value"]): string {
  if (value === null) frontmatter.delete(key);
  else frontmatter.set(key, frontmatter.createNode(value));
  const hasContent = isMap(frontmatter.contents) && frontmatter.contents.items.length > 0;
  return hasContent ? frontmatter.toString(YAML_OPTIONS) : "";
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
