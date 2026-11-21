# Custom Windows Widgets

Personal desktop widgets for Windows 11, built with Tauri 2: one app, one tray icon, one window per widget. Everything works with a mouse or a touchscreen. See `CONTEXT-MAP.md` for the vocabulary and `docs/adr/` for the decisions behind the design.

## Widgets

- **World Clock**: up to 4 clocks, each for a city picked by searching a city or country (works offline). Shows the time and city; a date line only appears when it differs from yours ("Tomorrow", "Yesterday"); your own clock is tagged "Your time"; a sun or moon shows whether it is day there. Column, row or 2 x 2 layout. Tap a clock to remove it, tap the dashed "+ Add clock" tile to add one.
- **Weather**: for one searched city: current temperature, feels-like, wind, rain or snow now, UV index and humidity, a 24-hour temperature line (tap or drag along it for the exact time and temperature), and a 5-day outlook. Data from [Open-Meteo](https://open-meteo.com) (no account or key). Metric or imperial, refreshes every 15 minutes, and keeps showing the last data (marked offline) if a refresh fails. The hourly chart and the 5 days can be switched off for a compact widget.
- **Battery**: this PC's battery (percent, charging, time left) plus paired Bluetooth devices that report a level to Windows; a device that reports nothing says "No reading". Phone Link has no public interface, so a phone appears only if it is paired over Bluetooth *and* Windows reports its battery. Windows-only; refreshes every 2 minutes.
- **Calendar**: a month grid with your own events and to-dos, kept only on this PC (no accounts, no syncing, no internet).
  - Tap a day to see it; tap **+ Add** to create an entry. An entry is an **Event** (optionally with a time, an end time, an end date for several days, a location) or a **To-do** (tick it off when done). Each has one of six colours and can repeat daily, weekly, monthly or yearly.
  - A repeating to-do is ticked per day. An unfinished to-do from a past day shows in a red **Overdue** group; a repeating one only reports its most recent missed day.
  - Swipe the grid (or use the arrows or PageUp/PageDown) to change month. Week starts on Monday, Sunday or Saturday (or follows your region), with optional week numbers.
  - Deleting an entry offers **Undo**; deleting a repeating one asks first.

## Using the widgets

- Every widget has one **⋯** menu button (top right, always visible) with its actions, such as *Refresh now* and *Settings*, and *Hide widget*. Settings open as a panel with a **Done** button. Nothing depends on hover, and controls are at least 44 px for fingers.
- Drag a widget by its background (not over a list or grid) to move it. It remembers its position, size and settings. Resizing keeps the size you choose; the *Size* setting (Small to Extra large) changes how big things are.
- **Hide widget** only hides it. Bring it back from the tray icon (the ^ arrow near the taskbar clock may hide it; drag it out to pin it). The tray menu also has **Launch at login** and **Quit**.

## Your data

Calendar entries are saved in `%APPDATA%\com.personal.worldclock\` as `calendar.json`, written safely (a temporary file, then swapped in), with the previous version kept as `calendar.json.bak`. If the main file is ever damaged the backup is used. **Settings > Export...** saves a backup file you can keep; **Import...** replaces everything with a backup after asking, keeps a copy of what you had (`calendar.before-import.json`) and offers **Undo**. Other settings (clocks, city, sizes) are stored in the app's own browser storage.

## Get the installer (no local setup)

Run the **Build Windows installer** workflow from the GitHub Actions tab, then download the `world-clock-windows` artifact (`.exe` / `.msi`). It is unsigned, so SmartScreen warns once: choose *More info -> Run anyway*.

## Start at login

The tray menu's **Launch at login** writes only the current user's startup entry (`HKCU\...\Run`); it never writes the machine-wide one. Only one copy of the app can run: starting it again (a second startup entry, Windows reopening apps, a double click) just brings the running copy's widgets forward.

If an older version left a machine-wide entry behind, remove it once from an administrator PowerShell (it only launches a harmless second copy that exits, but it is no longer needed):

```powershell
Remove-ItemProperty -Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'World Clock'
```

## Develop locally (on Windows)

Needs Node 20+, Rust (stable) and the Visual Studio C++ Build Tools.

```bash
npm install
npm run dev     # run the widgets
npm run build   # build the installer
npm test        # JS tests: calendar rules, window sizing (Node's built-in runner, no extra packages)
```

- Rust tests: `cd src-tauri && cargo test --lib` (battery, start at login, calendar storage).
- `tests/double-launch.sh` (Linux) launches the built app twice on a virtual display and checks the second launch does not open a second set of widgets. It needs Xvfb, xdotool and dbus-run-session, and a build: `cd src-tauri && cargo build --features tauri/custom-protocol`.

The UI is plain HTML/CSS/JS in `src/` (native ES modules, no bundler): shared code in `src/shared/` (menu, panels, window sizing), one folder per widget in `src/widgets/`. The Calendar's rules are plain functions in `src/widgets/calendar/model.js` so they can be tested without a screen. `src/widgets/world-clock/zones.js` is generated from the IANA tz database with `npm run zones` (needs Python 3 and a tz database).
