import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState";

export function NotFoundPage() {
  return (
    <>
      <title>Page not found · Konspecter</title>
      <EmptyState title="Page not found">
        <p>
          <Link to="/">Back to notes</Link>
        </p>
      </EmptyState>
    </>
  );
}
