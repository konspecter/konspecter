# ADR-027: A pin is the note's frontmatter

Status: accepted (2026-10-19).

## Context

Recent lists pinned notes first: `Mod+Alt+1…0` pins the open note to a key and `Mod+1…0`
opens it. The pins were kept per device, in localStorage, so a note pinned on the laptop was
not pinned on the phone, nor in another program reading the files. Owners expected their pins
to follow them like their notes. Konspecter's rule is that the Markdown document is the single
source of truth and everything else is an index.

## Decision

1. **A pin is a frontmatter key:** `pin: 3`, a digit 0–9, written as a number. Anything else
   (`pin: 12`, `pin: yes`) is no pin, not an invalid document: a pin is a convenience, not
   content. It travels with the note: through sync, in File Mode's files, to other editors.
2. **Pinning is an edit.** It goes through the same save as typing, so `updated` moves on and
   the last write wins ([ADR-011](ADR-011-last-write-wins.md)) when two devices disagree. The
   open note is changed in its editor (`DocumentEdit`), so unsaved typing is kept; a note that
   loses its key to another is changed in the store.
3. **A key holds one note.** Pinning takes the key from every other note that claims it. Two
   notes can still claim a key, pinned on two devices before they synced: the one edited last
   holds it, and the other shows unpinned until it is pinned again (`pinsOf`).
4. **Old pins move once.** On start, pins left in a device's localStorage are written into
   their notes and the device forgets them.

The rules are in `domain/document/document.ts` (the key) and
`application/notes/note-pins.ts` (which note holds a key, what pinning changes).

## Consequences

- Pins are the same on every device and in every program, and a renamed file keeps its pin.
- Pinning a note, and unpinning the note that gave up its key, moves its `updated` date: it
  rises to the top of the list and into the week's Recent, and it is uploaded.
- The key is in the file for anyone who opens it.

## Alternatives considered

- **Pins as an account setting on the server** (encrypted, last write wins on the whole set):
  keeps the notes untouched, but needs a new API, storage and sync path, and pins would sync
  only while connected; File Mode's files would not carry them.
- **Keep them per device:** a key as a keyboard habit of each device. Simple, but not what
  owners expect of something they set on purpose.
