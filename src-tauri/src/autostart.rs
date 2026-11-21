//! Start at login, for the current user only.
//!
//! Why this exists instead of the autostart plugin: on Windows the plugin tries the
//! machine-wide Run key (HKLM) first whenever the app has admin rights, and when switched off
//! from a normal session it cannot remove that entry. That left two start-at-login entries
//! (HKLM and HKCU) for the same app, so Windows launched two copies at sign-in.
//!
//! This module only ever reads and writes the current user's registry. The registry sits
//! behind `RunKeyStore` so the rules below can be tested without Windows.
#![cfg_attr(not(windows), allow(dead_code))]

use std::path::Path;

/// `Software\Microsoft\Windows\CurrentVersion\Run`: programs started at sign-in.
#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
/// Where Task Manager's Startup tab records whether an entry is enabled.
#[cfg(windows)]
const APPROVED_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

/// Value Windows treats as "enabled" in the StartupApproved key.
const APPROVED_ENABLED: [u8; 12] = [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/// The two registry locations involved, always for the current user.
pub trait RunKeyStore {
    fn run_value(&self, name: &str) -> Option<String>;
    fn set_run_value(&self, name: &str, value: &str) -> Result<(), String>;
    fn remove_run_value(&self, name: &str) -> Result<(), String>;
    fn approved_value(&self, name: &str) -> Option<Vec<u8>>;
    fn set_approved_value(&self, name: &str, bytes: &[u8]) -> Result<(), String>;
    fn remove_approved_value(&self, name: &str) -> Result<(), String>;
}

/// The command Windows runs at sign-in: the exe path in quotes (it contains spaces).
pub fn run_command(exe: &Path) -> String {
    format!("\"{}\"", exe.display())
}

/// Task Manager marks an entry disabled by changing the leading flag and filling the last
/// 8 bytes with a timestamp, so "enabled" means those last 8 bytes are all zero.
pub fn approved_means_enabled(bytes: &[u8]) -> bool {
    bytes.len() < 8 || bytes[bytes.len() - 8..].iter().all(|b| *b == 0)
}

pub fn is_enabled<S: RunKeyStore>(store: &S, name: &str) -> bool {
    store.run_value(name).is_some()
        && store.approved_value(name).map_or(true, |bytes| approved_means_enabled(&bytes))
}

pub fn enable<S: RunKeyStore>(store: &S, name: &str, exe: &Path) -> Result<(), String> {
    store.set_run_value(name, &run_command(exe))?;
    store.set_approved_value(name, &APPROVED_ENABLED)
}

/// Switching off when nothing is registered is not an error.
pub fn disable<S: RunKeyStore>(store: &S, name: &str) -> Result<(), String> {
    store.remove_run_value(name)?;
    store.remove_approved_value(name)
}

// ---- The real store: HKEY_CURRENT_USER only (there is deliberately no machine-wide one) ----

#[cfg(windows)]
mod win {
    use super::{RunKeyStore, APPROVED_KEY, RUN_KEY};
    use windows_registry::{Type, CURRENT_USER};

    pub struct CurrentUserStore;

    /// ERROR_FILE_NOT_FOUND: nothing was registered, which is fine when removing.
    const NOT_FOUND: u32 = 0x8007_0002;

    fn remove(path: &str, name: &str) -> Result<(), String> {
        match CURRENT_USER.options().write().open(path).and_then(|key| key.remove_value(name)) {
            Ok(()) => Ok(()),
            Err(e) if e.code().0 as u32 == NOT_FOUND => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }

    impl RunKeyStore for CurrentUserStore {
        fn run_value(&self, name: &str) -> Option<String> {
            CURRENT_USER.open(RUN_KEY).and_then(|key| key.get_string(name)).ok()
        }
        fn set_run_value(&self, name: &str, value: &str) -> Result<(), String> {
            CURRENT_USER.create(RUN_KEY).and_then(|key| key.set_string(name, value)).map_err(|e| e.to_string())
        }
        fn remove_run_value(&self, name: &str) -> Result<(), String> {
            remove(RUN_KEY, name)
        }
        fn approved_value(&self, name: &str) -> Option<Vec<u8>> {
            CURRENT_USER.open(APPROVED_KEY).and_then(|key| key.get_value(name)).ok().map(|v| v.to_vec())
        }
        fn set_approved_value(&self, name: &str, bytes: &[u8]) -> Result<(), String> {
            CURRENT_USER
                .create(APPROVED_KEY)
                .and_then(|key| key.set_bytes(name, Type::Bytes, bytes))
                .map_err(|e| e.to_string())
        }
        fn remove_approved_value(&self, name: &str) -> Result<(), String> {
            remove(APPROVED_KEY, name)
        }
    }
}

// ---- What the rest of the app calls ----

#[cfg(windows)]
pub fn is_enabled_for_user(name: &str) -> bool {
    is_enabled(&win::CurrentUserStore, name)
}
#[cfg(windows)]
pub fn enable_for_user(name: &str, exe: &Path) -> Result<(), String> {
    enable(&win::CurrentUserStore, name, exe)
}
#[cfg(windows)]
pub fn disable_for_user(name: &str) -> Result<(), String> {
    disable(&win::CurrentUserStore, name)
}

#[cfg(not(windows))]
pub fn is_enabled_for_user(_name: &str) -> bool {
    false
}
#[cfg(not(windows))]
pub fn enable_for_user(_name: &str, _exe: &Path) -> Result<(), String> {
    Err("start at login is only supported on Windows".into())
}
#[cfg(not(windows))]
pub fn disable_for_user(_name: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::HashMap};

    #[derive(Default)]
    struct Fake {
        run: RefCell<HashMap<String, String>>,
        approved: RefCell<HashMap<String, Vec<u8>>>,
    }
    impl RunKeyStore for Fake {
        fn run_value(&self, n: &str) -> Option<String> { self.run.borrow().get(n).cloned() }
        fn set_run_value(&self, n: &str, v: &str) -> Result<(), String> { self.run.borrow_mut().insert(n.into(), v.into()); Ok(()) }
        fn remove_run_value(&self, n: &str) -> Result<(), String> { self.run.borrow_mut().remove(n); Ok(()) }
        fn approved_value(&self, n: &str) -> Option<Vec<u8>> { self.approved.borrow().get(n).cloned() }
        fn set_approved_value(&self, n: &str, b: &[u8]) -> Result<(), String> { self.approved.borrow_mut().insert(n.into(), b.to_vec()); Ok(()) }
        fn remove_approved_value(&self, n: &str) -> Result<(), String> { self.approved.borrow_mut().remove(n); Ok(()) }
    }

    const NAME: &str = "World Clock";
    fn exe() -> &'static Path { Path::new(r"C:\Program Files\World Clock\windows-widgets.exe") }

    #[test]
    fn enable_registers_a_quoted_command_and_marks_it_enabled() {
        let s = Fake::default();
        assert!(!is_enabled(&s, NAME));
        enable(&s, NAME, exe()).unwrap();
        assert_eq!(s.run_value(NAME).unwrap(), "\"C:\\Program Files\\World Clock\\windows-widgets.exe\"");
        assert_eq!(s.approved_value(NAME).unwrap(), APPROVED_ENABLED);
        assert!(is_enabled(&s, NAME));
    }

    #[test]
    fn disable_removes_everything_and_is_safe_to_repeat() {
        let s = Fake::default();
        enable(&s, NAME, exe()).unwrap();
        disable(&s, NAME).unwrap();
        assert!(!is_enabled(&s, NAME));
        assert!(s.run_value(NAME).is_none() && s.approved_value(NAME).is_none());
        disable(&s, NAME).unwrap(); // nothing registered: still fine
    }

    #[test]
    fn an_entry_turned_off_in_task_manager_counts_as_off_until_enabled_again() {
        let s = Fake::default();
        enable(&s, NAME, exe()).unwrap();
        // Task Manager's "Disabled": leading flag 3 plus a timestamp in the last 8 bytes.
        s.set_approved_value(NAME, &[3, 0, 0, 0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]).unwrap();
        assert!(!is_enabled(&s, NAME));
        enable(&s, NAME, exe()).unwrap();
        assert!(is_enabled(&s, NAME));
    }

    #[test]
    fn enabling_replaces_an_unquoted_value_left_by_the_old_plugin() {
        let s = Fake::default();
        // The old plugin wrote the path unquoted, with a trailing space for (empty) arguments.
        s.set_run_value(NAME, "C:\\Program Files\\World Clock\\windows-widgets.exe ").unwrap();
        assert!(is_enabled(&s, NAME), "an existing per-user entry is recognised as enabled");
        enable(&s, NAME, exe()).unwrap();
        enable(&s, NAME, exe()).unwrap(); // idempotent
        assert_eq!(s.run.borrow().len(), 1);
        assert!(s.run_value(NAME).unwrap().starts_with('"'));
    }

    #[test]
    fn approved_flag_rules() {
        assert!(approved_means_enabled(&APPROVED_ENABLED));
        assert!(approved_means_enabled(&[6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert!(!approved_means_enabled(&[3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]));
        assert!(approved_means_enabled(&[2, 0, 0]), "too short to carry a timestamp");
        assert!(approved_means_enabled(&[]));
    }

    #[test]
    fn missing_approved_flag_means_enabled() {
        let s = Fake::default();
        s.set_run_value(NAME, "x").unwrap();
        assert!(is_enabled(&s, NAME));
    }
}
