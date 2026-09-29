# Settings

Local, per-device preferences (`domain/settings/settings.ts`, page at `/settings`). Changes
apply and are saved immediately.

| Setting          | Values                                              | Default |
| ---------------- | --------------------------------------------------- | ------- |
| Theme            | System, Light, Dark                                 | System  |
| Default editor   | Text, Markdown                                      | Text    |
| Text size        | Small (0.9×), Default, Large (1.15×), Larger (1.3×) | Default |
| Reading position | restore, ask, off (see [reading](reading.md))       | restore |

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
- **Default editor:** the mode notes open in. The Text/Markdown toggle in the top bar changes
  the same setting, so the last choice is remembered. A note the text editor cannot represent
  is shown rendered in Text mode and edited in Markdown mode.
- **Reading position:** passed to the note page.

If saving fails, the change still applies for the session and the page says so.
