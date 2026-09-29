//! File Mode: a folder of Markdown files on disk, used as a note library.
//!
//! The web app never names absolute paths. It works with paths relative to the
//! folder the user picked, and every one is checked here: no `..`, no absolute
//! paths, no hidden files, `.md` only, and no symlink may lead outside the
//! folder. Writes are atomic; deleted files go to the system trash.

use serde::Serialize;
use std::fmt;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Guards against runaway walks (e.g. a picked home directory).
const MAX_FILES: usize = 20_000;
const MAX_DEPTH: usize = 24;
/// Same limit as the server's.
const MAX_FILE_BYTES: u64 = 5 << 20;

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
    /// The file changed on disk since the app read it.
    ChangedOnDisk(String),
    TooLarge(String),
    Io(String),
}

impl FolderError {
    pub fn code(&self) -> &'static str {
        match self {
            FolderError::InvalidPath(_) => "invalid_path",
            FolderError::NotFound(_) => "not_found",
            FolderError::ChangedOnDisk(_) => "changed_on_disk",
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
            FolderError::ChangedOnDisk(p) => write!(f, "{p} was changed by another program"),
            FolderError::TooLarge(p) => write!(f, "{p} is larger than 5 MB"),
            FolderError::Io(message) => write!(f, "{message}"),
        }
    }
}

fn io(context: &str, error: std::io::Error) -> FolderError {
    FolderError::Io(format!("{context}: {error}"))
}

/// A picked folder. The root is canonical (symlinks resolved).
#[derive(Debug, Clone)]
pub struct Folder {
    root: PathBuf,
}

impl Folder {
    pub fn open(path: &Path) -> Result<Self, FolderError> {
        let root = fs::canonicalize(path).map_err(|e| io("open folder", e))?;
        if !root.is_dir() {
            return Err(FolderError::InvalidPath(path.display().to_string()));
        }
        Ok(Folder { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The absolute path for a relative one, if it is a safe Markdown path
    /// inside the folder.
    pub fn resolve(&self, relative: &str) -> Result<PathBuf, FolderError> {
        let invalid = || FolderError::InvalidPath(relative.to_string());
        if relative.is_empty() || relative.contains('\\') || relative.contains('\0') {
            return Err(invalid());
        }
        let relative_path = Path::new(relative);
        let mut joined = self.root.clone();
        for component in relative_path.components() {
            match component {
                Component::Normal(part) => {
                    let part = part.to_str().ok_or_else(invalid)?;
                    if part.starts_with('.') || part.contains(':') {
                        return Err(invalid());
                    }
                    joined.push(part);
                }
                _ => return Err(invalid()),
            }
        }
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
    /// Hidden files and folders and symlinks are skipped.
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
            let name = item.file_name();
            if name.to_string_lossy().starts_with('.') {
                continue;
            }
            let path = item.path();
            let meta = fs::symlink_metadata(&path).map_err(|e| io("list folder", e))?;
            if meta.file_type().is_symlink() {
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

    /// Writes the file atomically (a temporary file renamed over it). With
    /// `expected_modified_ms`, refuses if the file changed since then.
    pub fn write(
        &self,
        relative: &str,
        contents: &str,
        expected_modified_ms: Option<u64>,
    ) -> Result<FileEntry, FolderError> {
        let path = self.resolve(relative)?;
        if contents.len() as u64 > MAX_FILE_BYTES {
            return Err(FolderError::TooLarge(relative.to_string()));
        }
        if let (Some(expected), Ok(meta)) = (expected_modified_ms, fs::metadata(&path))
            && modified_ms(&meta) != expected
        {
            return Err(FolderError::ChangedOnDisk(relative.to_string()));
        }
        let dir = path
            .parent()
            .ok_or_else(|| FolderError::InvalidPath(relative.to_string()))?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let temp = dir.join(format!(".{name}.konspecter-tmp"));
        let result = (|| {
            let mut file = fs::File::create(&temp)?;
            file.write_all(contents.as_bytes())?;
            file.sync_all()?;
            fs::rename(&temp, &path)
        })();
        if let Err(error) = result {
            let _ = fs::remove_file(&temp);
            return Err(io("write file", error));
        }
        let meta = fs::metadata(&path).map_err(|e| io("write file", e))?;
        self.entry(&path, &meta)
    }

    /// Creates a new file in the folder's top level named after `title`,
    /// adding " 2", " 3" … if the name is taken. Never overwrites.
    pub fn create(&self, title: &str, contents: &str) -> Result<FileEntry, FolderError> {
        let stem = file_stem_for(title);
        for n in 1..10_000 {
            let name = if n == 1 {
                format!("{stem}.md")
            } else {
                format!("{stem} {n}.md")
            };
            let path = self.resolve(&name)?;
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(mut file) => {
                    file.write_all(contents.as_bytes())
                        .map_err(|e| io("create file", e))?;
                    file.sync_all().map_err(|e| io("create file", e))?;
                    let meta = fs::metadata(&path).map_err(|e| io("create file", e))?;
                    return self.entry(&path, &meta);
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(io("create file", e)),
            }
        }
        Err(FolderError::Io("could not find a free file name".into()))
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
    /// Not relevant: hidden files (including our temporary files), other
    /// file types, paths outside the folder.
    Ignored,
}

impl Folder {
    pub fn classify(&self, absolute: &Path) -> Changed {
        let Ok(relative) = absolute.strip_prefix(&self.root) else {
            return Changed::Ignored;
        };
        let mut parts = Vec::new();
        for component in relative.components() {
            let Component::Normal(part) = component else {
                return Changed::Ignored;
            };
            let part = part.to_string_lossy();
            if part.starts_with('.') {
                return Changed::Ignored;
            }
            parts.push(part.into_owned());
        }
        if parts.is_empty() {
            return Changed::Rescan;
        }
        if is_markdown(absolute) {
            return Changed::File(parts.join("/"));
        }
        // A directory, or something that is no longer there to inspect.
        if absolute.is_dir() || absolute.extension().is_none() {
            Changed::Rescan
        } else {
            Changed::Ignored
        }
    }
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
    fn resolves_safe_paths_only() {
        let (_dir, folder) = folder();
        fs::create_dir(folder.root().join("sub")).unwrap();
        assert!(folder.resolve("note.md").is_ok());
        assert!(folder.resolve("sub/Note.MD").is_ok());
        for bad in [
            "",
            "../escape.md",
            "sub/../../x.md",
            "/etc/passwd.md",
            "note.txt",
            ".hidden.md",
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

    #[test]
    fn reads_and_writes_atomically() {
        let (_dir, folder) = folder();
        let written = folder.write("note.md", "# Hi\n", None).unwrap();
        assert_eq!(written.path, "note.md");
        let read = folder.read("note.md").unwrap();
        assert_eq!(read.text, "# Hi\n");
        assert_eq!(read.entry, written);
        let leftovers: Vec<_> = fs::read_dir(folder.root()).unwrap().collect();
        assert_eq!(leftovers.len(), 1, "no temporary files are left behind");
    }

    #[test]
    fn refuses_to_overwrite_a_file_changed_on_disk() {
        let (_dir, folder) = folder();
        let first = folder.write("note.md", "v1", None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(folder.root().join("note.md"), "changed in another editor").unwrap();

        let result = folder.write("note.md", "v2 from the app", Some(first.modified_ms));
        assert_eq!(result, Err(FolderError::ChangedOnDisk("note.md".into())));
        assert_eq!(
            folder.read("note.md").unwrap().text,
            "changed in another editor"
        );
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
    fn reads_invalid_utf8_lossily_and_refuses_huge_files() {
        let (_dir, folder) = folder();
        fs::write(folder.root().join("bin.md"), [b'o', b'k', 0xff]).unwrap();
        assert_eq!(folder.read("bin.md").unwrap().text, "ok\u{fffd}");
        let huge = "x".repeat((MAX_FILE_BYTES + 1) as usize);
        assert!(matches!(
            folder.write("big.md", &huge, None),
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
        assert_eq!(folder.classify(&root.join("image.png")), Changed::Ignored);
        assert_eq!(
            folder.classify(Path::new("/elsewhere/a.md")),
            Changed::Ignored
        );
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
