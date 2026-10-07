//! File Mode: a folder of Markdown files on disk, used as a note library.
//!
//! The web app never names absolute paths. It works with paths relative to the
//! folder the user picked, and every one is checked here: no `..`, no absolute
//! paths, `.md` only, and no symlink may lead outside the folder. Writes are
//! atomic; deleted files go to the system trash.
//!
//! The folder's `.konspecterignore`, written like `.gitignore`, names what the
//! app skips: the walk does not enter it, the watcher does not report it, and
//! no file is made or moved into it.

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::Serialize;
use std::fmt;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::UNIX_EPOCH;

/// Guards against runaway walks (e.g. a picked home directory).
const MAX_FILES: usize = 20_000;
const MAX_DEPTH: usize = 24;
/// Same limit as the server's.
const MAX_FILE_BYTES: u64 = 5 << 20;

/// The rules' file at the folder's root (the web app's `IGNORE_FILE`).
pub const IGNORE_FILE: &str = ".konspecterignore";
/// What a folder without the file skips: hidden files and folders and the
/// usual build and dependency folders. The same as the web app's
/// `DEFAULT_IGNORE` (src/domain/note/ignore.ts).
pub const DEFAULT_IGNORE: &str = ".*\nnode_modules\nvendors\ndist\nbin\n";
/// The same limit as the web app's settings.
const MAX_IGNORE_BYTES: u64 = 64 << 10;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// Relative to the folder, with `/` separators.
    pub path: String,
    /// Last modification, in milliseconds since the Unix epoch.
    pub modified_ms: u64,
    pub size: u64,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct FileContents {
    pub entry: FileEntry,
    pub text: String,
}

#[derive(Debug, PartialEq)]
pub enum FolderError {
    InvalidPath(String),
    NotFound(String),
    Exists(String),
    TooLarge(String),
    Io(String),
}

impl FolderError {
    pub fn code(&self) -> &'static str {
        match self {
            FolderError::InvalidPath(_) => "invalid_path",
            FolderError::NotFound(_) => "not_found",
            FolderError::Exists(_) => "exists",
            FolderError::TooLarge(_) => "too_large",
            FolderError::Io(_) => "io",
        }
    }
}

impl fmt::Display for FolderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FolderError::InvalidPath(p) => write!(f, "invalid path {p:?}"),
            FolderError::NotFound(p) => write!(f, "{p} does not exist"),
            FolderError::Exists(p) => write!(f, "{p} already exists"),
            FolderError::TooLarge(p) => write!(f, "{p} is larger than 5 MB"),
            FolderError::Io(message) => write!(f, "{message}"),
        }
    }
}

fn io(context: &str, error: std::io::Error) -> FolderError {
    FolderError::Io(format!("{context}: {error}"))
}

/// A picked folder. The root is canonical (symlinks resolved). Clones share
/// the ignore rules, so the watcher follows changes to them.
#[derive(Debug, Clone)]
pub struct Folder {
    root: PathBuf,
    rules: Arc<RwLock<Gitignore>>,
}

/// The folder the desktop app uses when none is chosen, in the home folder.
/// Not hidden, so the files show in Finder and Explorer.
pub const DEFAULT_FOLDER_NAME: &str = "Konspecter";

impl Folder {
    /// Opens `<home>/Konspecter`, making it first if needed.
    pub fn open_default(home: &Path) -> Result<Self, FolderError> {
        let path = home.join(DEFAULT_FOLDER_NAME);
        fs::create_dir_all(&path).map_err(|e| io("create default folder", e))?;
        Folder::open(&path)
    }

    pub fn open(path: &Path) -> Result<Self, FolderError> {
        let root = fs::canonicalize(path).map_err(|e| io("open folder", e))?;
        if !root.is_dir() {
            return Err(FolderError::InvalidPath(path.display().to_string()));
        }
        let rules = Arc::new(RwLock::new(Gitignore::empty()));
        let folder = Folder { root, rules };
        folder.reload_ignore();
        Ok(folder)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The text of the folder's ignore rules: its `.konspecterignore`, or the
    /// default when there is none.
    pub fn ignore_text(&self) -> Result<String, FolderError> {
        let path = self.root.join(IGNORE_FILE);
        match fs::metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(DEFAULT_IGNORE.to_string());
            }
            Err(e) => return Err(io("read ignore rules", e)),
            Ok(meta) if meta.len() > MAX_IGNORE_BYTES => {
                return Err(FolderError::TooLarge(IGNORE_FILE.to_string()));
            }
            Ok(_) => {}
        }
        let bytes = fs::read(&path).map_err(|e| io("read ignore rules", e))?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// Writes the folder's `.konspecterignore` (atomically) and follows it.
    pub fn write_ignore(&self, text: &str) -> Result<(), FolderError> {
        if text.len() as u64 > MAX_IGNORE_BYTES {
            return Err(FolderError::TooLarge(IGNORE_FILE.to_string()));
        }
        write_atomically(&self.root.join(IGNORE_FILE), text)
            .map_err(|e| io("write ignore rules", e))?;
        self.reload_ignore();
        Ok(())
    }

    /// Reads the rules again. Rules that cannot be read skip nothing; a line
    /// that is not a valid pattern is left out.
    pub fn reload_ignore(&self) {
        let text = self.ignore_text().unwrap_or_default();
        let mut builder = GitignoreBuilder::new(&self.root);
        for line in text.lines() {
            let _ = builder.add_line(None, line);
        }
        let rules = builder.build().unwrap_or_else(|_| Gitignore::empty());
        if let Ok(mut current) = self.rules.write() {
            *current = rules;
        }
    }

    /// Whether the rules skip a path relative to the folder: it matches, or a
    /// folder it is in does.
    fn ignores(&self, relative: &Path, is_dir: bool) -> bool {
        if relative.as_os_str().is_empty() {
            return false;
        }
        self.rules.read().is_ok_and(|rules| {
            rules
                .matched_path_or_any_parents(relative, is_dir)
                .is_ignore()
        })
    }

    /// The absolute path for a relative one, if it is a safe Markdown path
    /// inside the folder.
    pub fn resolve(&self, relative: &str) -> Result<PathBuf, FolderError> {
        let invalid = || FolderError::InvalidPath(relative.to_string());
        let joined = self
            .parts(relative)?
            .iter()
            .fold(self.root.clone(), |path, part| path.join(part));
        if !is_markdown(&joined) {
            return Err(invalid());
        }
        // Symlinks must not lead outside the folder: check the real location
        // of the file, or of its parent for a file that does not exist yet.
        let real = if joined.exists() {
            fs::canonicalize(&joined).map_err(|e| io("resolve", e))?
        } else {
            let parent = joined.parent().ok_or_else(invalid)?;
            let real_parent = fs::canonicalize(parent)
                .map_err(|_| FolderError::NotFound(relative.to_string()))?;
            real_parent.join(joined.file_name().ok_or_else(invalid)?)
        };
        if !real.starts_with(&self.root) {
            return Err(invalid());
        }
        Ok(joined)
    }

    /// Every Markdown file in the folder and its subfolders, sorted by path.
    /// What the ignore rules match and symlinks are skipped.
    pub fn list(&self) -> Result<Vec<FileEntry>, FolderError> {
        let mut entries = Vec::new();
        self.walk(&self.root, 0, &mut entries)?;
        entries.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(entries)
    }

    fn walk(&self, dir: &Path, depth: usize, out: &mut Vec<FileEntry>) -> Result<(), FolderError> {
        if depth > MAX_DEPTH {
            return Ok(());
        }
        let read = fs::read_dir(dir).map_err(|e| io("list folder", e))?;
        for item in read {
            let item = item.map_err(|e| io("list folder", e))?;
            let path = item.path();
            let meta = fs::symlink_metadata(&path).map_err(|e| io("list folder", e))?;
            if meta.file_type().is_symlink() {
                continue;
            }
            let relative = path.strip_prefix(&self.root).unwrap_or(&path);
            if self.ignores(relative, meta.is_dir()) {
                continue;
            }
            if meta.is_dir() {
                self.walk(&path, depth + 1, out)?;
            } else if meta.is_file() && is_markdown(&path) {
                if out.len() >= MAX_FILES {
                    return Ok(());
                }
                out.push(self.entry(&path, &meta)?);
            }
        }
        Ok(())
    }

    fn entry(&self, path: &Path, meta: &fs::Metadata) -> Result<FileEntry, FolderError> {
        let relative = path
            .strip_prefix(&self.root)
            .map_err(|_| FolderError::InvalidPath(path.display().to_string()))?;
        let parts: Vec<String> = relative
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        Ok(FileEntry {
            path: parts.join("/"),
            modified_ms: modified_ms(meta),
            size: meta.len(),
        })
    }

    pub fn read(&self, relative: &str) -> Result<FileContents, FolderError> {
        let path = self.resolve(relative)?;
        let meta = fs::metadata(&path).map_err(|_| FolderError::NotFound(relative.to_string()))?;
        if meta.len() > MAX_FILE_BYTES {
            return Err(FolderError::TooLarge(relative.to_string()));
        }
        let bytes = fs::read(&path).map_err(|e| io("read file", e))?;
        // Invalid UTF-8 is replaced rather than refused, so the file can still be read.
        let text = String::from_utf8_lossy(&bytes).into_owned();
        Ok(FileContents {
            entry: self.entry(&path, &meta)?,
            text,
        })
    }

    /// Writes the file atomically (a temporary file renamed over it), over
    /// whatever is there: the last write wins.
    pub fn write(&self, relative: &str, contents: &str) -> Result<FileEntry, FolderError> {
        let path = self.resolve(relative)?;
        if contents.len() as u64 > MAX_FILE_BYTES {
            return Err(FolderError::TooLarge(relative.to_string()));
        }
        write_atomically(&path, contents).map_err(|e| io("write file", e))?;
        let meta = fs::metadata(&path).map_err(|e| io("write file", e))?;
        self.entry(&path, &meta)
    }

    /// Creates a new file in the folder's top level named after `title`,
    /// adding " 2", " 3" … if the name is taken. Never overwrites. Used by
    /// the folder export; File Mode names its files itself (`create_at`).
    pub fn create(&self, title: &str, contents: &str) -> Result<FileEntry, FolderError> {
        let stem = file_stem_for(title);
        for n in 1..10_000 {
            let name = if n == 1 {
                format!("{stem}.md")
            } else {
                format!("{stem} {n}.md")
            };
            match self.create_at(&name, contents) {
                Err(FolderError::Exists(_)) => continue,
                result => return result,
            }
        }
        Err(FolderError::Io("could not find a free file name".into()))
    }

    /// The names a relative path is made of, checked: plain names (no `..`,
    /// no absolute or drive paths, no backslashes).
    fn parts<'a>(&self, relative: &'a str) -> Result<Vec<&'a str>, FolderError> {
        let invalid = || FolderError::InvalidPath(relative.to_string());
        if relative.is_empty() || relative.contains('\\') || relative.contains('\0') {
            return Err(invalid());
        }
        let mut names = Vec::new();
        for component in Path::new(relative).components() {
            match component {
                Component::Normal(part) => {
                    let part = part.to_str().ok_or_else(invalid)?;
                    if part.contains(':') {
                        return Err(invalid());
                    }
                    names.push(part);
                }
                _ => return Err(invalid()),
            }
        }
        Ok(names)
    }

    /// Makes the folders a new file's path needs. Each one that exists must
    /// really be a folder inside this one (no symlink out of it), and none of
    /// it may be skipped by the ignore rules: the file would vanish.
    fn make_folders_for(&self, relative: &str) -> Result<(), FolderError> {
        let names = self.parts(relative)?;
        if self.ignores(Path::new(relative), false) {
            return Err(FolderError::InvalidPath(relative.to_string()));
        }
        let mut dir = self.root.clone();
        for name in names.iter().take(names.len().saturating_sub(1)) {
            dir.push(name);
            if dir.exists() {
                let real = fs::canonicalize(&dir).map_err(|e| io("make folder", e))?;
                if !real.starts_with(&self.root) || !real.is_dir() {
                    return Err(FolderError::InvalidPath(relative.to_string()));
                }
            } else {
                fs::create_dir(&dir).map_err(|e| io("make folder", e))?;
            }
        }
        Ok(())
    }

    /// Removes a folder (a relative path, not a file) if nothing is left in it
    /// but a Finder `.DS_Store`, then each parent left empty the same way, up to
    /// this folder. A folder with anything else in it stays, and one the
    /// ignore rules skip is not the app's to remove.
    pub fn remove_empty_dir(&self, relative: &str) -> Result<(), FolderError> {
        let names = self.parts(relative)?;
        if self.ignores(Path::new(relative), true) {
            return Err(FolderError::InvalidPath(relative.to_string()));
        }
        let mut depth = names.len();
        while depth > 0 {
            let dir = names[..depth]
                .iter()
                .fold(self.root.clone(), |dir, name| dir.join(name));
            let Ok(real) = fs::canonicalize(&dir) else {
                return Ok(());
            };
            if !real.starts_with(&self.root) || real == self.root || !real.is_dir() {
                return Err(FolderError::InvalidPath(relative.to_string()));
            }
            let entries: Vec<_> = fs::read_dir(&real)
                .map_err(|e| io("read folder", e))?
                .filter_map(Result::ok)
                .map(|entry| entry.file_name())
                .collect();
            if entries.iter().any(|name| name != ".DS_Store") {
                return Ok(());
            }
            if !entries.is_empty() {
                fs::remove_file(real.join(".DS_Store")).map_err(|e| io("remove folder", e))?;
            }
            fs::remove_dir(&real).map_err(|e| io("remove folder", e))?;
            depth -= 1;
        }
        Ok(())
    }

    /// Creates a new file at exactly this path, and the folders it needs;
    /// `Exists` if it is taken.
    pub fn create_at(&self, relative: &str, contents: &str) -> Result<FileEntry, FolderError> {
        self.make_folders_for(relative)?;
        let path = self.resolve(relative)?;
        if contents.len() as u64 > MAX_FILE_BYTES {
            return Err(FolderError::TooLarge(relative.to_string()));
        }
        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(FolderError::Exists(relative.to_string()));
            }
            Err(e) => return Err(io("create file", e)),
        };
        file.write_all(contents.as_bytes())
            .map_err(|e| io("create file", e))?;
        file.sync_all().map_err(|e| io("create file", e))?;
        let meta = fs::metadata(&path).map_err(|e| io("create file", e))?;
        self.entry(&path, &meta)
    }

    /// Renames a file, never over another one (`Exists`), into another folder
    /// too (made if needed). A change of case only (`Test.md` → `test.md`)
    /// works on case-insensitive disks too.
    pub fn rename(&self, from: &str, to: &str) -> Result<FileEntry, FolderError> {
        let source = self.existing(from)?;
        self.make_folders_for(to)?;
        let target = self.resolve(to)?;
        // A hard link cannot replace an existing file, so taking the new name
        // this way is atomic; then the old name goes.
        match fs::hard_link(&source, &target) {
            Ok(()) => fs::remove_file(&source).map_err(|e| io("rename file", e))?,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if !same_file(&source, &target) {
                    return Err(FolderError::Exists(to.to_string()));
                }
                fs::rename(&source, &target).map_err(|e| io("rename file", e))?;
            }
            // Disks without hard links (e.g. FAT): check, then rename.
            Err(_) => {
                if target.exists() && !same_file(&source, &target) {
                    return Err(FolderError::Exists(to.to_string()));
                }
                fs::rename(&source, &target).map_err(|e| io("rename file", e))?;
            }
        }
        let meta = fs::metadata(&target).map_err(|e| io("rename file", e))?;
        self.entry(&target, &meta)
    }

    /// Opens the file in the system's default app for Markdown.
    pub fn open_external(&self, relative: &str) -> Result<(), FolderError> {
        let path = self.existing(relative)?;
        open::that_detached(&path).map_err(|e| FolderError::Io(format!("open file: {e}")))
    }

    /// Shows the file in the system file manager.
    pub fn reveal(&self, relative: &str) -> Result<(), FolderError> {
        let path = self.existing(relative)?;
        let result = if cfg!(target_os = "macos") {
            std::process::Command::new("open")
                .arg("-R")
                .arg(&path)
                .spawn()
                .map(|_| ())
        } else {
            // Other platforms: open the containing folder.
            open::that_detached(path.parent().unwrap_or(&self.root))
        };
        result.map_err(|e| FolderError::Io(format!("show file: {e}")))
    }

    fn existing(&self, relative: &str) -> Result<PathBuf, FolderError> {
        let path = self.resolve(relative)?;
        if path.is_file() {
            Ok(path)
        } else {
            Err(FolderError::NotFound(relative.to_string()))
        }
    }

    /// Moves the file to the system trash, so it can be restored.
    pub fn trash(&self, relative: &str) -> Result<(), FolderError> {
        let path = self.resolve(relative)?;
        if !path.exists() {
            return Err(FolderError::NotFound(relative.to_string()));
        }
        trash::delete(&path).map_err(|e| FolderError::Io(format!("move to trash: {e}")))
    }
}

/// What a changed path, as reported by the file watcher, means for the library.
#[derive(Debug, PartialEq)]
pub enum Changed {
    /// A Markdown file (relative path) was created, changed or removed.
    File(String),
    /// Something else that may affect many files (e.g. a folder renamed):
    /// the whole folder should be read again.
    Rescan,
    /// Not relevant: what the ignore rules skip, hidden files other than
    /// Markdown (our temporary files, `.DS_Store`), other file types, paths
    /// outside the folder.
    Ignored,
}

impl Folder {
    /// A change to the ignore rules themselves is followed here, and asks for
    /// a rescan: files may have come in or gone out.
    pub fn classify(&self, absolute: &Path) -> Changed {
        let Ok(relative) = absolute.strip_prefix(&self.root) else {
            return Changed::Ignored;
        };
        let mut parts = Vec::new();
        for component in relative.components() {
            let Component::Normal(part) = component else {
                return Changed::Ignored;
            };
            parts.push(part.to_string_lossy().into_owned());
        }
        if parts.is_empty() {
            return Changed::Rescan;
        }
        if parts == [IGNORE_FILE] {
            self.reload_ignore();
            return Changed::Rescan;
        }
        let is_dir = absolute.is_dir();
        if self.ignores(relative, is_dir) {
            return Changed::Ignored;
        }
        if is_markdown(absolute) {
            return Changed::File(parts.join("/"));
        }
        let hidden = parts.last().is_some_and(|name| name.starts_with('.'));
        // A directory, or something that is no longer there to inspect.
        if is_dir || (!hidden && absolute.extension().is_none()) {
            Changed::Rescan
        } else {
            Changed::Ignored
        }
    }
}

/// Writes through a temporary file renamed over the target, so readers see
/// the old contents or the new, never a part.
fn write_atomically(path: &Path, contents: &str) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let temp = dir.join(format!(".{name}.konspecter-tmp"));
    let result = (|| {
        let mut file = fs::File::create(&temp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md"))
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Whether two paths name the same file (e.g. differing only in case on a
/// case-insensitive disk).
fn same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (fs::metadata(a), fs::metadata(b)) {
            (Ok(a), Ok(b)) => a.dev() == b.dev() && a.ino() == b.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        match (fs::canonicalize(a), fs::canonicalize(b)) {
            (Ok(a), Ok(b)) => {
                a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
            }
            _ => false,
        }
    }
}

/// A readable, portable file name for a note title.
pub fn file_stem_for(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || " -_".contains(c) {
                c
            } else {
                ' '
            }
        })
        .collect();
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    let stem: String = words.join(" ").chars().take(80).collect();
    let stem = stem.trim().to_string();
    if stem.is_empty() {
        "Untitled".to_string()
    } else {
        stem
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder() -> (tempfile::TempDir, Folder) {
        let dir = tempfile::tempdir().unwrap();
        let folder = Folder::open(dir.path()).unwrap();
        (dir, folder)
    }

    #[test]
    fn opens_the_default_folder_making_it_once() {
        let home = tempfile::tempdir().unwrap();
        let folder = Folder::open_default(home.path()).unwrap();
        assert!(folder.root().ends_with(DEFAULT_FOLDER_NAME));
        assert!(folder.root().is_dir());

        fs::write(folder.root().join("kept.md"), "# Kept").unwrap();
        let again = Folder::open_default(home.path()).unwrap();
        assert_eq!(again.root(), folder.root());
        assert_eq!(
            again.list().unwrap().len(),
            1,
            "an existing folder is reused as it is"
        );
    }

    #[test]
    fn resolves_safe_paths_only() {
        let (_dir, folder) = folder();
        fs::create_dir(folder.root().join("sub")).unwrap();
        assert!(folder.resolve("note.md").is_ok());
        assert!(folder.resolve("sub/Note.MD").is_ok());
        assert!(
            folder.resolve(".hidden.md").is_ok(),
            "the ignore rules decide"
        );
        for bad in [
            "",
            "../escape.md",
            "sub/../../x.md",
            "/etc/passwd.md",
            "note.txt",
            "sub/.git/x.md",
            "a\\b.md",
            "c:x.md",
            "missing-dir/x.md",
        ] {
            assert!(folder.resolve(bad).is_err(), "{bad:?} was accepted");
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_escape_the_folder() {
        let (_dir, folder) = folder();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path(), folder.root().join("link")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.md"), folder.root().join("s.md"))
            .unwrap();

        assert!(folder.resolve("link/secret.md").is_err());
        assert!(folder.read("s.md").is_err());
        assert!(folder.list().unwrap().is_empty(), "symlinks are not listed");
    }

    #[test]
    fn lists_markdown_files_recursively() {
        let (_dir, folder) = folder();
        let root = folder.root();
        fs::create_dir_all(root.join("java/collections")).unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::write(root.join("b.md"), "b").unwrap();
        fs::write(root.join("java/a.md"), "a").unwrap();
        fs::write(root.join("java/collections/maps.md"), "maps").unwrap();
        fs::write(root.join("notes.txt"), "no").unwrap();
        fs::write(root.join(".hidden.md"), "no").unwrap();
        fs::write(root.join(".git/x.md"), "no").unwrap();

        let paths: Vec<String> = folder.list().unwrap().into_iter().map(|e| e.path).collect();
        assert_eq!(paths, ["b.md", "java/a.md", "java/collections/maps.md"]);
    }

    fn listed(folder: &Folder) -> Vec<String> {
        folder.list().unwrap().into_iter().map(|e| e.path).collect()
    }

    #[test]
    fn skips_what_the_default_rules_name() {
        let (_dir, folder) = folder();
        let root = folder.root();
        for dir in [
            "node_modules/pkg",
            "vendors",
            "dist",
            "bin",
            "work/dist",
            ".obsidian",
        ] {
            fs::create_dir_all(root.join(dir)).unwrap();
            fs::write(root.join(dir).join("x.md"), "x").unwrap();
        }
        fs::write(root.join("bin.md"), "kept").unwrap();
        fs::create_dir(root.join("binary")).unwrap();
        fs::write(root.join("binary/x.md"), "kept").unwrap();

        assert_eq!(folder.ignore_text().unwrap(), DEFAULT_IGNORE);
        assert_eq!(listed(&folder), ["bin.md", "binary/x.md"]);
    }

    #[test]
    fn follows_the_folders_own_rules() {
        let (_dir, folder) = folder();
        let root = folder.root();
        fs::create_dir_all(root.join(".notes")).unwrap();
        fs::create_dir_all(root.join("drafts")).unwrap();
        fs::write(root.join(".notes/a.md"), "a").unwrap();
        fs::write(root.join("drafts/b.md"), "b").unwrap();
        fs::write(root.join("c.md"), "c").unwrap();
        fs::write(root.join("keep.tmp.md"), "k").unwrap();
        fs::write(root.join("x.tmp.md"), "x").unwrap();
        assert_eq!(
            listed(&folder),
            ["c.md", "drafts/b.md", "keep.tmp.md", "x.tmp.md"]
        );

        // Hidden files are read once the rule for them is gone.
        folder
            .write_ignore("# mine\ndrafts/\n*.tmp.md\n!keep.tmp.md\n")
            .unwrap();
        assert_eq!(
            fs::read_to_string(root.join(IGNORE_FILE)).unwrap(),
            "# mine\ndrafts/\n*.tmp.md\n!keep.tmp.md\n"
        );
        assert_eq!(listed(&folder), [".notes/a.md", "c.md", "keep.tmp.md"]);
        assert_eq!(folder.read(".notes/a.md").unwrap().text, "a");

        // A folder opened later reads the same file.
        let again = Folder::open(root).unwrap();
        assert_eq!(listed(&again), [".notes/a.md", "c.md", "keep.tmp.md"]);
        assert!(matches!(
            folder.write_ignore(&"x".repeat(MAX_IGNORE_BYTES as usize + 1)),
            Err(FolderError::TooLarge(_))
        ));
    }

    #[test]
    fn makes_and_removes_nothing_the_rules_skip() {
        let (dir, folder) = folder();
        assert!(matches!(
            folder.create_at("dist/x.md", "x"),
            Err(FolderError::InvalidPath(_))
        ));
        folder.write("a.md", "a").unwrap();
        assert!(matches!(
            folder.rename("a.md", "node_modules/a.md"),
            Err(FolderError::InvalidPath(_))
        ));
        assert!(!dir.path().join("dist").exists());
        assert!(!dir.path().join("node_modules").exists());

        fs::create_dir(dir.path().join("bin")).unwrap();
        assert!(matches!(
            folder.remove_empty_dir("bin"),
            Err(FolderError::InvalidPath(_))
        ));
        assert!(dir.path().join("bin").exists());
    }

    #[test]
    fn reads_and_writes_atomically() {
        let (_dir, folder) = folder();
        let written = folder.write("note.md", "# Hi\n").unwrap();
        assert_eq!(written.path, "note.md");
        let read = folder.read("note.md").unwrap();
        assert_eq!(read.text, "# Hi\n");
        assert_eq!(read.entry, written);
        let leftovers: Vec<_> = fs::read_dir(folder.root()).unwrap().collect();
        assert_eq!(leftovers.len(), 1, "no temporary files are left behind");
    }

    #[test]
    fn overwrites_a_file_changed_on_disk() {
        let (_dir, folder) = folder();
        folder.write("note.md", "v1").unwrap();
        fs::write(folder.root().join("note.md"), "changed in another editor").unwrap();

        folder.write("note.md", "v2 from the app").unwrap();
        assert_eq!(folder.read("note.md").unwrap().text, "v2 from the app");
    }

    #[test]
    fn creates_files_with_unique_names() {
        let (_dir, folder) = folder();
        let a = folder.create("Java: Collections / Maps", "a").unwrap();
        let b = folder.create("Java: Collections / Maps", "b").unwrap();
        let untitled = folder.create("  ", "c").unwrap();
        assert_eq!(a.path, "Java Collections Maps.md");
        assert_eq!(b.path, "Java Collections Maps 2.md");
        assert_eq!(untitled.path, "Untitled.md");
        assert_eq!(folder.read(&a.path).unwrap().text, "a");
    }

    #[test]
    fn creates_files_at_exact_paths_only_when_free() {
        let (_dir, folder) = folder();
        fs::create_dir(folder.root().join("sub")).unwrap();
        let entry = folder.create_at("sub/hello-mir.md", "a").unwrap();
        assert_eq!(entry.path, "sub/hello-mir.md");
        assert_eq!(
            folder.create_at("sub/hello-mir.md", "b"),
            Err(FolderError::Exists("sub/hello-mir.md".into()))
        );
        assert_eq!(folder.read("sub/hello-mir.md").unwrap().text, "a");
    }

    #[test]
    fn creates_and_renames_into_folders_it_makes() {
        let (dir, folder) = folder();
        let entry = folder.create_at("java/collections/maps.md", "a").unwrap();
        assert_eq!(entry.path, "java/collections/maps.md");
        assert!(dir.path().join("java/collections").is_dir());

        let moved = folder
            .rename("java/collections/maps.md", "go/maps.md")
            .unwrap();
        assert_eq!(moved.path, "go/maps.md");
        assert_eq!(folder.read("go/maps.md").unwrap().text, "a");

        for bad in ["../out/x.md", ".git/x.md", "a/.hidden/x.md"] {
            assert!(matches!(
                folder.create_at(bad, "x"),
                Err(FolderError::InvalidPath(_))
            ));
        }
        assert!(!dir.path().join("a").exists());
    }

    #[cfg(unix)]
    #[test]
    fn makes_no_folders_through_a_symlink_out() {
        let (_dir, folder) = folder();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), folder.root().join("link")).unwrap();
        assert!(matches!(
            folder.create_at("link/sub/x.md", "x"),
            Err(FolderError::InvalidPath(_))
        ));
        assert!(!outside.path().join("sub").exists());
    }

    #[test]
    fn removes_folders_left_empty_only() {
        let (dir, folder) = folder();
        let root = dir.path();
        fs::create_dir_all(root.join("a/b/c")).unwrap();
        fs::write(root.join("a/b/.DS_Store"), "finder").unwrap();
        fs::write(root.join("a/keep.md"), "x").unwrap();

        folder.remove_empty_dir("a/b/c").unwrap();
        assert!(!root.join("a/b").exists(), "c, then b with only .DS_Store");
        assert!(root.join("a/keep.md").exists(), "a still holds a file");

        fs::create_dir(root.join("full")).unwrap();
        fs::write(root.join("full/notes.txt"), "x").unwrap();
        folder.remove_empty_dir("full").unwrap();
        assert!(root.join("full/notes.txt").exists());

        folder.remove_empty_dir("missing/folder").unwrap();
        for bad in ["", "../x", ".git", "a/../.."] {
            assert!(matches!(
                folder.remove_empty_dir(bad),
                Err(FolderError::InvalidPath(_))
            ));
        }
        assert!(root.exists());
    }

    #[test]
    fn renames_without_overwriting() {
        let (_dir, folder) = folder();
        folder.write("test.md", "mine").unwrap();
        folder.write("taken.md", "other").unwrap();

        assert_eq!(
            folder.rename("test.md", "taken.md"),
            Err(FolderError::Exists("taken.md".into()))
        );
        assert_eq!(folder.read("taken.md").unwrap().text, "other");

        let moved = folder.rename("test.md", "hello-mir.md").unwrap();
        assert_eq!(moved.path, "hello-mir.md");
        assert_eq!(folder.read("hello-mir.md").unwrap().text, "mine");
        assert!(matches!(
            folder.read("test.md"),
            Err(FolderError::NotFound(_))
        ));
        assert!(matches!(
            folder.rename("missing.md", "x.md"),
            Err(FolderError::NotFound(_))
        ));
    }

    #[test]
    fn renames_a_change_of_case() {
        let (_dir, folder) = folder();
        folder.write("Test.md", "mine").unwrap();
        let moved = folder.rename("Test.md", "test.md").unwrap();
        assert_eq!(moved.path, "test.md");
        let names: Vec<String> = folder.list().unwrap().into_iter().map(|e| e.path).collect();
        assert_eq!(names, ["test.md"]);
    }

    #[test]
    fn reads_invalid_utf8_lossily_and_refuses_huge_files() {
        let (_dir, folder) = folder();
        fs::write(folder.root().join("bin.md"), [b'o', b'k', 0xff]).unwrap();
        assert_eq!(folder.read("bin.md").unwrap().text, "ok\u{fffd}");
        let huge = "x".repeat((MAX_FILE_BYTES + 1) as usize);
        assert!(matches!(
            folder.write("big.md", &huge),
            Err(FolderError::TooLarge(_))
        ));
    }

    #[test]
    fn classifies_watcher_paths() {
        let (_dir, folder) = folder();
        let root = folder.root();
        fs::create_dir(root.join("sub")).unwrap();
        assert_eq!(
            folder.classify(&root.join("sub/a.md")),
            Changed::File("sub/a.md".into())
        );
        assert_eq!(folder.classify(&root.join("sub")), Changed::Rescan);
        assert_eq!(folder.classify(&root.join("renamed-away")), Changed::Rescan);
        assert_eq!(folder.classify(root), Changed::Rescan);
        assert_eq!(
            folder.classify(&root.join(".a.md.konspecter-tmp")),
            Changed::Ignored
        );
        assert_eq!(folder.classify(&root.join(".git/HEAD")), Changed::Ignored);
        assert_eq!(
            folder.classify(&root.join("node_modules/pkg/README.md")),
            Changed::Ignored
        );
        assert_eq!(folder.classify(&root.join("image.png")), Changed::Ignored);
        assert_eq!(
            folder.classify(Path::new("/elsewhere/a.md")),
            Changed::Ignored
        );
    }

    #[test]
    fn follows_changes_to_the_rules_seen_by_the_watcher() {
        let (_dir, folder) = folder();
        let root = folder.root();
        let watched = folder.clone();
        assert_eq!(watched.classify(&root.join(".a/b.md")), Changed::Ignored);

        // Another program edits the rules: the watcher rescans with the new ones.
        fs::write(root.join(IGNORE_FILE), "dist\n").unwrap();
        assert_eq!(watched.classify(&root.join(IGNORE_FILE)), Changed::Rescan);
        assert_eq!(
            folder.classify(&root.join(".a/b.md")),
            Changed::File(".a/b.md".into())
        );
        // Hidden files other than Markdown still mean nothing.
        assert_eq!(folder.classify(&root.join(".DS_Store")), Changed::Ignored);
        assert_eq!(
            folder.classify(&root.join(".b.md.konspecter-tmp")),
            Changed::Ignored
        );

        // The app writes them: every clone (the watcher's) follows.
        folder.write_ignore(".*\n").unwrap();
        assert_eq!(watched.classify(&root.join(".a/b.md")), Changed::Ignored);
    }

    #[test]
    fn external_opening_checks_the_path_first() {
        let (_dir, folder) = folder();
        assert!(matches!(
            folder.open_external("../outside.md"),
            Err(FolderError::InvalidPath(_))
        ));
        assert!(matches!(
            folder.open_external("missing.md"),
            Err(FolderError::NotFound(_))
        ));
        assert!(matches!(
            folder.reveal("missing.md"),
            Err(FolderError::NotFound(_))
        ));
    }

    /// Performance measurement (docs/performance.md): `cargo test --release -- --ignored`.
    #[test]
    #[ignore]
    fn measure_listing_and_reading_5000_files() {
        let (_dir, folder) = folder();
        let text = "# Note\n\n".to_string() + &"word ".repeat(800);
        for i in 0..5000 {
            let dir = folder.root().join(format!("d{}", i % 50));
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join(format!("note-{i}.md")), &text).unwrap();
        }
        let start = std::time::Instant::now();
        let entries = folder.list().unwrap();
        let listed = start.elapsed();
        let start = std::time::Instant::now();
        for entry in &entries {
            folder.read(&entry.path).unwrap();
        }
        let read = start.elapsed();
        println!("PERF list 5,000 files: {listed:?}; read all: {read:?}");
        assert_eq!(entries.len(), 5000);
    }

    #[test]
    fn file_stems_are_portable() {
        assert_eq!(file_stem_for("Hash maps"), "Hash maps");
        assert_eq!(file_stem_for("a/b\\c:d*e?f"), "a b c d e f");
        assert_eq!(file_stem_for("Заметки"), "Заметки");
        assert_eq!(file_stem_for(""), "Untitled");
    }
}
