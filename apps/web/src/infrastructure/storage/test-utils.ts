import type { Note } from "../../domain/note/note";

/** Test helper: the stored note, or a failure if it is missing. */
export async function mustGet(
  store: { get(id: string): Promise<Note | undefined> },
  id: string,
): Promise<Note> {
  const note = await store.get(id);
  if (!note) throw new Error(`Expected note ${id} to be stored`);
  return note;
}
