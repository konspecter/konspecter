# Reading position

The app remembers how far you read each note and brings you back there
(`domain/reading/reading.ts`, `presentation/hooks/use-reading-position.ts`).

## State

Stored per note in the IndexedDB `reading` store, **never in the Markdown**:

```ts
type ReadingState = { noteId: string; position: number /* 0–1 */; updatedAt: string };
```

- The position is the scroll offset as a fraction of the scrollable height, so it survives
  different window sizes and font scales approximately.
- It is validated when read. A corrupted value is ignored and the note opens at the top.
  Losing it is harmless.
- It is deleted together with the note, in the same transaction.
- It is user state, not derived data, so rebuilding indexes does not touch it.

## Behaviour

| Mode      | Opening a note                                     | Saving |
| --------- | -------------------------------------------------- | ------ |
| `restore` | scrolls to the saved position (default)            | yes    |
| `ask`     | offers "Continue reading" with the percentage read | yes    |
| `off`     | opens at the top                                   | no     |

- **Saving:** 400 ms after scrolling stops, and immediately when leaving the note or the page
  (`pagehide`). A page that does not scroll saves nothing.
- **Restoring** waits until the note's editor (or, for a note shown rendered, the lazily
  loaded Markdown body) has laid out the text, so the scroll height is known. A new note
  has no position until it is saved.
- The mode comes from the app settings (see [settings](settings.md)).
