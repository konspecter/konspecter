import { DEFAULT_IGNORE, ignoreRules } from "../../domain/note/ignore";
import {
  FolderError,
  type FileEntry,
  type FolderBridge,
  type FolderChange,
} from "../desktop/desktop";

/**
 * Test double for the native folder (src-tauri/src/folder.rs): the same
 * create/rename/write/trash rules over an in-memory map, with file names
 * that ignore case. Used only by tests.
 */
export class FakeFolder implements FolderBridge {
  readonly files = new Map<string, { text: string; modifiedMs: number }>();
  readonly trashed: string[] = [];
  readonly opened: string[] = [];
  readonly revealed: string[] = [];
  /** Folders removed because they were left empty. Folders are only implied by paths here. */
  readonly removedFolders: string[] = [];
  /** The `.konspecterignore` file's text, or null when there is none. */
  ignoreFile: string | null = null;

  #ignores(path: string): boolean {
    return ignoreRules(this.ignoreFile ?? DEFAULT_IGNORE).ignores(path);
  }

  readIgnore() {
    return Promise.resolve(this.ignoreFile ?? DEFAULT_IGNORE);
  }

  writeIgnore(text: string) {
    this.ignoreFile = text;
    return Promise.resolve();
  }

  openExternally(path: string) {
    this.opened.push(path);
    return Promise.resolve();
  }

  reveal(path: string) {
    this.revealed.push(path);
    return Promise.resolve();
  }
  #watchers = new Set<(change: FolderChange) => void>();

  watch(onChange: (change: FolderChange) => void) {
    this.#watchers.add(onChange);
    return Promise.resolve(() => {
      this.#watchers.delete(onChange);
    });
  }

  /** What the native watcher would report. */
  notify(change: FolderChange): void {
    for (const watcher of this.#watchers) watcher(change);
  }

  /** A rename by another program. */
  move(from: string, to: string): void {
    const file = this.files.get(from);
    if (!file) throw new Error(`${from} does not exist`);
    this.files.delete(from);
    this.files.set(to, { ...file, modifiedMs: (this.#clock += 1000) });
  }
  #clock = Date.parse("2026-01-01T00:00:00Z");

  /** A change made by another program. */
  edit(path: string, text: string): void {
    this.files.set(path, { text, modifiedMs: (this.#clock += 1000) });
  }

  #entry(path: string): FileEntry {
    const file = this.files.get(path);
    if (!file) throw new FolderError("not_found", `${path} does not exist`);
    return { path, modifiedMs: file.modifiedMs, size: file.text.length };
  }

  list(): Promise<FileEntry[]> {
    return Promise.resolve(
      [...this.files.keys()]
        .filter((path) => !this.#ignores(path))
        .sort()
        .map((path) => this.#entry(path)),
    );
  }

  read(path: string) {
    const file = this.files.get(path);
    if (!file) return Promise.reject(new FolderError("not_found", `${path} does not exist`));
    return Promise.resolve({ entry: this.#entry(path), text: file.text });
  }

  write(path: string, contents: string) {
    this.edit(path, contents);
    return Promise.resolve(this.#entry(path));
  }

  /** Whether a file has this name, ignoring case (as macOS and Windows do). */
  #taken(path: string): string | undefined {
    return [...this.files.keys()].find((name) => name.toLowerCase() === path.toLowerCase());
  }

  createAt(path: string, contents: string) {
    if (this.#ignores(path)) {
      return Promise.reject(new FolderError("invalid_path", `${path} is ignored`));
    }
    if (this.#taken(path) !== undefined) {
      return Promise.reject(new FolderError("exists", `${path} already exists`));
    }
    this.edit(path, contents);
    return Promise.resolve(this.#entry(path));
  }

  rename(from: string, to: string) {
    const file = this.files.get(from);
    if (!file) return Promise.reject(new FolderError("not_found", `${from} does not exist`));
    if (this.#ignores(to)) {
      return Promise.reject(new FolderError("invalid_path", `${to} is ignored`));
    }
    const taken = this.#taken(to);
    if (taken !== undefined && taken !== from) {
      return Promise.reject(new FolderError("exists", `${to} already exists`));
    }
    this.files.delete(from);
    this.files.set(to, file);
    return Promise.resolve(this.#entry(to));
  }

  removeEmptyFolder(path: string) {
    const inside = `${path.toLowerCase()}/`;
    if (![...this.files.keys()].some((name) => name.toLowerCase().startsWith(inside))) {
      this.removedFolders.push(path);
    }
    return Promise.resolve();
  }

  trash(path: string) {
    if (!this.files.delete(path)) {
      return Promise.reject(new FolderError("not_found", `${path} does not exist`));
    }
    this.trashed.push(path);
    return Promise.resolve();
  }
}
