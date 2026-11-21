# Windows Widgets App

A personal Windows 11 app that hosts several small desktop widgets, each in its own window, controlled from one tray icon.

## Language

**Widget**:
One self-contained desktop display (for example World Clock) with its own window, its own settings and its own saved position. The App hosts several.
_Avoid_: Gadget, panel, mini-app, Windows 11 Widgets board

**Tray menu**:
The menu on the app's single tray icon. It shows a checkmark per Widget to show or hide it, a "Launch at login" switch and Quit.
_Avoid_: Launcher, system menu

**Hide**:
Closing a Widget's window without quitting the App; the Widget stays available from the Tray menu and remembers it was hidden. Only Quit ends the App.
_Avoid_: Close, minimise

**Launch at login**:
A per-user setting, switched from the Tray menu, that starts the App when the user signs in. It never applies machine-wide.
_Avoid_: Autostart, run at startup, startup entry

**Second launch**:
Starting the App while a copy is already running. The new copy exits immediately and the running copy brings its Widgets forward; there is only ever one copy.
_Avoid_: Duplicate instance, reopen
