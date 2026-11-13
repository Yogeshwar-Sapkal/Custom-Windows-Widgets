# World Clock Widget

A personal Windows 11 desktop widget that shows the current time in several places around the world at once.

## Language

**Widget**:
The single floating, always-visible desktop window that holds all Clocks. Not a Windows 11 Widgets-board panel.
_Avoid_: Gadget, app window, panel

**Clock**:
One digital display showing the current time for a single Zone, with its Zone label and a small date and day line. The Widget holds at most 4.
_Avoid_: Timer, watch, tile

**Zone**:
The place a Clock tells time for, identified as a city and its time zone (e.g. "Kolkata", "New York"), chosen by searching city or country name. A country is not a Zone, because many countries span several time zones.
_Avoid_: Country, region, location

**Layout**:
How the Widget arranges its Clocks: row, column, or 2x2 grid. Applies to all Clocks and defaults to column.
_Avoid_: Orientation, arrangement

**Clock size**:
How large every Clock is drawn. One value shared by all Clocks, plus the Widget window itself can be resized and the Layout scales to fit.
_Avoid_: Zoom, scale, font size

**Display options**:
Global switches that apply to every Clock: 12-hour or 24-hour format, seconds shown or hidden, and offset-from-local shown or hidden (off by default).
_Avoid_: Format settings, preferences

**Day/night icon**:
A sun or moon icon on a Clock showing whether it is daytime in that Clock's Zone. Sun from 06:00 to 18:00 Zone-local time, moon otherwise.
_Avoid_: Daylight indicator, theme switch
