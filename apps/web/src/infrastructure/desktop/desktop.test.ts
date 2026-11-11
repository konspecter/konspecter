import {
  addFolder,
  appInfo,
  folderBridge,
  folderLabel,
  isDesktop,
  libraryFolders,
  parseFolderChange,
  setFolderAlias,
  setInvokeForTests,
} from "./desktop";

afterEach(() => {
  setInvokeForTests(null);
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("desktop bridge", () => {
  it("detects the desktop shell", () => {
    expect(isDesktop()).toBe(false);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(isDesktop()).toBe(true);
  });

  it("calls native commands and validates their answers", async () => {
    const calls: string[] = [];
    setInvokeForTests((command) => {
      calls.push(command);
      return Promise.resolve({ name: "Konspecter", version: "0.1.0", os: "macos" });
    });

    expect(await appInfo()).toEqual({ name: "Konspecter", version: "0.1.0", os: "macos" });
    expect(calls).toEqual(["app_info"]);

    setInvokeForTests(() => Promise.resolve({ name: 1 }));
    await expect(appInfo()).rejects.toThrow("invalid app info");
  });
});

describe("the folders", () => {
  it("names the folder in every file command", async () => {
    const calls: [string, unknown][] = [];
    setInvokeForTests((command, args) => {
      calls.push([command, args]);
      return Promise.resolve({ path: "a.md", modifiedMs: 1, size: 2 });
    });

    await folderBridge("f1").write("a.md", "# A");
    await setFolderAlias("f1", "Work");

    expect(calls).toEqual([
      ["folder_write", { folder: "f1", path: "a.md", contents: "# A" }],
      ["folder_set_alias", { folder: "f1", alias: "Work" }],
    ]);
  });

  it("hears only its own folder's changes", () => {
    expect(parseFolderChange({ folder: "f1", paths: ["a.md"], rescan: false }, "f1")).toEqual({
      paths: ["a.md"],
      rescan: false,
    });
    expect(parseFolderChange({ folder: "f2", paths: ["a.md"], rescan: false }, "f1")).toBeNull();
    expect(parseFolderChange({ nonsense: true }, "f1")).toEqual({ paths: [], rescan: true });
  });

  it("reads the connected folders and refuses anything else", async () => {
    const folder = {
      id: "f1",
      path: "/Users/ada/Konspecter",
      alias: null,
      addedMs: 5,
      available: true,
    };
    setInvokeForTests(() => Promise.resolve([folder]));
    expect(await libraryFolders()).toEqual([folder]);

    setInvokeForTests(() => Promise.resolve(null));
    expect(await addFolder()).toBeNull();

    setInvokeForTests(() => Promise.resolve([{ id: 1 }]));
    await expect(libraryFolders()).rejects.toMatchObject({ code: "invalid_response" });

    // Tauri rejects with the command's error object: `{ code, message }`.
    const refused = Object.assign(new Error("overlaps"), { code: "folder_overlaps" });
    setInvokeForTests(() => Promise.reject(refused));
    await expect(addFolder()).rejects.toMatchObject({ code: "folder_overlaps" });
  });

  it("names a folder by its alias, else by its own name", () => {
    expect(folderLabel({ alias: "Work", path: "/Users/ada/Projects" })).toBe("Work");
    expect(folderLabel({ alias: null, path: "/Users/ada/Projects/" })).toBe("Projects");
    expect(folderLabel({ alias: null, path: "C:\\Users\\ada\\Notes" })).toBe("Notes");
  });
});
