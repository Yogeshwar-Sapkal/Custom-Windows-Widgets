# Custom Windows Widgets

Personal desktop widgets for Windows 11, built with Tauri 2: one app, one tray icon, one window per widget. See `CONTEXT-MAP.md` for the vocabulary and `docs/adr/` for decisions.

## Widgets

- **World Clock**: see below.

The tray icon's menu shows or hides each widget, toggles launch at login, and quits. A widget's x button only hides it.

### World Clock features

- Floating, frameless, translucent desktop widget (drag it by its background).
- Up to 4 clocks, each for a city/time zone picked by searching a city or country (works offline).
- Time, city, date and weekday, and a sun/moon icon (sun 06:00-18:00 local to that city).
- Layout: column, row or 2x2 grid. Clock size slider; the layout also scales when you resize the window.
- 12/24-hour, seconds and offset-from-local toggles; background opacity; always-on-top; and per-widget settings saved between launches.

## Get the installer (no local setup)

Run the **Build Windows installer** workflow from the GitHub Actions tab, then download the `world-clock-windows` artifact (`.exe` / `.msi`). It is unsigned, so SmartScreen warns once: choose *More info -> Run anyway*.

## Develop locally (on Windows)

Needs Node 20+, Rust (stable) and the Visual Studio C++ Build Tools.

```bash
npm install
npm run dev     # run the widget
npm run build   # build the installer
```

The UI is plain HTML/CSS/JS in `src/` (native ES modules, no bundler): shared code in `src/shared/`, one folder per widget in `src/widgets/`. `src/widgets/world-clock/zones.js` is generated from the IANA tz database with `npm run zones` (needs Python 3 and a tz database).
