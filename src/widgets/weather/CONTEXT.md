# Weather

A widget that shows the current weather and short-term forecast for one place.

## Language

**Location**:
The single place the Weather widget reports on, picked by searching a city name. Distinct from a World Clock Zone: a Location has coordinates, a Zone has a time zone.
_Avoid_: City, place, region

**Current conditions**:
What the weather is right now at the Location: temperature, feels-like, sky condition, wind speed, rain or snowfall, UV index and humidity.
_Avoid_: Now, live weather

**Hourly outlook**:
The temperature for each of the next 24 hours, starting at the current hour, drawn as a line.
_Avoid_: Hourly forecast, graph

**Daily outlook**:
The high and low, sky condition and rain or snow total for each of the next 5 days, not counting today.
_Avoid_: Weekly forecast, 5-day forecast

**Units**:
Metric (degrees Celsius, km/h, mm, cm) or Imperial (degrees Fahrenheit, mph, inches). One setting for the whole widget.
_Avoid_: Measurement system, scale

**Stale data**:
The last successfully fetched weather, shown with an "Offline" note when a refresh fails. Shown only for the same Location and Units.
_Avoid_: Cached data, old data
