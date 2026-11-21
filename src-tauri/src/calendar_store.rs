//! Saving the Calendar's entries to a file in the app's data folder.
//!
//! The entries are the only copy the user has, so every write is careful:
//! - A save writes a temporary file first and only then swaps it into place, so a crash or a
//!   power cut can never leave a half-written data file.
//! - The previous good version is kept as `calendar.json.bak`, and loading falls back to it if
//!   the main file is ever missing or damaged.
//! - Importing a backup first keeps a copy of what was there (`calendar.before-import.json`).
//!
//! The text is opaque here apart from one check: it must be a JSON object with an `entries`
//! list, so junk can never replace real data.

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

const MAIN: &str = "calendar.json";
const BACKUP: &str = "calendar.json.bak";
const TEMP: &str = "calendar.json.tmp";
const BEFORE_IMPORT: &str = "calendar.before-import.json";
const EMPTY: &str = "{\n  \"version\": 1,\n  \"entries\": []\n}";

/// True if `text` is a JSON object with an `entries` array (the Calendar file shape).
pub fn is_calendar_json(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .map_or(false, |v| v.get("entries").map_or(false, |e| e.is_array()))
}

fn read_valid(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    is_calendar_json(&text).then_some(text)
}

/// Write `contents` to `path` so that readers see either the old file or the new one, never a mix.
fn write_atomic(path: &Path, temp: &Path, contents: &str) -> Result<(), String> {
    let mut file = fs::File::create(temp).map_err(|e| format!("could not create {}: {e}", temp.display()))?;
    file.write_all(contents.as_bytes()).map_err(|e| format!("could not write {}: {e}", temp.display()))?;
    file.sync_all().map_err(|e| format!("could not flush {}: {e}", temp.display()))?;
    drop(file);
    fs::rename(temp, path).map_err(|e| {
        let _ = fs::remove_file(temp);
        format!("could not replace {}: {e}", path.display())
    })
}

/// Save the entries. Keeps the previous good version as the backup.
pub fn save(dir: &Path, contents: &str) -> Result<(), String> {
    if !is_calendar_json(contents) {
        return Err("refusing to save: that is not Calendar data".into());
    }
    fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let main = dir.join(MAIN);
    // Only a good file becomes the backup, so a damaged main file can't overwrite a good backup.
    if read_valid(&main).is_some() {
        fs::copy(&main, dir.join(BACKUP)).map_err(|e| format!("could not keep a backup: {e}"))?;
    }
    write_atomic(&main, &dir.join(TEMP), contents)
}

/// The saved entries: the main file, else the backup, else `None` (nothing saved yet).
pub fn load(dir: &Path) -> Option<String> {
    read_valid(&dir.join(MAIN)).or_else(|| read_valid(&dir.join(BACKUP)))
}

/// Write the current entries (or an empty calendar) to a file the user chose.
pub fn export_to(dir: &Path, dest: &Path) -> Result<(), String> {
    let text = load(dir).unwrap_or_else(|| EMPTY.to_string());
    let mut temp = dest.as_os_str().to_owned();
    temp.push(".tmp");
    write_atomic(dest, &PathBuf::from(temp), &text)
}

/// Read a backup file the user chose. Keeps a copy of the current data first, so the import
/// can be undone, and returns the file's text for the app to check and apply.
pub fn import_from(dir: &Path, src: &Path) -> Result<String, String> {
    let text = fs::read_to_string(src).map_err(|e| format!("could not read that file: {e}"))?;
    if !is_calendar_json(&text) {
        return Err("That file isn't a Calendar backup.".into());
    }
    if let Some(current) = load(dir) {
        fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
        write_atomic(&dir.join(BEFORE_IMPORT), &dir.join(TEMP), &current)?;
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A fresh empty folder under the system temp directory, removed on drop.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            static N: AtomicU32 = AtomicU32::new(0);
            let path = std::env::temp_dir().join(format!("widgets-calendar-test-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
            let _ = fs::remove_dir_all(&path);
            TempDir(path)
        }
        fn path(&self) -> &Path { &self.0 }
    }
    impl Drop for TempDir {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    fn doc(titles: &[&str]) -> String {
        let entries: Vec<String> = titles.iter().map(|t| format!("{{\"title\":\"{t}\"}}")).collect();
        format!("{{\"version\":1,\"entries\":[{}]}}", entries.join(","))
    }

    #[test]
    fn nothing_saved_yet_loads_as_none() {
        let d = TempDir::new();
        assert_eq!(load(d.path()), None);
        fs::create_dir_all(d.path()).unwrap();
        assert_eq!(load(d.path()), None);
    }

    #[test]
    fn save_then_load_round_trips() {
        let d = TempDir::new();
        save(d.path(), &doc(&["a", "b"])).unwrap();
        assert_eq!(load(d.path()).unwrap(), doc(&["a", "b"]));
    }

    #[test]
    fn the_folder_is_created_on_first_save() {
        let d = TempDir::new();
        let nested = d.path().join("deep").join("er");
        save(&nested, &doc(&[])).unwrap();
        assert!(nested.join(MAIN).exists());
    }

    #[test]
    fn a_second_save_keeps_the_previous_version_as_the_backup() {
        let d = TempDir::new();
        save(d.path(), &doc(&["first"])).unwrap();
        assert!(!d.path().join(BACKUP).exists(), "nothing to back up on the first save");
        save(d.path(), &doc(&["second"])).unwrap();
        assert_eq!(fs::read_to_string(d.path().join(BACKUP)).unwrap(), doc(&["first"]));
        assert_eq!(load(d.path()).unwrap(), doc(&["second"]));
    }

    #[test]
    fn a_damaged_main_file_falls_back_to_the_backup() {
        let d = TempDir::new();
        save(d.path(), &doc(&["one"])).unwrap();
        save(d.path(), &doc(&["two"])).unwrap();
        fs::write(d.path().join(MAIN), "{ this is not json").unwrap();
        assert_eq!(load(d.path()).unwrap(), doc(&["one"]), "the last good version, not nothing");
        fs::remove_file(d.path().join(MAIN)).unwrap();
        assert_eq!(load(d.path()).unwrap(), doc(&["one"]), "also when the main file is missing");
    }

    #[test]
    fn saving_over_a_damaged_file_does_not_destroy_the_good_backup() {
        let d = TempDir::new();
        save(d.path(), &doc(&["good"])).unwrap();
        save(d.path(), &doc(&["newer"])).unwrap(); // backup = "good"
        fs::write(d.path().join(MAIN), "garbage").unwrap();
        save(d.path(), &doc(&["after"])).unwrap();
        assert_eq!(fs::read_to_string(d.path().join(BACKUP)).unwrap(), doc(&["good"]), "garbage was not promoted to backup");
        assert_eq!(load(d.path()).unwrap(), doc(&["after"]));
    }

    #[test]
    fn junk_is_never_saved() {
        let d = TempDir::new();
        save(d.path(), &doc(&["keep"])).unwrap();
        for junk in ["", "not json", "[]", "{}", "{\"entries\":3}", "null", "42"] {
            assert!(save(d.path(), junk).is_err(), "{junk:?} must be refused");
        }
        assert_eq!(load(d.path()).unwrap(), doc(&["keep"]));
    }

    #[test]
    fn a_save_that_cannot_complete_leaves_the_existing_data_untouched() {
        let d = TempDir::new();
        save(d.path(), &doc(&["safe"])).unwrap();
        // Make the temporary file impossible to create (a folder is in its place), as a full disk would.
        fs::create_dir(d.path().join(TEMP)).unwrap();
        assert!(save(d.path(), &doc(&["never written"])).is_err());
        assert_eq!(load(d.path()).unwrap(), doc(&["safe"]), "the saved data is exactly as it was");
    }

    #[test]
    fn no_temporary_file_is_left_behind() {
        let d = TempDir::new();
        save(d.path(), &doc(&["a"])).unwrap();
        save(d.path(), &doc(&["b"])).unwrap();
        assert!(!d.path().join(TEMP).exists());
    }

    #[test]
    fn export_writes_the_current_entries_to_the_chosen_file() {
        let d = TempDir::new();
        save(d.path(), &doc(&["x", "y"])).unwrap();
        let dest = d.path().join("my backup.json");
        export_to(d.path(), &dest).unwrap();
        assert_eq!(fs::read_to_string(&dest).unwrap(), doc(&["x", "y"]));
        assert!(!d.path().join("my backup.json.tmp").exists());
    }

    #[test]
    fn exporting_before_anything_is_saved_gives_a_valid_empty_calendar() {
        let d = TempDir::new();
        fs::create_dir_all(d.path()).unwrap();
        let dest = d.path().join("empty.json");
        export_to(d.path(), &dest).unwrap();
        assert!(is_calendar_json(&fs::read_to_string(&dest).unwrap()));
    }

    #[test]
    fn export_into_a_missing_folder_is_a_clear_error() {
        let d = TempDir::new();
        save(d.path(), &doc(&["x"])).unwrap();
        let err = export_to(d.path(), &d.path().join("nope").join("out.json")).unwrap_err();
        assert!(err.contains("could not"), "{err}");
    }

    #[test]
    fn import_keeps_a_copy_of_what_was_there_and_returns_the_file() {
        let d = TempDir::new();
        save(d.path(), &doc(&["mine"])).unwrap();
        let src = d.path().join("incoming.json");
        fs::write(&src, doc(&["theirs"])).unwrap();
        let text = import_from(d.path(), &src).unwrap();
        assert_eq!(text, doc(&["theirs"]));
        assert_eq!(fs::read_to_string(d.path().join(BEFORE_IMPORT)).unwrap(), doc(&["mine"]), "the previous entries are kept");
        assert_eq!(load(d.path()).unwrap(), doc(&["mine"]), "importing alone does not change the saved data");
    }

    #[test]
    fn import_refuses_files_that_are_not_calendar_backups() {
        let d = TempDir::new();
        save(d.path(), &doc(&["mine"])).unwrap();
        let src = d.path().join("bad.json");
        for (name, body) in [("text", "hello"), ("shape", "{\"entries\":\"x\"}"), ("empty", "")] {
            fs::write(&src, body).unwrap();
            assert!(import_from(d.path(), &src).is_err(), "{name}");
        }
        assert!(!d.path().join(BEFORE_IMPORT).exists(), "a refused import leaves no stray copy");
        assert!(import_from(d.path(), &d.path().join("missing.json")).unwrap_err().contains("could not read"));
    }

    #[test]
    fn import_into_a_calendar_with_nothing_saved_yet_works() {
        let d = TempDir::new();
        let src = d.path().join("in.json");
        fs::create_dir_all(d.path()).unwrap();
        fs::write(&src, doc(&["a"])).unwrap();
        assert_eq!(import_from(d.path(), &src).unwrap(), doc(&["a"]));
        assert!(!d.path().join(BEFORE_IMPORT).exists(), "nothing to keep");
    }

    #[test]
    fn unicode_and_large_calendars_survive() {
        let d = TempDir::new();
        let many: Vec<String> = (0..5000).map(|i| format!("\u{1F4C5} Entr\u{00E9}e \u{65E5}\u{672C}\u{8A9E} {i}")).collect();
        let refs: Vec<&str> = many.iter().map(String::as_str).collect();
        save(d.path(), &doc(&refs)).unwrap();
        assert_eq!(load(d.path()).unwrap(), doc(&refs));
    }
}
