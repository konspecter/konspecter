import { useEffect } from "react";
import Markdown, { type Components, type Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { omitLeadingTitle } from "./omit-leading-title";
import { rehypeTags } from "./rehype-tags";
import "./markdown.css";

type MarkdownViewProps = {
  /** The document body (without frontmatter). */
  markdown: string;
  /** The title the page already shows; a matching leading `# heading` is not repeated. */
  title: string;
  titleDerived: boolean;
  /** Called after the body has been rendered into the page. */
  onRendered?: () => void;
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

/**
 * Renders CommonMark + GFM as React elements (never via innerHTML). Raw HTML
 * in the Markdown is parsed and then sanitized with GitHub's allowlist, and
 * fenced code blocks with a language are syntax-highlighted.
 */
export function MarkdownView({ markdown, title, titleDerived, onRendered }: MarkdownViewProps) {
  useEffect(() => {
    onRendered?.();
  }, [onRendered, markdown]);

  const rehypePlugins: Options["rehypePlugins"] = [
    rehypeRaw,
    // Sanitizing must come after raw HTML is parsed and before anything adds
    // markup of its own (highlighting spans).
    rehypeSanitize,
    [rehypeHighlight, { detect: false }],
    rehypeTags,
    [omitLeadingTitle, { title, derived: titleDerived }],
  ];

  return (
    <div className="markdown">
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {markdown}
      </Markdown>
    </div>
  );
}
