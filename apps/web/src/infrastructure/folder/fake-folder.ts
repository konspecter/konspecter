import {
  FolderError,
  type FileEntry,
  type FolderBridge,
  type FolderChange,
} from "../desktop/desktop";

/**
 * Test double for the native folder (src-tauri/src/folder.rs): the same
 * create/write/trash rules over an in-memory map. Used only by tests.
 */
export class FakeFolder implements FolderBridge {
  readonly files = new Map<string, { text: string; modifiedMs: number }>();
  readonly trashed: string[] = [];
  readonly opened: string[] = [];
  readonly revealed: string[] = [];

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
    return Promise.resolve([...this.files.keys()].sort().map((path) => this.#entry(path)));
  }

  read(path: string) {
    const file = this.files.get(path);
    if (!file) return Promise.reject(new FolderError("not_found", `${path} does not exist`));
    return Promise.resolve({ entry: this.#entry(path), text: file.text });
  }

  write(path: string, contents: string, expectedModifiedMs: number | null) {
    const current = this.files.get(path);
    if (current && expectedModifiedMs !== null && current.modifiedMs !== expectedModifiedMs) {
      return Promise.reject(
        new FolderError("changed_on_disk", `${path} was changed by another program`),
      );
    }
    this.edit(path, contents);
    return Promise.resolve(this.#entry(path));
  }

  create(title: string, contents: string) {
    const stem =
      title
        .replace(/[^\p{L}\p{N} _-]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim() || "Untitled";
    let name = `${stem}.md`;
    for (let n = 2; this.files.has(name); n += 1) name = `${stem} ${String(n)}.md`;
    this.edit(name, contents);
    return Promise.resolve(this.#entry(name));
  }

  trash(path: string) {
    if (!this.files.delete(path)) {
      return Promise.reject(new FolderError("not_found", `${path} does not exist`));
    }
    this.trashed.push(path);
    return Promise.resolve();
  }
}
