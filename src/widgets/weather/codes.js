// WMO weather interpretation codes used by Open-Meteo -> text and an emoji icon.
// (Segoe UI Emoji on Windows 11 renders these in colour.)
const TABLE = [
  [[0], "Clear sky", "☀️", "🌙"],
  [[1], "Mainly clear", "🌤️", "🌙"],
  [[2], "Partly cloudy", "⛅", "☁️"],
  [[3], "Overcast", "☁️", "☁️"],
  [[45, 48], "Fog", "🌫️", "🌫️"],
  [[51, 53, 55, 56, 57], "Drizzle", "🌦️", "🌧️"],
  [[61, 63, 65, 66, 67], "Rain", "🌧️", "🌧️"],
  [[71, 73, 75, 77], "Snow", "🌨️", "🌨️"],
  [[80, 81, 82], "Rain showers", "🌦️", "🌧️"],
  [[85, 86], "Snow showers", "🌨️", "🌨️"],
  [[95], "Thunderstorm", "⛈️", "⛈️"],
  [[96, 99], "Thunderstorm with hail", "⛈️", "⛈️"],
];

export function describe(code, isDay = true) {
  for (const [codes, text, day, night] of TABLE) {
    if (codes.includes(code)) return { text, icon: isDay ? day : night };
  }
  return { text: "Unknown", icon: "❓" };
}
