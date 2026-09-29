# Reading position and where the app was

The app remembers how far you read each note, and where the caret was, and brings you back
there (`domain/reading/reading.ts`, `presentation/hooks/use-reading-position.ts`). It also
opens on the page it was on when it was last used.

## State

Stored per note in the IndexedDB `reading` store, **never in the Markdown**:

```ts
type ReadingState = {
  noteId: string;
  position: number; // 0–1
  selection?: { editor: "text" | "markdown"; anchor: number; head: number; focused: boolean };
  updatedAt: string;
};
```

- The position is the scroll offset as a fraction of the scrollable height, so it survives
  different window sizes and font scales approximately.
- The caret is in the editor's own positions (ProseMirror positions in the text editor,
  characters in Markdown), with whether the editor had the focus. Scroll position and caret
  are saved separately; each keeps the other.
- It is validated when read. A corrupted value is ignored and the note opens at the top (an
  invalid caret alone is dropped). Losing it is harmless.
- It is deleted together with the note, in the same transaction.
- It is user state, not derived data, so rebuilding indexes does not touch it.

## Behaviour

| Mode      | Opening a note                                     | Saving |
| --------- | -------------------------------------------------- | ------ |
| `restore` | scrolls to the saved position (default)            | yes    |
| `ask`     | offers "Continue reading" with the percentage read | yes    |
| `off`     | opens at the top                                   | no     |

- **Saving:** 400 ms after scrolling (or the caret) stops, and immediately when leaving the
  note, hiding the page or closing it (`visibilitychange`, `pagehide`). A page that does not
  scroll saves no position. Closing the desktop window waits for these writes and the
  note's autosave (`app/closing.ts`); a browser tab closed within a moment of the last
  keystroke may lose that moment.
- **Restoring** waits until the note's editor (or, for a note shown rendered, the lazily
  loaded Markdown body) has laid out the text, so the scroll height is known. A new note
  has no position until it is saved.
- **The caret** comes back in `restore` mode, in the editor it was saved in (Text or Markdown),
  clamped to the text, and with the focus if the editor had it: editing goes on where it
  stopped. It is placed before the scroll position is restored, so the scroll wins. A window
  that loses the focus (another app, closing) keeps it in the editor.
- The mode comes from the app settings (see [settings](settings.md)).

## Where the app was

`presentation/app/last-location.ts` keeps the last page (path and query: a note, the list
with a search, settings) per device in `localStorage`. On start, before the router reads the
address, an app opened on its start page (`/`, as the desktop app, the installed PWA and the
mobile app always are) goes back there, if that note still exists. An address that names
another page (a link, a reload) wins, and a new, still empty note is not remembered. With the
reading position and caret, the app opens as it was left.
