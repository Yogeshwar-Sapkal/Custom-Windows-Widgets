# Custom Windows Widgets

A personal world-clock widget for Windows 11, built with Tauri 2. See `CONTEXT.md` for the vocabulary and `docs/adr/` for decisions.

## Features

- Floating, frameless, translucent desktop widget (drag it by its background).
- Up to 4 clocks, each for a city/time zone picked by searching a city or country (works offline).
- Time, city, date and weekday, and a sun/moon icon (sun 06:00-18:00 local to that city).
- Layout: column, row or 2x2 grid. Clock size slider; the layout also scales when you resize the window.
- 12/24-hour, seconds and offset-from-local toggles; background opacity; window level (desktop, normal, always on top); launch at login.
- Tray icon with Show/Hide and Quit. Settings are saved between launches.

## Get the installer (no local setup)

Run the **Build Windows installer** workflow from the GitHub Actions tab, then download the `world-clock-windows` artifact (`.exe` / `.msi`). It is unsigned, so SmartScreen warns once: choose *More info -> Run anyway*.

## Develop locally (on Windows)

Needs Node 20+, Rust (stable) and the Visual Studio C++ Build Tools.

```bash
npm install
npm run dev     # run the widget
npm run build   # build the installer
```

The UI is plain HTML/CSS/JS in `src/` (no bundler). `src/zones.js` is generated from the IANA tz database with `npm run zones` (needs Python 3 and a tz database).
