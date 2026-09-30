import { memo, useEffect, useMemo, useRef, type RefObject } from "react";
import Markdown, { type Components, type Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { findMatches, type Match } from "../../domain/search/find";
import { NO_FIND, revealMatch, type NoteFind } from "../components/note-find";
import { omitLeadingTitle } from "./omit-leading-title";
import { rehypeTags } from "./rehype-tags";
import "./markdown.css";

export type MarkdownViewProps = {
  /** The document body (without frontmatter). */
  markdown: string;
  /** The title the page already shows; a matching leading `# heading` is not repeated. */
  title: string;
  titleDerived: boolean;
  /** Called after the body has been rendered into the page. */
  onRendered?: () => void;
  /** What to find in the text (see `NoteEditor`). */
  find?: NoteFind;
  onFindCount?: (count: number) => void;
};

const remarkPlugins: Options["remarkPlugins"] = [remarkGfm];

const components: Components = {
  a({ node, href, children, ...props }) {
    const external = href !== undefined && /^(?:https?:)?\/\//i.test(href);
    return (
      <a
        {...props}
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  },
  // Long code lines scroll; tabIndex lets keyboard users scroll them too.
  pre({ node, ...props }) {
    return <pre {...props} tabIndex={0} />;
  },
  table({ node, ...props }) {
    return (
      <div className="markdown-table" tabIndex={0}>
        <table {...props} />
      </div>
    );
  },
  img({ node, alt, ...props }) {
    return <img {...props} alt={alt ?? ""} loading="lazy" />;
  },
};

/** Elements whose text is searched on its own: a match never runs from one into the next. */
const BLOCKS =
  "p, li, h1, h2, h3, h4, h5, h6, pre, td, th, blockquote, dt, dd, figcaption, summary";

type TextRun = { readonly node: Text; readonly start: number };

/** The rendered text as one string, and where each text node starts in it. */
function renderedText(root: HTMLElement): { text: string; runs: TextRun[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const runs: TextRun[] = [];
  let text = "";
  let block: Element | null = null;
  for (let node = walker.nextNode(); node instanceof Text; node = walker.nextNode()) {
    const here = node.parentElement?.closest(BLOCKS) ?? null;
    // A newline between blocks: nothing typed in the search box matches it.
    if (runs.length > 0 && here !== block) text += "\n";
    block = here;
    runs.push({ node, start: text.length });
    text += node.data;
  }
  return { text, runs };
}

/** The DOM range of `match` in the rendered text. */
function matchRange({ from, to }: Match, runs: readonly TextRun[]): Range {
  const range = new Range();
  const start = runs.findLast((run) => run.start <= from);
  const end = runs.findLast((run) => run.start < to);
  if (start) range.setStart(start.node, from - start.start);
  if (end) range.setEnd(end.node, to - end.start);
  return range;
}

// Where the CSS Custom Highlight API is missing, matches are counted and
// scrolled to, but not marked.
const highlights = typeof Highlight === "function" ? CSS.highlights : null;

/**
 * Marks the matches of `find` in the rendered text (`::highlight(find-match)`,
 * `::highlight(find-current)`); asked anew, scrolls to the selected one.
 * React owns the DOM, so the text is marked with ranges, not elements.
 */
function useFind(
  root: RefObject<HTMLElement | null>,
  find: NoteFind,
  onFindCount: ((count: number) => void) | undefined,
  // What the text is rendered from: when it changes, the text is searched again.
  markdown: string,
  plugins: Options["rehypePlugins"],
) {
  const revealed = useRef<number | null>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const { text, runs } = renderedText(element);
    const ranges = findMatches(text, find.query).map((match) => matchRange(match, runs));
    onFindCount?.(ranges.length);
    const current = ranges[Math.min(find.selected, ranges.length - 1)];
    if (current && revealed.current !== null && revealed.current !== find.reveal) {
      revealMatch(current.getBoundingClientRect());
    }
    revealed.current = find.reveal;
    if (!highlights || ranges.length === 0) return;
    highlights.set("find-match", new Highlight(...ranges.filter((range) => range !== current)));
    if (current) highlights.set("find-current", new Highlight(current));
    return () => {
      highlights.delete("find-match");
      highlights.delete("find-current");
    };
  }, [root, find, onFindCount, markdown, plugins]);
}

/**
 * Renders CommonMark + GFM as React elements (never via innerHTML). Raw HTML
 * in the Markdown is parsed and then sanitized with GitHub's allowlist, and
 * fenced code blocks with a language are syntax-highlighted.
 */
export const MarkdownView = memo(function MarkdownView({
  markdown,
  title,
  titleDerived,
  onRendered,
  find = NO_FIND,
  onFindCount,
}: MarkdownViewProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onRendered?.();
  }, [onRendered, markdown]);

  const rehypePlugins = useMemo<Options["rehypePlugins"]>(
    () => [
      rehypeRaw,
      // Sanitizing must come after raw HTML is parsed and before anything adds
      // markup of its own (highlighting spans).
      rehypeSanitize,
      [rehypeHighlight, { detect: false }],
      rehypeTags,
      [omitLeadingTitle, { title, derived: titleDerived }],
    ],
    [title, titleDerived],
  );
  useFind(root, find, onFindCount, markdown, rehypePlugins);

  return (
    <div ref={root} className="markdown">
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {markdown}
      </Markdown>
    </div>
  );
});
