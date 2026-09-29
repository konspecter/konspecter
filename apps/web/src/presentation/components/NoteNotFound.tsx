import { Link } from "react-router";
import { EmptyState } from "./EmptyState";

export function NoteNotFound() {
  return (
    <>
      <title>Note not found · Konspecter</title>
      <EmptyState title="Note not found">
        <p>This note does not exist or has been removed.</p>
        <p>
          <Link to="/">Back to notes</Link>
        </p>
      </EmptyState>
    </>
  );
}
