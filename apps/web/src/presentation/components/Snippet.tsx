import type { SnippetPart } from "../../domain/search/snippet";

export function Snippet({ parts }: { parts: readonly SnippetPart[] }) {
  return (
    <p className="search-snippet">
      {parts.map((part, index) =>
        part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </p>
  );
}
