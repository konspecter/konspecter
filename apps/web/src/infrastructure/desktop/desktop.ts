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

/** A native folder operation failed; `code` is e.g. "changed_on_disk", "not_found". */
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
  list(): Promise<FileEntry[]>;
  read(path: string): Promise<FileContents>;
  write(path: string, contents: string, expectedModifiedMs: number | null): Promise<FileEntry>;
  create(title: string, contents: string): Promise<FileEntry>;
  trash(path: string): Promise<void>;
  openExternally(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
  /** Reports changes made by other programs. Returns a function that stops watching. */
  watch(onChange: (change: FolderChange) => void): Promise<() => void>;
};

/** Files changed outside the app (native event `folder-changed`). */
export type FolderChange = { readonly paths: readonly string[]; readonly rescan: boolean };

function parseFolderChange(value: unknown): FolderChange {
  const { paths, rescan } = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const valid = Array.isArray(paths) && paths.every((path) => typeof path === "string");
  // Anything unexpected is treated as "read everything again".
  return valid && typeof rescan === "boolean"
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

export const folderBridge: FolderBridge = {
  async list() {
    const value = await folderCommand("folder_list");
    if (!Array.isArray(value)) throw new FolderError("invalid_response", "Invalid file list");
    return value.map(parseEntry);
  },
  async read(path) {
    const value = (await folderCommand("folder_read", { path })) as Record<string, unknown> | null;
    if (typeof value?.text !== "string") throw new FolderError("invalid_response", "Invalid file");
    return { entry: parseEntry(value.entry), text: value.text };
  },
  async write(path, contents, expectedModifiedMs) {
    return parseEntry(await folderCommand("folder_write", { path, contents, expectedModifiedMs }));
  },
  async create(title, contents) {
    return parseEntry(await folderCommand("folder_create", { title, contents }));
  },
  async trash(path) {
    await folderCommand("folder_trash", { path });
  },
  async openExternally(path) {
    await folderCommand("folder_open_external", { path });
  },
  async reveal(path) {
    await folderCommand("folder_reveal", { path });
  },
  async watch(onChange) {
    const events = await import("@tauri-apps/api/event");
    return events.listen("folder-changed", (event) => {
      onChange(parseFolderChange(event.payload));
    });
  },
};

/** The open folder's path, or null (app library). */
export async function currentFolder(): Promise<string | null> {
  const value = await folderCommand("folder_current");
  return typeof value === "string" ? value : null;
}

/** Shows the system folder picker. Returns the chosen path, or null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  const value = await folderCommand("folder_pick");
  return typeof value === "string" ? value : null;
}

export async function closeFolder(): Promise<void> {
  await folderCommand("folder_close");
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
