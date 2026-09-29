import type { NoteSummary } from "../../application/notes/note-catalog";
import { noteTitle, type ReadNote } from "../../domain/note/note";
import { t } from "../i18n/i18n";

export function displayTitle(read: ReadNote): string {
  if (!read.valid) {
    return t("note.unreadable");
  }
  return noteTitle(read) || t("note.untitled");
}

export function summaryTitle(summary: NoteSummary): string {
  if (!summary.valid) {
    return t("note.unreadable");
  }
  return summary.title || t("note.untitled");
}
