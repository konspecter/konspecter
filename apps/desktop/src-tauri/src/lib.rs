//! Konspecter's desktop shell. The whole UI is the shared web app; this crate
//! only hosts it and provides the native commands the web app calls through
//! its desktop bridge (`apps/web/src/infrastructure/desktop/`).

mod folder;
mod library;
mod log;

use folder::{Changed, FileContents, FileEntry, Folder, FolderError};
use library::{FolderInfo, Library, LibraryError};
use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Describes the running desktop app. The web app shows it in Settings.
#[derive(Debug, Serialize, PartialEq)]
pub struct AppInfo {
    name: &'static str,
    version: &'static str,
    os: &'static str,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "Konspecter",
        version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
    }
}

/// Errors as the web app receives them: `{ code, message }`.
#[derive(Debug, Serialize)]
struct CommandError {
    code: &'static str,
    message: String,
}

impl From<FolderError> for CommandError {
    fn from(error: FolderError) -> Self {
        CommandError {
            code: error.code(),
            message: error.to_string(),
        }
    }
}

impl From<LibraryError> for CommandError {
    fn from(error: LibraryError) -> Self {
        CommandError {
            code: error.code(),
            message: error.message().into(),
        }
    }
}

fn io_error(error: impl std::fmt::Display) -> CommandError {
    CommandError {
        code: "io",
        message: error.to_string(),
    }
}

/// The connected folders. Only the native folder picker adds one, so the web
/// app can never point file access at an arbitrary location: it names a
/// folder by its id and a file by its path inside it.
#[derive(Default)]
struct LibraryState(Mutex<Library>);

/// Watches each open folder, by id; dropping a watcher stops it.
#[derive(Default)]
struct WatchState(Mutex<HashMap<String, Debouncer<RecommendedWatcher>>>);

/// Sent to the web app as the `folder-changed` event.
#[derive(Clone, Serialize, Debug, PartialEq)]
struct FolderChanged {
    /// The folder's id.
    folder: String,
    /// Markdown files (relative paths) that were created, changed or removed.
    paths: Vec<String>,
    /// Read the whole folder again: the watcher saw something it cannot map to files.
    rescan: bool,
}

/// What a batch of changed paths means for the web app, or nothing to report.
fn summarize(
    id: &str,
    folder: &Folder,
    changed: impl IntoIterator<Item = PathBuf>,
) -> Option<FolderChanged> {
    let mut paths = Vec::new();
    let mut rescan = false;
    for path in changed {
        match folder.classify(&path) {
            Changed::File(relative) if !paths.contains(&relative) => paths.push(relative),
            Changed::Rescan => rescan = true,
            _ => {}
        }
    }
    (rescan || !paths.is_empty()).then_some(FolderChanged {
        folder: id.to_string(),
        paths,
        rescan,
    })
}

/// Starts watching a folder, replacing its previous watcher. Changes are
/// debounced so a burst of writes (an editor saving) arrives as one event.
fn watch(app: &AppHandle, id: &str, folder: &Folder) {
    let state = app.state::<WatchState>();
    let Ok(mut watchers) = state.0.lock() else {
        return;
    };
    watchers.remove(id); // Stops the previous watcher.

    let handle = app.clone();
    let watched = folder.clone();
    let watched_id = id.to_string();
    let debouncer = new_debouncer(
        Duration::from_millis(300),
        move |result: DebounceEventResult| {
            let change = match result {
                Ok(events) => summarize(
                    &watched_id,
                    &watched,
                    events.into_iter().map(|event| event.path),
                ),
                Err(_) => Some(FolderChanged {
                    folder: watched_id.clone(),
                    paths: Vec::new(),
                    rescan: true,
                }),
            };
            if let Some(change) = change {
                let _ = handle.emit("folder-changed", change);
            }
        },
    );
    match debouncer {
        Ok(mut debouncer) => {
            if debouncer
                .watcher()
                .watch(folder.root(), RecursiveMode::Recursive)
                .is_ok()
            {
                watchers.insert(id.to_string(), debouncer);
            }
        }
        Err(error) => eprintln!("could not watch {}: {error}", folder.root().display()),
    }
}

fn unwatch(app: &AppHandle, id: Option<&str>) {
    if let Ok(mut watchers) = app.state::<WatchState>().0.lock() {
        match id {
            Some(id) => {
                watchers.remove(id);
            }
            None => watchers.clear(),
        }
    }
}

impl LibraryState {
    /// Runs `f` on the open folder with this id. The folder is cloned out of
    /// the lock (clones share their rules), so file work never holds it.
    fn with<T>(
        &self,
        id: &str,
        f: impl FnOnce(&Folder) -> Result<T, FolderError>,
    ) -> Result<T, CommandError> {
        let folder = {
            let library = self.0.lock().map_err(|_| no_folder())?;
            library.get(id).cloned().ok_or_else(no_folder)?
        };
        f(&folder).map_err(CommandError::from)
    }

    fn change<T>(
        &self,
        f: impl FnOnce(&mut Library) -> Result<T, LibraryError>,
    ) -> Result<T, CommandError> {
        // Changed and saved as a copy, taken only once it is saved: a list
        // that cannot be written leaves the app as it was.
        let mut library = self.0.lock().map_err(|_| no_folder())?;
        let mut next = library.clone();
        let result = f(&mut next)?;
        next.save().map_err(io_error)?;
        *library = next;
        Ok(result)
    }
}

fn no_folder() -> CommandError {
    LibraryError::Unknown.into()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The connected folders, in order.
#[tauri::command]
fn folders_list(state: State<'_, LibraryState>) -> Vec<FolderInfo> {
    state.0.lock().map(|l| l.infos()).unwrap_or_default()
}

/// Lets the user pick a folder with the system dialog and connects it.
/// `None` when the dialog was cancelled.
#[tauri::command]
async fn folder_add(
    app: AppHandle,
    state: State<'_, LibraryState>,
) -> Result<Option<FolderInfo>, CommandError> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Add a folder of Markdown conspects");
    if let Ok(home) = app.path().home_dir() {
        dialog = dialog.set_directory(home);
    }
    // The dialog waits for the user; the library is not locked meanwhile.
    let Some(picked) = dialog.blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| CommandError {
        code: "invalid_path",
        message: e.to_string(),
    })?;
    let folder = Folder::open(&path)?;
    let info = state.change(|library| library.add(folder.clone(), now_ms()))?;
    watch(&app, &info.id, &folder);
    Ok(Some(info))
}

/// Disconnects a folder. Its files stay where they are.
#[tauri::command]
fn folder_remove(
    app: AppHandle,
    state: State<'_, LibraryState>,
    folder: String,
) -> Result<(), CommandError> {
    state.change(|library| library.remove(&folder))?;
    unwatch(&app, Some(&folder));
    Ok(())
}

#[tauri::command]
fn folder_set_alias(
    state: State<'_, LibraryState>,
    folder: String,
    alias: Option<String>,
) -> Result<(), CommandError> {
    state.change(|library| library.set_alias(&folder, alias.as_deref()))
}

/// Opens the folder itself in the system file manager.
#[tauri::command]
fn folder_reveal_root(state: State<'_, LibraryState>, folder: String) -> Result<(), CommandError> {
    state.with(&folder, Folder::reveal_root)
}

/// Forgets every folder: the next start is a first start. No file is touched.
#[tauri::command]
fn folders_reset(app: AppHandle, state: State<'_, LibraryState>) -> Result<(), CommandError> {
    unwatch(&app, None);
    let mut library = state.0.lock().map_err(|_| no_folder())?;
    library.reset().map_err(io_error)
}

#[tauri::command]
fn folder_list(
    state: State<'_, LibraryState>,
    folder: String,
) -> Result<Vec<FileEntry>, CommandError> {
    state.with(&folder, Folder::list)
}

/// The folder's ignore rules (`.konspecterignore`, or the default).
#[tauri::command]
fn folder_ignore_read(
    state: State<'_, LibraryState>,
    folder: String,
) -> Result<String, CommandError> {
    state.with(&folder, Folder::ignore_text)
}

/// Writes the folder's `.konspecterignore`; listing and watching follow it at once.
#[tauri::command]
fn folder_ignore_write(
    state: State<'_, LibraryState>,
    folder: String,
    text: String,
) -> Result<(), CommandError> {
    state.with(&folder, |f| f.write_ignore(&text))
}

#[tauri::command]
fn folder_read(
    state: State<'_, LibraryState>,
    folder: String,
    path: String,
) -> Result<FileContents, CommandError> {
    state.with(&folder, |f| f.read(&path))
}

#[tauri::command]
fn folder_write(
    state: State<'_, LibraryState>,
    folder: String,
    path: String,
    contents: String,
) -> Result<FileEntry, CommandError> {
    state.with(&folder, |f| f.write(&path, &contents))
}

#[tauri::command]
fn folder_create_at(
    state: State<'_, LibraryState>,
    folder: String,
    path: String,
    contents: String,
) -> Result<FileEntry, CommandError> {
    state.with(&folder, |f| f.create_at(&path, &contents))
}

#[tauri::command]
fn folder_rename(
    state: State<'_, LibraryState>,
    folder: String,
    from: String,
    to: String,
) -> Result<FileEntry, CommandError> {
    state.with(&folder, |f| f.rename(&from, &to))
}

#[tauri::command]
fn folder_open_external(
    state: State<'_, LibraryState>,
    folder: String,
    path: String,
) -> Result<(), CommandError> {
    state.with(&folder, |f| f.open_external(&path))
}

#[tauri::command]
fn folder_reveal(
    state: State<'_, LibraryState>,
    folder: String,
    path: String,
) -> Result<(), CommandError> {
    state.with(&folder, |f| f.reveal(&path))
}

/// Opens a web page in the system browser: signing in to sync approves this
/// device on the account site. Only http(s) addresses are opened.
#[tauri::command]
fn open_url(url: String) -> Result<(), CommandError> {
    if !is_web_url(&url) {
        return Err(CommandError {
            code: "invalid_url",
            message: "only http and https addresses can be opened".into(),
        });
    }
    open::that_detached(&url).map_err(|e| CommandError {
        code: "io",
        message: format!("open the browser: {e}"),
    })
}

fn is_web_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://"))
        && !url.chars().any(char::is_control)
}

#[derive(Debug, Deserialize)]
struct ExportFile {
    title: String,
    contents: String,
}

#[derive(Debug, Serialize)]
struct ExportResult {
    folder: String,
    written: usize,
}

/// Lets the user pick a folder and writes the notes into it as `.md` files
/// named after their titles. Existing files are never overwritten.
#[tauri::command]
async fn export_to_folder(
    app: AppHandle,
    files: Vec<ExportFile>,
) -> Result<Option<ExportResult>, CommandError> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Export conspects to a folder")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| CommandError {
        code: "invalid_path",
        message: e.to_string(),
    })?;
    let folder = Folder::open(&path)?;
    for file in &files {
        folder.create(&file.title, &file.contents)?;
    }
    Ok(Some(ExportResult {
        folder: folder.root().display().to_string(),
        written: files.len(),
    }))
}

/// The sync token lives in the operating system's credential store (macOS
/// Keychain, Windows Credential Manager, Secret Service on Linux), not in the
/// web view's storage. The entry is fixed: the web app cannot name others.
const CREDENTIAL_SERVICE: &str = "app.konspecter.desktop";
const CREDENTIAL_ACCOUNT: &str = "sync-token";

fn credential_entry() -> Result<keyring::Entry, CommandError> {
    keyring::Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT).map_err(credential_error)
}

fn credential_error(error: keyring::Error) -> CommandError {
    CommandError {
        code: "credentials",
        message: format!("credential store: {error}"),
    }
}

#[tauri::command]
fn credential_get() -> Result<Option<String>, CommandError> {
    match credential_entry()?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(credential_error(error)),
    }
}

#[tauri::command]
fn credential_set(secret: String) -> Result<(), CommandError> {
    credential_entry()?
        .set_password(&secret)
        .map_err(credential_error)
}

#[tauri::command]
fn credential_delete() -> Result<(), CommandError> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(credential_error(error)),
    }
}

/// Appends an entry to `konspecter.log` in the platform's log directory
/// (macOS: `~/Library/Logs/<identifier>/`, shown by Console.app).
#[tauri::command]
fn log_error(app: AppHandle, entry: String) -> Result<(), CommandError> {
    let dir = app.path().app_log_dir().map_err(|error| CommandError {
        code: "io",
        message: error.to_string(),
    })?;
    log::append(&dir, &entry).map_err(|error| CommandError {
        code: "io",
        message: error.to_string(),
    })
}

#[tauri::command]
fn folder_trash(
    state: State<'_, LibraryState>,
    folder: String,
    path: String,
) -> Result<(), CommandError> {
    state.with(&folder, |f| f.trash(&path))
}

#[tauri::command]
fn folder_delete(
    state: State<'_, LibraryState>,
    folder: String,
    path: String,
) -> Result<(), CommandError> {
    state.with(&folder, |f| f.delete(&path))
}

#[tauri::command]
fn folder_remove_empty_dir(
    state: State<'_, LibraryState>,
    folder: String,
    path: String,
) -> Result<(), CommandError> {
    state.with(&folder, |f| f.remove_empty_dir(&path))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(LibraryState::default())
        .manage(WatchState::default())
        .setup(|app| {
            let config = app.path().app_config_dir().ok();
            let home = app.path().home_dir().ok();
            let library = Library::load(config.as_deref(), home.as_deref(), now_ms());
            for (id, folder) in library.open_folders() {
                watch(app.handle(), &id, &folder);
            }
            if let Ok(mut state) = app.state::<LibraryState>().0.lock() {
                *state = library;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            folders_list,
            folder_add,
            folder_remove,
            folder_set_alias,
            folder_reveal_root,
            folders_reset,
            folder_list,
            folder_ignore_read,
            folder_ignore_write,
            folder_read,
            folder_write,
            folder_create_at,
            folder_rename,
            folder_trash,
            folder_delete,
            folder_remove_empty_dir,
            folder_open_external,
            folder_reveal,
            export_to_folder,
            open_url,
            credential_get,
            credential_set,
            credential_delete,
            log_error,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Konspecter desktop app");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_web_addresses() {
        assert!(is_web_url(
            "https://notes.example.com/activate?code=BCDF-GHJK"
        ));
        assert!(is_web_url("HTTP://localhost:5174/activate"));
        assert!(!is_web_url("file:///etc/passwd"));
        assert!(!is_web_url("javascript:alert(1)"));
        assert!(!is_web_url("https://example.com/\nrm -rf"));
        assert!(!is_web_url("https://example.com/\u{0}"));
    }

    #[test]
    fn app_info_reports_the_package_version() {
        let info = app_info();
        assert_eq!(info.name, "Konspecter");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert!(!info.os.is_empty());
    }

    #[test]
    fn summarizes_watcher_batches() {
        let dir = tempfile::tempdir().unwrap();
        let folder = Folder::open(dir.path()).unwrap();
        let root = folder.root().to_path_buf();

        let change = summarize(
            "f1",
            &folder,
            [root.join("a.md"), root.join("a.md"), root.join(".tmp")],
        );
        assert_eq!(
            change,
            Some(FolderChanged {
                folder: "f1".into(),
                paths: vec!["a.md".into()],
                rescan: false
            })
        );
        assert_eq!(summarize("f1", &folder, [root.join("x.png")]), None);
        assert_eq!(
            summarize("f1", &folder, [root.join("moved-dir")]),
            Some(FolderChanged {
                folder: "f1".into(),
                paths: vec![],
                rescan: true
            })
        );
    }

    #[test]
    fn watcher_reports_changes_made_by_other_programs() {
        let dir = tempfile::tempdir().unwrap();
        let folder = Folder::open(dir.path()).unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        let watched = folder.clone();
        let mut debouncer = new_debouncer(
            Duration::from_millis(100),
            move |result: DebounceEventResult| {
                if let Ok(events) = result
                    && let Some(change) =
                        summarize("f1", &watched, events.into_iter().map(|e| e.path))
                {
                    let _ = sender.send(change);
                }
            },
        )
        .unwrap();
        debouncer
            .watcher()
            .watch(folder.root(), RecursiveMode::Recursive)
            .unwrap();
        std::thread::sleep(Duration::from_millis(200));

        std::fs::write(folder.root().join("from-vim.md"), "# Hi").unwrap();

        let change = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("no watcher event");
        assert!(
            change.paths.contains(&"from-vim.md".to_string()) || change.rescan,
            "{change:?}"
        );
    }

    #[test]
    fn a_list_that_cannot_be_saved_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        // The config "folder" is a file: nothing can be written under it.
        let blocker = dir.path().join("config");
        std::fs::write(&blocker, "").unwrap();
        let state = LibraryState(Mutex::new(Library::at(Some(blocker.join("folders.json")))));
        let folder = Folder::open(dir.path()).unwrap();

        let result = state.change(|library| library.add(folder, 1));

        assert_eq!(result.map(|_| ()).map_err(|e| e.code), Err("io"));
        assert!(state.0.lock().unwrap().infos().is_empty());
    }

    #[test]
    fn folder_errors_carry_a_code() {
        let error = CommandError::from(FolderError::NotFound("a.md".into()));
        assert_eq!(error.code, "not_found");
        assert_eq!(error.message, "a.md does not exist");
    }
}
