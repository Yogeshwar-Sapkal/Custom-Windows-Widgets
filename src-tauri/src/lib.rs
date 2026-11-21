mod autostart;
mod battery;
mod calendar_store;

use std::{collections::HashMap, path::{Path, PathBuf}, sync::Mutex};

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Wry,
};

/// Every widget window: (window label, tray menu title).
/// A widget only appears in the tray menu if its window exists in tauri.conf.json.
const WIDGETS: [(&str, &str); 4] = [
    ("world-clock", "World Clock"),
    ("weather", "Weather"),
    ("battery", "Battery"),
    ("calendar", "Calendar"),
];

#[derive(Default)]
struct TrayState {
    items: Mutex<HashMap<String, CheckMenuItem<Wry>>>,
}

/// Make each widget's tray checkmark match whether its window is visible.
fn sync_tray_items(app: &AppHandle) {
    let state = app.state::<TrayState>();
    let items = state.items.lock().unwrap();
    for (label, item) in items.iter() {
        let visible = app
            .get_webview_window(label)
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);
        let _ = item.set_checked(visible);
    }
}

fn toggle_widget(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
    sync_tray_items(app);
}

/// A second copy of the app was started: it exits, and the copy already running shows its
/// widgets instead (so a second launch never produces a second set of windows or tray icons).
fn reveal_widgets(app: &AppHandle) {
    let mut any_visible = false;
    for (label, _) in WIDGETS {
        if let Some(w) = app.get_webview_window(label) {
            if w.is_visible().unwrap_or(false) {
                any_visible = true;
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
    }
    if !any_visible {
        // Every widget was hidden: bring back the default one.
        if let Some(w) = app.get_webview_window("world-clock") {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
    sync_tray_items(app);
}

/// Called by a widget's close button: hide the window (the app keeps running in the tray).
#[tauri::command]
fn hide_widget(app: AppHandle, label: String) {
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.hide();
    }
    sync_tray_items(&app);
}

/// Called by each widget when it loads, so the tray checkmarks start out correct.
#[tauri::command]
fn sync_tray(app: AppHandle) {
    sync_tray_items(&app);
}

/// Battery levels for this PC and paired Bluetooth devices (read off the UI thread).
#[tauri::command]
async fn get_batteries() -> battery::BatteryReport {
    tauri::async_runtime::spawn_blocking(battery::read_report)
        .await
        .unwrap_or_else(|_| battery::BatteryReport {
            supported: true,
            error: Some("battery scan stopped unexpectedly".into()),
            ..Default::default()
        })
}

fn calendar_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// The saved Calendar entries (JSON text), or nothing if none have been saved yet.
#[tauri::command]
async fn calendar_load(app: AppHandle) -> Result<Option<String>, String> {
    Ok(calendar_store::load(&calendar_dir(&app)?))
}

/// Save the Calendar entries safely (temporary file, then swap; the previous version is kept).
#[tauri::command]
async fn calendar_save(app: AppHandle, json: String) -> Result<(), String> {
    calendar_store::save(&calendar_dir(&app)?, &json)
}

/// Write a backup of the entries to a file the user picked in a save dialog.
#[tauri::command]
async fn calendar_export(app: AppHandle, path: String) -> Result<(), String> {
    calendar_store::export_to(&calendar_dir(&app)?, Path::new(&path))
}

/// Read a backup file the user picked in an open dialog; keeps a copy of the current entries first.
#[tauri::command]
async fn calendar_import(app: AppHandle, path: String) -> Result<String, String> {
    calendar_store::import_from(&calendar_dir(&app)?, Path::new(&path))
}

pub fn run() {
    tauri::Builder::default()
        // Must be registered first. A second launch (two start-at-login entries, Windows
        // reopening apps, a double click) exits at once and calls this in the running copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| reveal_widgets(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(TrayState::default())
        .invoke_handler(tauri::generate_handler![hide_widget, sync_tray, get_batteries, calendar_load, calendar_save, calendar_export, calendar_import])
        .setup(|app| {
            let handle = app.handle();
            let menu = Menu::new(handle)?;

            {
                let state = app.state::<TrayState>();
                let mut items = state.items.lock().unwrap();
                for (label, title) in WIDGETS {
                    if let Some(w) = app.get_webview_window(label) {
                        let visible = w.is_visible().unwrap_or(false);
                        let item = CheckMenuItem::with_id(handle, label, title, true, visible, None::<&str>)?;
                        menu.append(&item)?;
                        items.insert(label.to_string(), item);
                    }
                }
            }

            menu.append(&PredefinedMenuItem::separator(handle)?)?;
            let app_name = app.package_info().name.clone();
            let autostart_on = autostart::is_enabled_for_user(&app_name);
            let autostart =
                CheckMenuItem::with_id(handle, "autostart", "Launch at login", true, autostart_on, None::<&str>)?;
            menu.append(&autostart)?;
            menu.append(&MenuItem::with_id(handle, "quit", "Quit", true, None::<&str>)?)?;

            let autostart_item = autostart.clone();
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Windows Widgets")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "autostart" => {
                        // Per-user only, so it never leaves a machine-wide entry behind.
                        if autostart::is_enabled_for_user(&app_name) {
                            let _ = autostart::disable_for_user(&app_name);
                        } else if let Ok(exe) = std::env::current_exe() {
                            let _ = autostart::enable_for_user(&app_name, &exe);
                        }
                        let _ = autostart_item.set_checked(autostart::is_enabled_for_user(&app_name));
                    }
                    label => toggle_widget(app, label),
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Windows Widgets");
}
