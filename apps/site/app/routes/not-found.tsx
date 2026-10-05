import { data } from "react-router";

/** Any unknown address: the root error boundary renders the "Page not found" page. */
export function loader() {
  throw data("Not found", { status: 404 });
}

export default function NotFound() {
  return null;
}
