/**
 * The boundary between the shared web app and the desktop shell (Tauri).
 * Everything native goes through here, so the rest of the app never imports
 * Tauri and keeps working in a plain browser. The Tauri API is loaded only
 * when running on the desktop.
 */

export type AppInfo = { readonly name: string; readonly version: string; readonly os: string };

/** True inside the desktop app. */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

let invokeOverride: Invoke | null = null;

/** Tests replace the native side with a fake. */
export function setInvokeForTests(invoke: Invoke | null): void {
  invokeOverride = invoke;
}

async function invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  if (invokeOverride) return invokeOverride(command, args);
  const core = await import("@tauri-apps/api/core");
  return core.invoke(command, args);
}

/**
 * Lets `beforeClose` finish before the desktop window closes (the window
 * closes once it resolves).
 */
export async function onWindowClose(beforeClose: () => Promise<void>): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().onCloseRequested(async () => {
    await beforeClose();
  });
}

/**
 * Opens a web page in the system browser (signing in to sync). The desktop
 * app asks the shell (native command `open_url`); in a browser it is a new
 * tab, and in the mobile app's web view Capacitor hands the address to the
 * system browser.
 */
export async function openInBrowser(url: string): Promise<void> {
  if (isDesktop()) {
    await invoke("open_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener");
}

/** Details of the running desktop app (native command `app_info`). */
export async function appInfo(): Promise<AppInfo> {
  const value = await invoke("app_info");
  const { name, version, os } = (
    typeof value === "object" && value !== null ? value : {}
  ) as Record<string, unknown>;
  if (typeof name !== "string" || typeof version !== "string" || typeof os !== "string") {
    throw new Error("The desktop app returned invalid app info");
  }
  return { name, version, os };
}

// --- File Mode: a folder of Markdown files (native side: src-tauri/src/folder.rs) ---

export type FileEntry = {
  readonly path: string;
  readonly modifiedMs: number;
  readonly size: number;
};
export type FileContents = { readonly entry: FileEntry; readonly text: string };

/** A native folder operation failed; `code` is e.g. "not_found", "exists", "too_large". */
export class FolderError extends Error {
  override readonly name = "FolderError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The file operations FolderStore needs; tests supply an in-memory one. */
export type FolderBridge = {
  /** The Markdown files, without what the folder's ignore rules skip. */
  list(): Promise<FileEntry[]>;
  /** The folder's ignore rules: its `.konspecterignore`, or the default without one. */
  readIgnore(): Promise<string>;
  /** Writes the folder's `.konspecterignore`; listing and watching follow it at once. */
  writeIgnore(text: string): Promise<void>;
  read(path: string): Promise<FileContents>;
  /** Writes the file atomically, over whatever is there (the last write wins). */
  write(path: string, contents: string): Promise<FileEntry>;
  /** Creates a file at exactly this path, and the folders it needs; fails with "exists" if it is taken. */
  createAt(path: string, contents: string): Promise<FileEntry>;
  /**
   * Renames a file, never over another one (fails with "exists"). Like
   * `createAt`, it makes the folders the new path needs.
   */
  rename(from: string, to: string): Promise<FileEntry>;
  /** Removes a folder (a path without a trailing "/") if it is empty, and its parents that are left empty. */
  removeEmptyFolder(path: string): Promise<void>;
  trash(path: string): Promise<void>;
  /** Deletes the file for good, not to the trash (a device wiped from the site). */
  erase(path: string): Promise<void>;
  openExternally(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
  /** Reports changes made by other programs. Returns a function that stops watching. */
  watch(onChange: (change: FolderChange) => void): Promise<() => void>;
};

/** Files changed outside the app (native event `folder-changed`). */
export type FolderChange = { readonly paths: readonly string[]; readonly rescan: boolean };

/** The change if it concerns this folder; null for another folder's. */
export function parseFolderChange(value: unknown, folder: string): FolderChange | null {
  const {
    folder: changed,
    paths,
    rescan,
  } = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (typeof changed === "string" && changed !== folder) return null;
  const valid = Array.isArray(paths) && paths.every((path) => typeof path === "string");
  // Anything unexpected is treated as "read everything again".
  return valid && typeof rescan === "boolean" && typeof changed === "string"
    ? { paths: paths, rescan }
    : { paths: [], rescan: true };
}

async function folderCommand(command: string, args?: Record<string, unknown>): Promise<unknown> {
  try {
    return await invoke(command, args);
  } catch (error) {
    const { code, message } = (typeof error === "object" && error !== null ? error : {}) as Record<
      string,
      unknown
    >;
    throw new FolderError(
      typeof code === "string" ? code : "io",
      typeof message === "string" ? message : String(error),
    );
  }
}

function parseEntry(value: unknown): FileEntry {
  const { path, modifiedMs, size } = (
    typeof value === "object" && value !== null ? value : {}
  ) as Record<string, unknown>;
  if (typeof path !== "string" || typeof modifiedMs !== "number" || typeof size !== "number") {
    throw new FolderError("invalid_response", "The desktop app returned an invalid file entry");
  }
  return { path, modifiedMs, size };
}

/** The file operations of one connected folder, named by its id. */
export function folderBridge(folder: string): FolderBridge {
  const command = (name: string, args?: Record<string, unknown>) =>
    folderCommand(name, { folder, ...args });
  return {
    async list() {
      const value = await command("folder_list");
      if (!Array.isArray(value)) throw new FolderError("invalid_response", "Invalid file list");
      return value.map(parseEntry);
    },
    async readIgnore() {
      const value = await command("folder_ignore_read");
      if (typeof value !== "string") throw new FolderError("invalid_response", "Invalid rules");
      return value;
    },
    async writeIgnore(text) {
      await command("folder_ignore_write", { text });
    },
    async read(path) {
      const value = (await command("folder_read", { path })) as Record<string, unknown> | null;
      if (typeof value?.text !== "string")
        throw new FolderError("invalid_response", "Invalid file");
      return { entry: parseEntry(value.entry), text: value.text };
    },
    async write(path, contents) {
      return parseEntry(await command("folder_write", { path, contents }));
    },
    async createAt(path, contents) {
      return parseEntry(await command("folder_create_at", { path, contents }));
    },
    async rename(from, to) {
      return parseEntry(await command("folder_rename", { from, to }));
    },
    async removeEmptyFolder(path) {
      await command("folder_remove_empty_dir", { path });
    },
    async trash(path) {
      await command("folder_trash", { path });
    },
    async erase(path) {
      await command("folder_delete", { path });
    },
    async openExternally(path) {
      await command("folder_open_external", { path });
    },
    async reveal(path) {
      await command("folder_reveal", { path });
    },
    async watch(onChange) {
      const events = await import("@tauri-apps/api/event");
      return events.listen("folder-changed", (event) => {
        const change = parseFolderChange(event.payload, folder);
        if (change) onChange(change);
      });
    },
  };
}

// --- The connected folders (native side: src-tauri/src/library.rs) ---

/** A folder of the desktop library. */
export type LibraryFolder = {
  /** Stable for the folder's path; note ids start with it. */
  readonly id: string;
  /** The absolute path. */
  readonly path: string;
  /** The name the user gave it, shown instead of the folder's own. */
  readonly alias: string | null;
  /** When it was added, in milliseconds since the Unix epoch. */
  readonly addedMs: number;
  /** False while the folder cannot be opened (a disk not mounted, a folder moved away). */
  readonly available: boolean;
};

/** How a folder is named in the app: its alias, else its own name. */
export function folderLabel(folder: Pick<LibraryFolder, "alias" | "path">): string {
  if (folder.alias) return folder.alias;
  const parts = folder.path.split(/[\\/]/).filter((part) => part !== "");
  return parts.at(-1) ?? folder.path;
}

function parseLibraryFolder(value: unknown): LibraryFolder {
  const { id, path, alias, addedMs, available } = (
    typeof value === "object" && value !== null ? value : {}
  ) as Record<string, unknown>;
  if (
    typeof id !== "string" ||
    typeof path !== "string" ||
    (alias !== null && alias !== undefined && typeof alias !== "string") ||
    typeof addedMs !== "number" ||
    typeof available !== "boolean"
  ) {
    throw new FolderError("invalid_response", "The desktop app returned an invalid folder");
  }
  return { id, path, alias: alias ?? null, addedMs, available };
}

/** The connected folders, in order. */
export async function libraryFolders(): Promise<LibraryFolder[]> {
  const value = await folderCommand("folders_list");
  if (!Array.isArray(value)) throw new FolderError("invalid_response", "Invalid folder list");
  return value.map(parseLibraryFolder);
}

/**
 * Shows the system folder picker and connects the chosen folder. Null if
 * cancelled; fails with "folder_connected" or "folder_overlaps" for a folder
 * connected already, or inside or around a connected one.
 */
export async function addFolder(): Promise<LibraryFolder | null> {
  const value = await folderCommand("folder_add");
  return value === null || value === undefined ? null : parseLibraryFolder(value);
}

/** Disconnects a folder; its files stay where they are. */
export async function removeFolder(folder: string): Promise<void> {
  await folderCommand("folder_remove", { folder });
}

/** Names a folder for the app; null goes back to its own name. */
export async function setFolderAlias(folder: string, alias: string | null): Promise<void> {
  await folderCommand("folder_set_alias", { folder, alias });
}

/** Opens the folder itself in the system file manager. */
export async function revealFolder(folder: string): Promise<void> {
  await folderCommand("folder_reveal_root", { folder });
}

/** Forgets every folder (factory reset, a wipe): the next start is a first start. */
export async function resetFolders(): Promise<void> {
  await folderCommand("folders_reset");
}

/**
 * Asks for a folder and writes the files into it, named after their titles
 * (never overwriting). Returns null if the user cancelled.
 */
export async function exportToFolder(
  files: readonly { title: string; contents: string }[],
): Promise<{ folder: string; written: number } | null> {
  const value = await folderCommand("export_to_folder", {
    files: files.map(({ title, contents }) => ({ title, contents })),
  });
  if (value === null) return null;
  const { folder, written } = (typeof value === "object" ? value : {}) as Record<string, unknown>;
  if (typeof folder !== "string" || typeof written !== "number") {
    throw new FolderError("invalid_response", "The desktop app returned an invalid export result");
  }
  return { folder, written };
}

/** Appends an entry to the desktop app's log file (native command `log_error`). */
export async function writeLog(entry: string): Promise<void> {
  await invoke("log_error", { entry });
}

/** The sync token in the operating system's keychain (native commands credential_*). */
export const keychainCredentials = {
  async load(): Promise<string | null> {
    const value = await folderCommand("credential_get");
    return typeof value === "string" ? value : null;
  },
  async save(token: string): Promise<void> {
    await folderCommand("credential_set", { secret: token });
  },
  async clear(): Promise<void> {
    await folderCommand("credential_delete");
  },
};
