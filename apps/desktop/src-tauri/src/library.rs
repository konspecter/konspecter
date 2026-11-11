//! The folders the desktop library is made of, and their saved list.
//!
//! Every connected folder has an id, a hash of its saved path, so the same
//! folder connected again gets the same id. The list lives in `folders.json`
//! in the app's config folder: the path, an optional alias and when it was
//! added. Removing a folder only takes it off the list; its files are never
//! touched. The default `~/Konspecter` is made on the very first start only:
//! a list left empty stays empty.

use crate::folder::{Folder, same_file};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The list's file in the app's config folder.
pub const LIBRARY_FILE: &str = "folders.json";
/// The one-folder file of earlier versions, moved into the list once.
const OLD_FOLDER_FILE: &str = "folder.json";
/// Where a list that cannot be read is put aside, rather than overwritten.
const UNREADABLE_FILE: &str = "folders.unreadable.json";
/// The longest alias, in characters.
const MAX_ALIAS: usize = 100;

/// A folder as it is saved.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFolder {
    /// The folder's real path when it was added.
    pub path: String,
    #[serde(default)]
    pub alias: Option<String>,
    /// When it was added, in milliseconds since the Unix epoch.
    #[serde(default)]
    pub added_ms: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct SavedList {
    folders: Vec<SavedFolder>,
}

/// A connected folder: `folder` is `None` while it cannot be opened (a disk
/// not mounted, a folder moved away). It stays on the list until removed.
#[derive(Debug, Clone)]
struct Connected {
    id: String,
    saved: SavedFolder,
    folder: Option<Folder>,
}

/// A connected folder as the web app receives it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    pub id: String,
    pub path: String,
    pub alias: Option<String>,
    pub added_ms: u64,
    pub available: bool,
}

#[derive(Debug, PartialEq)]
pub enum LibraryError {
    /// The folder is connected already.
    Connected,
    /// The folder is inside a connected one, or holds one.
    Overlaps,
    /// The alias is longer than `MAX_ALIAS`.
    InvalidAlias,
    /// No connected folder has this id.
    Unknown,
}

impl LibraryError {
    pub fn code(&self) -> &'static str {
        match self {
            LibraryError::Connected => "folder_connected",
            LibraryError::Overlaps => "folder_overlaps",
            LibraryError::InvalidAlias => "invalid_alias",
            LibraryError::Unknown => "no_folder",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            LibraryError::Connected => "the folder is connected already",
            LibraryError::Overlaps => "the folder is inside a connected folder, or holds one",
            LibraryError::InvalidAlias => "the alias is too long",
            LibraryError::Unknown => "no such folder is connected",
        }
    }
}

/// A folder's id: FNV-1a (64 bits) of its saved path, in hex. Stable for a
/// path, and never holds a `/`, so a note id can start with it.
pub fn folder_id(path: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The connected folders, in the order they were added.
#[derive(Debug, Default, Clone)]
pub struct Library {
    folders: Vec<Connected>,
    /// Where the list is saved; `None` keeps it in memory only.
    file: Option<PathBuf>,
}

impl Library {
    /// Reads the saved list from `config_dir`. Without one, the folder of an
    /// earlier version is moved into a new list (kept, as not found, if it
    /// cannot be opened now), or, on the very first start, `<home>/Konspecter`
    /// is made and connected. A list that cannot be read is put aside
    /// (`folders.unreadable.json`), never overwritten, and the start goes on
    /// as a first start.
    pub fn load(config_dir: Option<&Path>, home: Option<&Path>, now_ms: u64) -> Library {
        let file = config_dir.map(|dir| dir.join(LIBRARY_FILE));
        if let Some(file) = file.as_deref()
            && file.exists()
        {
            let saved = fs::read_to_string(file)
                .ok()
                .and_then(|text| serde_json::from_str::<SavedList>(&text).ok());
            match saved {
                Some(saved) => {
                    let folders = saved.folders.into_iter().map(Connected::open).collect();
                    return Library {
                        folders,
                        file: Some(file.to_path_buf()),
                    };
                }
                None => {
                    let _ = fs::rename(file, file.with_file_name(UNREADABLE_FILE));
                }
            }
        }

        let mut library = Library {
            folders: Vec::new(),
            file,
        };
        let old = config_dir.map(|dir| dir.join(OLD_FOLDER_FILE));
        match old.as_deref().and_then(old_folder_path) {
            Some(path) => match Folder::open(Path::new(&path)) {
                Ok(folder) => {
                    let _ = library.add(folder, now_ms);
                }
                // The folder of an earlier version that cannot be opened now
                // (a disk not mounted) stays the library's folder, as not found.
                Err(_) => library.folders.push(Connected::open(SavedFolder {
                    path,
                    alias: None,
                    added_ms: now_ms,
                })),
            },
            None => {
                if let Some(folder) = home.and_then(|home| Folder::open_default(home).ok()) {
                    let _ = library.add(folder, now_ms);
                }
            }
        }
        if library.save().is_ok()
            && let Some(old) = old
        {
            let _ = fs::remove_file(old);
        }
        library
    }

    /// Writes the list, atomically: to a temporary file renamed over it, so
    /// a crash leaves the old list or the new one, never a part. A library
    /// kept in memory has nothing to write.
    pub fn save(&self) -> std::io::Result<()> {
        let Some(file) = &self.file else {
            return Ok(());
        };
        if let Some(dir) = file.parent() {
            fs::create_dir_all(dir)?;
        }
        let list = SavedList {
            folders: self.folders.iter().map(|f| f.saved.clone()).collect(),
        };
        let json = serde_json::to_string_pretty(&list).map_err(std::io::Error::other)?;
        let temp = file.with_extension("json.tmp");
        let written = (|| {
            let mut out = fs::File::create(&temp)?;
            out.write_all(json.as_bytes())?;
            out.sync_all()?;
            fs::rename(&temp, file)
        })();
        if written.is_err() {
            let _ = fs::remove_file(&temp);
        }
        written
    }

    /// An empty library saved at `file` (tests).
    #[cfg(test)]
    pub fn at(file: Option<PathBuf>) -> Library {
        Library {
            folders: Vec::new(),
            file,
        }
    }

    pub fn infos(&self) -> Vec<FolderInfo> {
        self.folders.iter().map(Connected::info).collect()
    }

    /// The open folders with their ids.
    pub fn open_folders(&self) -> Vec<(String, Folder)> {
        self.folders
            .iter()
            .filter_map(|c| c.folder.clone().map(|f| (c.id.clone(), f)))
            .collect()
    }

    /// The folder with this id, if it is connected and open.
    pub fn get(&self, id: &str) -> Option<&Folder> {
        self.folders
            .iter()
            .find(|c| c.id == id)
            .and_then(|c| c.folder.as_ref())
    }

    /// Connects a folder at the end of the list. A folder connected already,
    /// or one inside a connected folder or holding one, is refused.
    pub fn add(&mut self, folder: Folder, now_ms: u64) -> Result<FolderInfo, LibraryError> {
        let path = folder.root().display().to_string();
        let id = folder_id(&path);
        for connected in &self.folders {
            if connected.id == id {
                return Err(LibraryError::Connected);
            }
            let other = connected
                .folder
                .as_ref()
                .map(|f| f.root().to_path_buf())
                .unwrap_or_else(|| PathBuf::from(&connected.saved.path));
            if same_file(folder.root(), &other) {
                return Err(LibraryError::Connected);
            }
            if inside(folder.root(), &other) || inside(&other, folder.root()) {
                return Err(LibraryError::Overlaps);
            }
        }
        let connected = Connected {
            id,
            saved: SavedFolder {
                path,
                alias: None,
                added_ms: now_ms,
            },
            folder: Some(folder),
        };
        let info = connected.info();
        self.folders.push(connected);
        Ok(info)
    }

    /// Takes a folder off the list. Its files stay where they are.
    pub fn remove(&mut self, id: &str) -> Result<(), LibraryError> {
        let index = self.index(id)?;
        self.folders.remove(index);
        Ok(())
    }

    /// Names a folder for the app; an empty alias goes back to its own name.
    pub fn set_alias(&mut self, id: &str, alias: Option<&str>) -> Result<(), LibraryError> {
        let alias = alias.map(str::trim).filter(|a| !a.is_empty());
        if alias.is_some_and(|a| a.chars().count() > MAX_ALIAS) {
            return Err(LibraryError::InvalidAlias);
        }
        let index = self.index(id)?;
        self.folders[index].saved.alias = alias.map(str::to_string);
        Ok(())
    }

    /// Forgets every folder and the saved list: the next start is a first
    /// start. No file in the folders is touched. If the list cannot be
    /// deleted, the folders stay connected.
    pub fn reset(&mut self) -> std::io::Result<()> {
        if let Some(file) = &self.file {
            match fs::remove_file(file) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
                _ => {}
            }
        }
        self.folders.clear();
        Ok(())
    }

    fn index(&self, id: &str) -> Result<usize, LibraryError> {
        self.folders
            .iter()
            .position(|c| c.id == id)
            .ok_or(LibraryError::Unknown)
    }
}

impl Connected {
    fn open(saved: SavedFolder) -> Connected {
        Connected {
            id: folder_id(&saved.path),
            folder: Folder::open(Path::new(&saved.path)).ok(),
            saved,
        }
    }

    fn info(&self) -> FolderInfo {
        FolderInfo {
            id: self.id.clone(),
            path: self.saved.path.clone(),
            alias: self.saved.alias.clone(),
            added_ms: self.saved.added_ms,
            available: self.folder.is_some(),
        }
    }
}

/// The folder path an earlier version's `folder.json` names, if any.
fn old_folder_path(file: &Path) -> Option<String> {
    let text = fs::read_to_string(file).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some(json.get("path")?.as_str()?.to_string())
}

/// Whether `inner` is inside `outer` (not the same folder). One of the
/// folders `inner` is in is compared as a file too, so a difference in case
/// on a case-insensitive disk is still caught.
fn inside(inner: &Path, outer: &Path) -> bool {
    inner
        .ancestors()
        .skip(1)
        .any(|parent| parent == outer || same_file(parent, outer))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library() -> (tempfile::TempDir, Library) {
        let config = tempfile::tempdir().unwrap();
        let library = Library::at(Some(config.path().join(LIBRARY_FILE)));
        (config, library)
    }

    fn open(path: &Path) -> Folder {
        Folder::open(path).unwrap()
    }

    #[test]
    fn ids_are_stable_hex_without_slashes() {
        let a = folder_id("/Users/ada/Konspecter");
        assert_eq!(a, folder_id("/Users/ada/Konspecter"));
        assert_ne!(a, folder_id("/Users/ada/Work"));
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn the_first_start_connects_the_default_folder() {
        let config = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        let library = Library::load(Some(config.path()), Some(home.path()), 7);

        let infos = library.infos();
        assert_eq!(infos.len(), 1);
        assert!(infos[0].path.ends_with("Konspecter"));
        assert_eq!(infos[0].added_ms, 7);
        assert!(infos[0].available);
        assert!(config.path().join(LIBRARY_FILE).is_file());

        let again = Library::load(Some(config.path()), Some(home.path()), 9);
        assert_eq!(again.infos(), infos, "the saved list is read back");
    }

    #[test]
    fn a_list_left_empty_stays_empty() {
        let config = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        fs::write(config.path().join(LIBRARY_FILE), r#"{"folders":[]}"#).unwrap();

        let library = Library::load(Some(config.path()), Some(home.path()), 1);
        assert!(library.infos().is_empty());
        assert!(
            !home.path().join("Konspecter").exists(),
            "the default folder is not made again"
        );
    }

    #[test]
    fn moves_the_folder_of_an_earlier_version_into_the_list() {
        let config = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        let chosen = tempfile::tempdir().unwrap();
        let old = config.path().join(OLD_FOLDER_FILE);
        fs::write(
            &old,
            serde_json::json!({ "path": chosen.path() }).to_string(),
        )
        .unwrap();

        let library = Library::load(Some(config.path()), Some(home.path()), 1);
        let infos = library.infos();
        assert_eq!(infos.len(), 1);
        assert_eq!(
            infos[0].path,
            open(chosen.path()).root().display().to_string()
        );
        assert!(!old.exists(), "the old file goes");
        assert!(!home.path().join("Konspecter").exists());
    }

    #[test]
    fn keeps_an_old_folder_that_cannot_be_opened_now() {
        let config = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        fs::write(
            config.path().join(OLD_FOLDER_FILE),
            r#"{"path":"/Volumes/Backup/Notes"}"#,
        )
        .unwrap();

        let library = Library::load(Some(config.path()), Some(home.path()), 1);
        assert_eq!(
            library.infos(),
            [FolderInfo {
                id: folder_id("/Volumes/Backup/Notes"),
                path: "/Volumes/Backup/Notes".into(),
                alias: None,
                added_ms: 1,
                available: false,
            }]
        );
        assert!(
            !home.path().join("Konspecter").exists(),
            "the default does not take its place"
        );
        let again = Library::load(Some(config.path()), Some(home.path()), 2);
        assert_eq!(again.infos(), library.infos(), "and it stays");
    }

    #[test]
    fn puts_an_unreadable_list_aside() {
        let config = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        fs::write(config.path().join(LIBRARY_FILE), r#"{"folders":[{"pa"#).unwrap();

        let library = Library::load(Some(config.path()), Some(home.path()), 1);
        assert_eq!(library.infos().len(), 1, "a first start");
        assert_eq!(
            fs::read_to_string(config.path().join(UNREADABLE_FILE)).unwrap(),
            r#"{"folders":[{"pa"#
        );
    }

    #[test]
    fn saves_without_leaving_a_temporary_file() {
        let (config, mut library) = library();
        let a = tempfile::tempdir().unwrap();
        library.add(open(a.path()), 1).unwrap();
        library.save().unwrap();
        library.save().unwrap();

        let names: Vec<_> = fs::read_dir(config.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, [LIBRARY_FILE]);
    }

    #[test]
    fn keeps_a_folder_that_cannot_be_opened() {
        let config = tempfile::tempdir().unwrap();
        let saved = SavedList {
            folders: vec![SavedFolder {
                path: "/no/such/folder".into(),
                alias: Some("Archive".into()),
                added_ms: 3,
            }],
        };
        fs::write(
            config.path().join(LIBRARY_FILE),
            serde_json::to_string(&saved).unwrap(),
        )
        .unwrap();

        let library = Library::load(Some(config.path()), None, 1);
        let infos = library.infos();
        assert_eq!(infos.len(), 1);
        assert!(!infos[0].available);
        assert_eq!(infos[0].alias.as_deref(), Some("Archive"));
        assert!(library.get(&infos[0].id).is_none());
        assert!(library.open_folders().is_empty());
    }

    #[test]
    fn adds_folders_in_order_and_refuses_overlaps() {
        let (_config, mut library) = library();
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        fs::create_dir(a.path().join("inner")).unwrap();

        let first = library.add(open(a.path()), 5).unwrap();
        assert_eq!(first.added_ms, 5);
        let second = library.add(open(b.path()), 6).unwrap();
        assert_eq!(
            library.infos().iter().map(|i| &i.id).collect::<Vec<_>>(),
            [&first.id, &second.id]
        );
        assert!(library.get(&first.id).is_some());

        assert_eq!(library.add(open(a.path()), 7), Err(LibraryError::Connected));
        assert_eq!(
            library.add(open(&a.path().join("inner")), 7),
            Err(LibraryError::Overlaps)
        );
        let parent = a.path().parent().unwrap();
        assert_eq!(library.add(open(parent), 7), Err(LibraryError::Overlaps));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_different_case_is_the_same_folder_on_macos() {
        let (_config, mut library) = library();
        let home = tempfile::tempdir().unwrap();
        fs::create_dir_all(home.path().join("Notes/Inner")).unwrap();
        library.add(open(&home.path().join("Notes")), 1).unwrap();

        let upper = home.path().join("NOTES");
        if let Ok(folder) = Folder::open(&upper) {
            let result = library.add(folder, 2);
            assert!(result.is_err(), "{result:?}");
        }
        if let Ok(folder) = Folder::open(&home.path().join("NOTES/Inner")) {
            assert_eq!(library.add(folder, 2), Err(LibraryError::Overlaps));
        }
    }

    #[test]
    fn removing_a_folder_leaves_its_files() {
        let (config, mut library) = library();
        let a = tempfile::tempdir().unwrap();
        fs::write(a.path().join("kept.md"), "# Kept").unwrap();
        let info = library.add(open(a.path()), 1).unwrap();
        library.save().unwrap();

        library.remove(&info.id).unwrap();
        library.save().unwrap();
        assert!(library.infos().is_empty());
        assert!(a.path().join("kept.md").is_file());
        assert_eq!(library.remove(&info.id), Err(LibraryError::Unknown));

        let again = Library::load(Some(config.path()), None, 1);
        assert!(again.infos().is_empty());
        let mut again = again;
        assert_eq!(
            again.add(open(a.path()), 2).unwrap().id,
            info.id,
            "connected again, the folder keeps its id"
        );
    }

    #[test]
    fn aliases_are_trimmed_and_limited() {
        let (_config, mut library) = library();
        let a = tempfile::tempdir().unwrap();
        let id = library.add(open(a.path()), 1).unwrap().id;

        library.set_alias(&id, Some("  Work  ")).unwrap();
        assert_eq!(library.infos()[0].alias.as_deref(), Some("Work"));
        library.set_alias(&id, Some("   ")).unwrap();
        assert_eq!(library.infos()[0].alias, None);
        library.set_alias(&id, Some("Work")).unwrap();
        library.set_alias(&id, None).unwrap();
        assert_eq!(library.infos()[0].alias, None);

        let long = "x".repeat(MAX_ALIAS + 1);
        assert_eq!(
            library.set_alias(&id, Some(&long)),
            Err(LibraryError::InvalidAlias)
        );
        assert_eq!(
            library.set_alias("nope", Some("x")),
            Err(LibraryError::Unknown)
        );
    }

    #[test]
    fn reset_forgets_the_list_but_not_the_files() {
        let (config, mut library) = library();
        let a = tempfile::tempdir().unwrap();
        fs::write(a.path().join("kept.md"), "# Kept").unwrap();
        library.add(open(a.path()), 1).unwrap();
        library.save().unwrap();

        library.reset().unwrap();
        assert!(library.infos().is_empty());
        assert!(!config.path().join(LIBRARY_FILE).exists());
        assert!(a.path().join("kept.md").is_file());
        library.reset().unwrap();
    }
}
