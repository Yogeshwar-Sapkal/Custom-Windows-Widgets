# Use Tauri 2 for the widget

The widget is a small always-visible Windows 11 desktop window, so idle memory and install size matter. We chose Tauri 2 (Rust plus the WebView2 runtime already in Windows 11, with a plain HTML/CSS/JS front end) over Electron (about 150-300 MB RAM, 80-150 MB installer) and native .NET WPF/WinUI (marginally lighter, but clunkier to style and resize freely). The front end uses the built-in `Intl` API for time zones and daylight-saving rules, so no time zone library is bundled.
