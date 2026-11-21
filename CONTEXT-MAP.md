# Context Map

One app (`Windows Widgets`) hosts several independent widgets. Each widget has its own vocabulary.

## Contexts

- [App](./CONTEXT.md): the shell that hosts widgets, the tray menu and app-wide settings
- [World Clock](./src/widgets/world-clock/CONTEXT.md): clocks for up to four places around the world
- [Weather](./src/widgets/weather/CONTEXT.md): current weather and short-term forecast for one place
- [Battery](./src/widgets/battery/CONTEXT.md): battery level of this PC and paired Bluetooth devices
- [Calendar](./src/widgets/calendar/CONTEXT.md): a local month calendar with the user's own events and to-dos

## Relationships

- **App -> every widget**: the App owns each widget's window and its show/hide state; a widget owns everything inside its window, including its own settings.
- Widgets do not talk to each other.
