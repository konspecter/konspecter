import type { NoteSummary } from "../../application/notes/note-catalog";
import { noteTitle, type ReadNote } from "../../domain/note/note";

export function displayTitle(read: ReadNote): string {
  if (!read.valid) {
    return "Unreadable note";
  }
  return noteTitle(read) || "Untitled";
}

export function summaryTitle(summary: NoteSummary): string {
  if (!summary.valid) {
    return "Unreadable note";
  }
  return summary.title || "Untitled";
}
