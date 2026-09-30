import { useEffect } from "react";
import { errorMessage, reportError } from "../app/errors";

/** The text to show for `error` (null for none); a hidden error is logged. */
export function useErrorMessage(error: unknown): string | null {
  useEffect(() => {
    if (error !== null) reportError(error);
  }, [error]);
  return error === null ? null : errorMessage(error);
}
