//! Konspecter's desktop shell. The whole UI is the shared web app; this crate
//! only hosts it and provides the native commands the web app calls through
//! its desktop bridge (`apps/web/src/infrastructure/desktop/`).

mod folder;
mod log;

use folder::{Changed, FileContents, FileEntry, Folder, FolderError};
use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};
use serde::{Deserialize, Serialize};
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

fn no_folder() -> CommandError {
    CommandError {
        code: "no_folder",
        message: "no Markdown folder is open".into(),
    }
}

/// The open folder. Only the native folder picker can set it, so the web app
/// can never point file access at an arbitrary location.
#[derive(Default)]
struct FolderState(Mutex<Option<Folder>>);

/// Watches the open folder; dropping it stops watching.
#[derive(Default)]
struct WatchState(Mutex<Option<Debouncer<RecommendedWatcher>>>);

/// Sent to the web app as the `folder-changed` event.
#[derive(Clone, Serialize, Debug, PartialEq)]
struct FolderChanged {
    /// Markdown files (relative paths) that were created, changed or removed.
    paths: Vec<String>,
    /// Read the whole folder again: the watcher saw something it cannot map to files.
    rescan: bool,
}

/// What a batch of changed paths means for the web app, or nothing to report.
fn summarize(folder: &Folder, changed: impl IntoIterator<Item = PathBuf>) -> Option<FolderChanged> {
    let mut paths = Vec::new();
    let mut rescan = false;
    for path in changed {
        match folder.classify(&path) {
            Changed::File(relative) if !paths.contains(&relative) => paths.push(relative),
            Changed::Rescan => rescan = true,
            _ => {}
        }
    }
    (rescan || !paths.is_empty()).then_some(FolderChanged { paths, rescan })
}

/// Starts watching `folder`, replacing any previous watcher. Changes are
/// debounced so a burst of writes (an editor saving) arrives as one event.
fn watch(app: &AppHandle, folder: Option<&Folder>) {
    let state = app.state::<WatchState>();
    let Ok(mut current) = state.0.lock() else {
        return;
    };
    *current = None; // Stops the previous watcher.
    let Some(folder) = folder.cloned() else {
        return;
    };

    let handle = app.clone();
    let watched = folder.clone();
    let debouncer = new_debouncer(
        Duration::from_millis(300),
        move |result: DebounceEventResult| {
            let change = match result {
                Ok(events) => summarize(&watched, events.into_iter().map(|event| event.path)),
                Err(_) => Some(FolderChanged {
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
                *current = Some(debouncer);
            }
        }
        Err(error) => eprintln!("could not watch {}: {error}", folder.root().display()),
    }
}

impl FolderState {
    fn with<T>(
        &self,
        f: impl FnOnce(&Folder) -> Result<T, FolderError>,
    ) -> Result<T, CommandError> {
        let guard = self.0.lock().map_err(|_| no_folder())?;
        let folder = guard.as_ref().ok_or_else(no_folder)?;
        f(folder).map_err(CommandError::from)
    }

    fn set(&self, folder: Option<Folder>) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = folder;
        }
    }
}

fn saved_folder_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("folder.json"))
}

fn save_folder(app: &AppHandle, folder: Option<&Folder>) {
    let Some(file) = saved_folder_file(app) else {
        return;
    };
    match folder {
        Some(folder) => {
            if let Some(dir) = file.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let json = serde_json::json!({ "path": folder.root() });
            let _ = std::fs::write(file, json.to_string());
        }
        None => {
            let _ = std::fs::remove_file(file);
        }
    }
}

fn load_folder(app: &AppHandle) -> Option<Folder> {
    let text = std::fs::read_to_string(saved_folder_file(app)?).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    Folder::open(std::path::Path::new(json.get("path")?.as_str()?)).ok()
}

/// The open folder's absolute path, if any.
#[tauri::command]
fn folder_current(state: State<'_, FolderState>) -> Option<String> {
    let guard = state.0.lock().ok()?;
    guard.as_ref().map(|f| f.root().display().to_string())
}

/// Lets the user pick a folder with the system dialog and opens it.
#[tauri::command]
async fn folder_pick(
    app: AppHandle,
    state: State<'_, FolderState>,
) -> Result<Option<String>, CommandError> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Choose a folder of Markdown conspects")
        .blocking_pick_folder()
    else {
        return Ok(None); // Cancelled.
    };
    let path = picked.into_path().map_err(|e| CommandError {
        code: "invalid_path",
        message: e.to_string(),
    })?;
    let folder = Folder::open(&path)?;
    let root = folder.root().display().to_string();
    save_folder(&app, Some(&folder));
    watch(&app, Some(&folder));
    state.set(Some(folder));
    Ok(Some(root))
}

/// Stops using the folder. The files are not touched.
#[tauri::command]
fn folder_close(app: AppHandle, state: State<'_, FolderState>) {
    save_folder(&app, None);
    watch(&app, None);
    state.set(None);
}

#[tauri::command]
fn folder_list(state: State<'_, FolderState>) -> Result<Vec<FileEntry>, CommandError> {
    state.with(Folder::list)
}

#[tauri::command]
fn folder_read(state: State<'_, FolderState>, path: String) -> Result<FileContents, CommandError> {
    state.with(|f| f.read(&path))
}

#[tauri::command]
fn folder_write(
    state: State<'_, FolderState>,
    path: String,
    contents: String,
) -> Result<FileEntry, CommandError> {
    state.with(|f| f.write(&path, &contents))
}

#[tauri::command]
fn folder_create_at(
    state: State<'_, FolderState>,
    path: String,
    contents: String,
) -> Result<FileEntry, CommandError> {
    state.with(|f| f.create_at(&path, &contents))
}

#[tauri::command]
fn folder_rename(
    state: State<'_, FolderState>,
    from: String,
    to: String,
) -> Result<FileEntry, CommandError> {
    state.with(|f| f.rename(&from, &to))
}

#[tauri::command]
fn folder_open_external(state: State<'_, FolderState>, path: String) -> Result<(), CommandError> {
    state.with(|f| f.open_external(&path))
}

#[tauri::command]
fn folder_reveal(state: State<'_, FolderState>, path: String) -> Result<(), CommandError> {
    state.with(|f| f.reveal(&path))
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
fn folder_trash(state: State<'_, FolderState>, path: String) -> Result<(), CommandError> {
    state.with(|f| f.trash(&path))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(FolderState::default())
        .manage(WatchState::default())
        .setup(|app| {
            let folder = load_folder(app.handle());
            watch(app.handle(), folder.as_ref());
            app.state::<FolderState>().set(folder);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            folder_current,
            folder_pick,
            folder_close,
            folder_list,
            folder_read,
            folder_write,
            folder_create_at,
            folder_rename,
            folder_trash,
            folder_open_external,
            folder_reveal,
            export_to_folder,
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
            &folder,
            [root.join("a.md"), root.join("a.md"), root.join(".tmp")],
        );
        assert_eq!(
            change,
            Some(FolderChanged {
                paths: vec!["a.md".into()],
                rescan: false
            })
        );
        assert_eq!(summarize(&folder, [root.join("x.png")]), None);
        assert_eq!(
            summarize(&folder, [root.join("moved-dir")]),
            Some(FolderChanged {
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
                    && let Some(change) = summarize(&watched, events.into_iter().map(|e| e.path))
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
    fn folder_errors_carry_a_code() {
        let error = CommandError::from(FolderError::NotFound("a.md".into()));
        assert_eq!(error.code, "not_found");
        assert_eq!(error.message, "a.md does not exist");
    }
}
