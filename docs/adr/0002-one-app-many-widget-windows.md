# One app with a window per widget

All widgets ship as a single Tauri app: one installer, one tray icon, and one window per widget declared in `tauri.conf.json`. We rejected one app per widget because that means several installers, tray icons and WebView2 processes (about 30-60 MB each). The cost is that widgets share one process, so a crash affects all of them, and every declared window loads at startup even while hidden. Shared code lives in `src/shared/` as native ES modules (no bundler) and each widget owns a folder under `src/widgets/`.
