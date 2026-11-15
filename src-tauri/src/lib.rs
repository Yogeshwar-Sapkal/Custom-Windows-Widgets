mod battery;

use std::{collections::HashMap, sync::Mutex};

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/// Every widget window: (window label, tray menu title).
/// A widget only appears in the tray menu if its window exists in tauri.conf.json.
const WIDGETS: [(&str, &str); 3] = [
    ("world-clock", "World Clock"),
    ("weather", "Weather"),
    ("battery", "Battery"),
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None::<Vec<&'static str>>,
        ))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(TrayState::default())
        .invoke_handler(tauri::generate_handler![hide_widget, sync_tray, get_batteries])
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
            let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
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
                        let launcher = app.autolaunch();
                        if launcher.is_enabled().unwrap_or(false) {
                            let _ = launcher.disable();
                        } else {
                            let _ = launcher.enable();
                        }
                        let _ = autostart_item.set_checked(launcher.is_enabled().unwrap_or(false));
                    }
                    label => toggle_widget(app, label),
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Windows Widgets");
}
