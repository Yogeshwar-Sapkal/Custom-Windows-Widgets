# Context Map

One app (`Windows Widgets`) hosts several independent widgets. Each widget has its own vocabulary.

## Contexts

- [App](./CONTEXT.md): the shell that hosts widgets, the tray menu and app-wide settings
- [World Clock](./src/widgets/world-clock/CONTEXT.md): clocks for up to four places around the world

## Relationships

- **App -> every widget**: the App owns each widget's window and its show/hide state; a widget owns everything inside its window, including its own settings.
- Widgets do not talk to each other.
