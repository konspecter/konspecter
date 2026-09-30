# Settings

Local, per-device preferences (`domain/settings/settings.ts`, page at `/settings`). Changes
apply and are saved immediately.

| Setting          | Values                                              | Default              |
| ---------------- | --------------------------------------------------- | -------------------- |
| Theme            | System, Light, Dark                                 | System               |
| Language         | System, English, Русский (see [i18n](i18n.md))      | System               |
| Default editor   | Text, Markdown                                      | Text                 |
| Text size        | Small (0.9×), Default, Large (1.15×), Larger (1.3×) | Default              |
| Reading position | restore, ask, off (see [reading](reading.md))       | restore              |
| Editing area     | Highlighted, Plain (see [editors](editors.md))      | Highlighted          |
| Tag names        | Capital first letter, As written in notes           | Capital first letter |
| File names       | Keep when the title changes, Rename after the title | Keep                 |

## Storage

Settings are stored in IndexedDB (`meta` store, key `settings`) and loaded before the first
render, together with the notes. So the chosen theme applies from the first paint, with no
flash. `parseSettings` validates each field on its own: an unknown or invalid value (for
example after a downgrade) falls back to its default without resetting the others. Settings
are not synced. A separate strategy can be added with sync if needed.

## How they apply

- **Theme:** `App` sets `data-theme` on `<html>`. The top bar's toggle switches between light
  and dark (from "System" it picks the opposite of what is shown) and saves the choice. CSS tokens use the system preference
  unless `data-theme` is `light` or `dark` (`app.css`, `markdown.css`), and `color-scheme`
  follows, so native controls match.
- **Text size:** `--font-scale` on `<html>` scales reading and editing text (body, titles,
  Markdown headings, code, both editors). The UI chrome keeps its size.
- **Default editor:** the mode notes open in. The editor mode button in the top bar changes
  the same setting, so the last choice is remembered. A note the text editor cannot represent
  is shown rendered in Text mode and edited in Markdown mode.
- **Reading position:** passed to the note page.
- **Editing area:** `App` sets `data-editing-area` on `<html>`; the editor's panel styles
  depend on it.
- **Tag names:** the sidebar tree's labels start with a capital letter (`tagLabel(…, true)`),
  or show the tag as written. Links, filters and the index keep the lowercase name.
- **Language:** `applyLanguage` sets the interface language and `<html lang>`: the system's
  for "System", else the chosen one. `main.tsx` applies the saved choice before the first
  render; a change applies at once, without a reload (`App` renders its routes again, keyed
  by the language). Language names are shown in their own language.

- **File names** (shown only while a Markdown folder is open): `main.tsx` passes it to
  `FolderStore.followTitles`, at start and on every change. See
  [File Mode](filesystem-mode.md#file-names).

If saving fails, the change still applies for the session and the page says so.
