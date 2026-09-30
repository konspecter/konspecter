//! The desktop app's log file: errors the interface does not show (it says
//! "Oops, something went wrong." instead) are written here by the web app.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

/// The file is moved aside (one old copy) once it is this large.
const MAX_FILE_BYTES: u64 = 1024 * 1024;
/// A longer entry is cut: the web app cannot fill the disk.
const MAX_ENTRY_BYTES: usize = 16 * 1024;

pub const FILE_NAME: &str = "konspecter.log";

/// Appends `entry` and a line break to the log file in `dir`.
pub fn append(dir: &Path, entry: &str) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let file = dir.join(FILE_NAME);
    if fs::metadata(&file).is_ok_and(|meta| meta.len() >= MAX_FILE_BYTES) {
        fs::rename(&file, dir.join(format!("{FILE_NAME}.old")))?;
    }
    let mut out = OpenOptions::new().create(true).append(true).open(file)?;
    writeln!(out, "{}", truncate(entry.trim_end(), MAX_ENTRY_BYTES))
}

fn truncate(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_entries_as_lines() {
        let dir = tempfile::tempdir().unwrap();
        append(dir.path(), "first\n").unwrap();
        append(dir.path(), "second").unwrap();
        let text = fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert_eq!(text, "first\nsecond\n");
    }

    #[test]
    fn creates_the_directory() {
        let dir = tempfile::tempdir().unwrap();
        let logs = dir.path().join("Logs").join("app");
        append(&logs, "entry").unwrap();
        assert!(logs.join(FILE_NAME).is_file());
    }

    #[test]
    fn keeps_one_old_file_when_full() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        fs::write(&file, "x".repeat(MAX_FILE_BYTES as usize)).unwrap();
        append(dir.path(), "fresh").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "fresh\n");
        let old = dir.path().join(format!("{FILE_NAME}.old"));
        assert_eq!(fs::metadata(old).unwrap().len(), MAX_FILE_BYTES);
    }

    #[test]
    fn cuts_long_entries_at_a_character_boundary() {
        assert_eq!(truncate("ab", 5), "ab");
        assert_eq!(truncate("aé", 2), "a");
        let dir = tempfile::tempdir().unwrap();
        append(dir.path(), &"é".repeat(MAX_ENTRY_BYTES)).unwrap();
        let text = fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert_eq!(text.len(), MAX_ENTRY_BYTES + 1);
    }
}
