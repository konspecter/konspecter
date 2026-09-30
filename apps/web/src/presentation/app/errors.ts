import { InvalidDocumentError } from "../../domain/document/document";
import { InvalidNoteError } from "../../domain/note/note";
import { InvalidReadingStateError } from "../../domain/reading/reading";
import { InvalidSyncStateError } from "../../domain/sync/sync-state";
import { FolderError, isDesktop, writeLog } from "../../infrastructure/desktop/desktop";
import { CoverImageError } from "../../infrastructure/files/cover-image";
import { ApiError, NetworkError } from "../../infrastructure/http/api-client";
import { t } from "../i18n/i18n";

/** Errors whose messages Konspecter writes itself; anything else is not shown. */
const OWN = [
  InvalidDocumentError,
  InvalidNoteError,
  InvalidReadingStateError,
  InvalidSyncStateError,
  CoverImageError,
  ApiError,
  NetworkError,
];
/** Folder errors whose message comes from the operating system or a library. */
const FOREIGN_FOLDER_CODES = new Set(["io", "credentials"]);

function isOwn(error: unknown): error is Error {
  if (error instanceof FolderError) return !FOREIGN_FOLDER_CODES.has(error.code);
  return OWN.some((kind) => error instanceof kind);
}

/**
 * The sentence the interface shows for an error: the app's own message, or
 * "Oops, something went wrong." for anything from a library, the browser or
 * the operating system (`reportError` logs those).
 */
export function errorMessage(error: unknown): string {
  if (!isOwn(error)) return t("app.somethingWrong");
  const message = error.message.trim();
  return /[.!?…]$/.test(message) ? message : `${message}.`;
}

const reported = new WeakSet<object>();

/**
 * Logs what `errorMessage` hides (once per error): to the console, and on the
 * desktop to its log file.
 */
export function reportError(error: unknown): void {
  const hidden = !isOwn(error) || error.cause !== undefined;
  if (!hidden) return;
  if (typeof error === "object" && error !== null) {
    if (reported.has(error)) return;
    reported.add(error);
  }
  console.error(error);
  if (isDesktop()) {
    writeLog(`${new Date().toISOString()} ${describe(error)}`).catch(() => undefined);
  }
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // Some engines' stacks start with the message, some do not.
  const head = `${error.name}: ${error.message}`;
  const stack = error.stack?.startsWith(head) ? error.stack.slice(head.length) : error.stack;
  const lines = [head, ...(stack ? [stack.replace(/^\n/, "")] : [])];
  if (error.cause !== undefined) lines.push(`Caused by: ${describe(error.cause)}`);
  return lines.join("\n");
}
