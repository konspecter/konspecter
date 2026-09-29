/**
 * English, the default language and the source of the message keys. Other
 * languages must translate every key (`Dictionary` in i18n.ts).
 * `{name}` is a placeholder; objects are plural forms.
 */
export const en = {
  "app.title": "{title} · Konspecter",
  "app.storageFailed": "Konspecter could not open its local storage",
  "app.skipToContent": "Skip to content",
  "app.updateAvailable": "A new version of Konspecter is available.",
  "app.reload": "Reload",
  "app.later": "Later",
  "app.tryAgain": "Try again",
  "app.close": "Close",
  "app.cancel": "Cancel",

  "sidebar.label": "Sidebar",
  "sidebar.show": "Show sidebar",
  "sidebar.hide": "Hide sidebar",
  "sidebar.settings": "Settings",
  "sidebar.newNote": "New note",
  "sidebar.tags": "Tags",
  "sidebar.tagsHint": "Write {tag} or {nested} in a note.",
  "sidebar.recent": "Recent",
  "sidebar.noNotes": "No notes yet.",
  "tree.expand": "Expand #{tag}",
  "tree.collapse": "Collapse #{tag}",
  "tree.notes": { one: "{count} note", other: "{count} notes" },

  "topbar.search": "Search notes",
  "topbar.searchPlaceholder": "Search",
  "topbar.darkTheme": "Dark theme",
  "topbar.toLight": "Switch to the light theme",
  "topbar.toDark": "Switch to the dark theme",
  "topbar.markdown": "Markdown",
  "topbar.toText": "Switch to the text editor",
  "topbar.toMarkdown": "Switch to the Markdown source",
  "antenna.idle": "Everything is stored on this device",
  "antenna.active": "Saving and syncing",
  "antenna.offline": "No connection: notes are stored on this device and sync later",
  "syncHint.offline": "Offline",
  "syncHint.failed": "Sync failed",
  "syncHint.blocked": { one: "{count} not synced", other: "{count} not synced" },
  "syncHint.label": "Sync: {text}",

  "shortcut.search": "Search",
  "shortcut.newNote": "New note",
  "shortcut.settings": "Settings",
  "shortcut.save": "Save now (notes also save as you type)",
  "shortcut.sidebar": "Show or hide the sidebar",
  "shortcut.editorMode": "Switch between the text editor and Markdown",
  "shortcut.help": "Show these shortcuts",
  "shortcuts.title": "Keyboard shortcuts",

  "note.untitled": "Untitled",
  "note.unreadable": "Unreadable note",
  "note.new": "New note",
  "note.loadFailed": "Could not load the note",
  "note.notFound": "Note not found",
  "note.notFoundText": "This note does not exist or has been removed.",
  "note.backToNotes": "Back to notes",
  "note.pageNotFound": "Page not found",
  "note.conflictCopy":
    "This is a conflict copy: it holds a version that was changed in two places at once. Compare it with {original}, keep what you need, then delete this copy.",
  "note.theOriginal": "the original",
  "note.changedElsewhere":
    "This note was changed elsewhere while you were editing it. Your version is saved as a conflict copy, and the other one stays in this note.",
  "note.resumeAt": "You were {percent}% through this note.",
  "note.continueReading": "Continue reading",
  "note.startFromTop": "Start from the top",
  "note.notSavedInvalid": "Not saved: {reason}. Fix the frontmatter and it saves again.",
  "note.saveFailed":
    "Could not save the note: {error}. Your text is kept; the next change tries again.",

  "details.title": "Details",
  "details.status": "Status",
  "details.notSaved": "Not saved yet",
  "details.created": "Created",
  "details.edited": "Edited",
  "details.length": "Length",
  "details.empty": "Empty",
  "details.words": { one: "{count} word", other: "{count} words" },
  "details.characters": { one: "{count} character", other: "{count} characters" },
  "details.readingTime": "{minutes} min read",
  "details.tags": "Tags",
  "details.cover": "Cover",
  "details.frontmatter": "Frontmatter",
  "details.unreadable": "Not readable",
  "details.file": "File",
  "details.actions": "Note actions",
  "details.titleAndCover": "Title and cover",
  "details.export": "Export…",
  "details.download": "Download .md",
  "details.openExternally": "Open in external editor",
  "details.reveal": "Show in Finder",
  "details.delete": "Delete",
  "details.deleteTitle": "Delete this note?",
  "details.confirmDelete": "“{title}” will be deleted. This cannot be undone.",
  "details.confirmDeleteFile": "“{title}” will be moved to the system trash.",
  "details.deleteFailed": "Could not delete the note: {error}",

  "list.notes": "Notes",
  "list.searchResults": "Search results",
  "list.loadFailed": "Could not load notes",
  "list.searchFailed": "Search failed",
  "list.noMatches": "No matching notes",
  "list.tagFilters": "Tag filters",
  "list.removeTag": "Remove #{tag} filter",
  "list.unreadable": "Some stored notes could not be read. They are kept safe; see {link}.",
  "list.unreadableLink": "Settings → Backup & recovery",
  "welcome.title": "Welcome to Konspecter",
  "welcome.text":
    "Technical notes as plain Markdown, kept on this device and working offline. Tag them anywhere with {tags}, find them with full-text search, and sync them with a server when you want to.",
  "welcome.create": "Create your first note",
  "welcome.example": "Add an example note",
  "welcome.import":
    "Have notes already? Import {md} files or a folder in {settings}, where you can also connect sync.",
  "welcome.exampleNote": `# Welcome to Konspecter

Every note is a **Markdown** document. This one shows what that gives you.

## Headings and lists

- Plain lists, and numbered ones
- Links: [CommonMark](https://commonmark.org)

## Code

\`\`\`java
Map<String, Integer> counts = new HashMap<>();
\`\`\`

## Tags

Write a tag anywhere, like #konspecter or a nested one: #konspecter#getting-started.
The sidebar lists them, and search understands them: try \`#konspecter\`.

Everything you type is saved as you go. Switch to **Markdown** at the top to see the
source, or delete this note when you are done.
`,

  "editor.loadFailed": "Could not load the editor",
  "editor.readerLoadFailed": "Could not load the note reader",
  "editor.textUnavailable": "Text editing is unavailable: {reason}. Fix it in the Markdown below.",
  "editor.markdownOnly": "{reason}, so it can only be edited in Markdown mode.",
  "editor.uses": "This note uses {features}",
  "editor.wouldChange": "This note uses Markdown the text editor would change",
  "editor.feature.tables": "tables",
  "editor.feature.strikethrough": "strikethrough",
  "editor.feature.html": "HTML",
  "editor.feature.taskLists": "task lists",
  "editor.feature.footnotes": "footnotes",
  "editor.text": "Note text",
  "editor.source": "Markdown",
  "editor.placeholder": "Start writing…",
  "editor.sourcePlaceholder": "# Title",
  "editor.title": "Title",
  "editor.cover": "Cover image",
  "editor.formatting": "Formatting",
  "editor.found": "Title and tags found in the text",
  "editor.found.title": "Title",
  "editor.found.tags": "Tags",
  "editor.allTools": "All formatting tools",
  "editor.showTools": "Show all formatting tools",
  "editor.foldTools": "Fold the toolbar",
  "editor.linkAddress": "Link address",
  "tool.bold": "Bold",
  "tool.italic": "Italic",
  "tool.code": "Inline code",
  "tool.heading": "Heading",
  "tool.subheading": "Subheading",
  "tool.quote": "Quote",
  "tool.bulletList": "Bulleted list",
  "tool.orderedList": "Numbered list",
  "tool.codeBlock": "Code block",
  "tool.link": "Link",

  "settings.title": "Settings",
  "settings.theme": "Theme",
  "settings.theme.system": "System",
  "settings.theme.light": "Light",
  "settings.theme.dark": "Dark",
  "settings.editor": "Default editor",
  "settings.editor.hint": "Notes the text editor cannot represent always open in Markdown.",
  "settings.editor.text": "Text",
  "settings.editor.markdown": "Markdown",
  "settings.editingArea": "Editing area",
  "settings.editingArea.hint":
    "A slightly darker panel with room at the sides shows where the note can be edited.",
  "settings.editingArea.highlighted": "Highlighted",
  "settings.editingArea.plain": "Plain",
  "settings.textSize": "Text size",
  "settings.textSize.small": "Small",
  "settings.textSize.default": "Default",
  "settings.textSize.large": "Large",
  "settings.textSize.larger": "Larger",
  "settings.tagNames": "Tag names",
  "settings.tagNames.hint": "How tags are named in the sidebar.",
  "settings.tagNames.capitalized": "Capital first letter",
  "settings.tagNames.asWritten": "As written in notes",
  "settings.reading": "Reading position",
  "settings.reading.restore": "Continue where I left off",
  "settings.reading.ask": "Ask before jumping",
  "settings.reading.off": "Always start at the top",
  "settings.saveFailed": "Could not save settings: {error}. They apply until you reload.",
  "settings.shortcuts": "Keyboard shortcuts",
  "settings.storage": "Offline storage",
  "settings.storage.persistent":
    "Your notes are stored persistently on this device and work offline.",
  "settings.storage.bestEffort":
    "Your notes work offline, but the browser may clear them if the device runs low on space.",
  "settings.storage.unsupported": "This browser does not report whether it may clear stored notes.",
  "settings.storage.keep": "Keep my notes on this device",
  "settings.about": "About",
  "settings.about.text": "{name} {version} for {os}. Notes are stored in the app's local database.",
  "settings.about.unavailable": "Desktop details are unavailable.",
  "settings.library": "Library",
  "settings.library.app":
    "Notes are kept in the app's own library, which can sync with a server. You can instead work directly on a folder of {md} files.",
  "settings.library.open": "Open a Markdown folder…",
  "settings.library.folder":
    "Working on the Markdown files in {folder}. Changes are saved to the files; deleted notes go to the system trash.",
  "settings.library.folderSync":
    "Sync applies to the app library, which keeps syncing in the background. To have this folder on other devices, sync it with Git, iCloud Drive, Dropbox or Syncthing: Konspecter follows their changes, and edits made in two places at once are kept as conflict copies.",
  "settings.library.nothingToImport": "Nothing to import: the library already has these notes.",
  "settings.library.imported": {
    one: "Imported {count} note into the app library.",
    other: "Imported {count} notes into the app library.",
  },
  "settings.library.import": "Import into the app library",
  "settings.library.useApp": "Use the app library",

  "backup.title": "Backup & recovery",
  "backup.hint":
    "To back up, export all notes: the files are plain Markdown and need nothing else to be read. Tag and search indexes are built from the notes and can always be rebuilt.",
  "backup.rebuild": "Rebuild indexes",
  "backup.rebuilt": {
    one: "Indexes rebuilt from {count} note.",
    other: "Indexes rebuilt from {count} notes.",
  },
  "backup.unreadable": {
    one: "{count} stored record could not be read as a note. It is kept as it is. Download it to inspect or restore by hand, then remove it.",
    other:
      "{count} stored records could not be read as notes. They are kept as they are. Download them to inspect or restore by hand, then remove them.",
  },
  "backup.download": "Download them (.json)",
  "backup.remove": "Remove them",
  "backup.downloadFirst": "Download them first",
  "backup.removed": "Unreadable records removed.",

  "transfer.title": "Import & export",
  "transfer.hint":
    "Notes are plain Markdown: imports keep files as written, and exports are the same {md} files, readable without Konspecter.",
  "transfer.importFiles": "Import .md files…",
  "transfer.importFolder": "Import a folder…",
  "transfer.exportFolder": "Export all to a folder…",
  "transfer.exportZip": "Export all (.zip)",
  "transfer.imported": { one: "Imported {count} note", other: "Imported {count} notes" },
  "transfer.duplicates": {
    one: "{count} already in the library",
    other: "{count} already in the library",
  },
  "transfer.rejected": { one: "{count} not imported", other: "{count} not imported" },
  "transfer.nothing": "There are no notes to export.",
  "transfer.exportedTo": {
    one: "Exported {count} note to {folder}.",
    other: "Exported {count} notes to {folder}.",
  },
  "transfer.exportedZip": {
    one: "Exported {count} note as {file}.",
    other: "Exported {count} notes as {file}.",
  },

  "sync.title": "Sync",
  "sync.state.disabled": "Not connected",
  "sync.state.idle": "Up to date",
  "sync.state.syncing": "Syncing…",
  "sync.state.offline": "Offline — changes are kept and sent when you are back online",
  "sync.state.error": "Sync failed; retrying",
  "sync.pending": { one: "{count} waiting to upload", other: "{count} waiting to upload" },
  "sync.blocked": { one: "{count} held back", other: "{count} held back" },
  "sync.connectedTo": "Connected to {server} as {account}.",
  "sync.lastSynced": "last synced {date}",
  "sync.heldBack": "Notes changed on two devices at once are held back with both versions kept.",
  "sync.now": "Sync now",
  "sync.disconnect": "Disconnect",
  "sync.intro":
    "Notes stay on this device either way. Connecting keeps them in step with a Konspecter server.",
  "sync.serverUrl": "Server URL",
  "sync.token": "Access token",
  "sync.connectFailed": "Could not connect: {error}",
  "sync.connect": "Connect",
};
