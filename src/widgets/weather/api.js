// Open-Meteo requests and response parsing. No account or API key is needed.
// Pure functions (no DOM) so they can be tested with sample responses.

const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = "https://api.open-meteo.com/v1/forecast";

export const HOURS_SHOWN = 24;
export const DAYS_SHOWN = 5;

export function geocodeUrl(query) {
  return GEOCODE + "?name=" + encodeURIComponent(query) + "&count=8&language=en&format=json";
}

export function parseGeocode(json) {
  return (json.results || []).map((r) => ({
    name: r.name,
    admin1: r.admin1 || "",
    country: r.country || "",
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

export function forecastUrl(loc, units) {
  const imperial = units === "imperial";
  const p = new URLSearchParams({
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m,precipitation,snowfall",
    hourly: "temperature_2m,weather_code,is_day,uv_index",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,uv_index_max",
    timezone: "auto",
    forecast_days: String(DAYS_SHOWN + 1), // today + the next 5 days
    temperature_unit: imperial ? "fahrenheit" : "celsius",
    wind_speed_unit: imperial ? "mph" : "kmh",
    precipitation_unit: imperial ? "inch" : "mm",
  });
  return FORECAST + "?" + p.toString();
}

export function unitLabels(units) {
  return units === "imperial"
    ? { temp: "°F", wind: "mph", rain: "in", snow: "in" }
    : { temp: "°C", wind: "km/h", rain: "mm", snow: "cm" };
}

export function uvLabel(uv) {
  if (uv == null) return "";
  if (uv < 3) return "Low";
  if (uv < 6) return "Moderate";
  if (uv < 8) return "High";
  if (uv < 11) return "Very high";
  return "Extreme";
}

/** Turn an Open-Meteo forecast response into what the widget displays. */
export function parseForecast(json, now = Date.now()) {
  const c = json.current;
  const h = json.hourly;
  const d = json.daily;

  // Times are local to the place ("2026-11-15T14:30"), so compare them as strings.
  const hourKey = c.time.slice(0, 13) + ":00";
  let start = h.time.indexOf(hourKey);
  if (start < 0) start = 0;

  const hours = [];
  for (let i = start; i < Math.min(start + HOURS_SHOWN, h.time.length); i++) {
    hours.push({
      hour: Number(h.time[i].slice(11, 13)),
      temp: h.temperature_2m[i],
      code: h.weather_code[i],
      isDay: h.is_day[i] === 1,
    });
  }

  const days = d.time.map((date, i) => ({
    date,
    code: d.weather_code[i],
    max: d.temperature_2m_max[i],
    min: d.temperature_2m_min[i],
    precip: d.precipitation_sum[i],
    snow: d.snowfall_sum[i],
    uvMax: d.uv_index_max[i],
  }));

  return {
    fetchedAt: now,
    current: {
      temp: c.temperature_2m,
      feels: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      isDay: c.is_day === 1,
      code: c.weather_code,
      wind: c.wind_speed_10m,
      precip: c.precipitation,
      snow: c.snowfall,
      uv: h.uv_index[start] ?? null,
    },
    today: days[0] ? { max: days[0].max, min: days[0].min } : null,
    hours,
    days: days.slice(1, 1 + DAYS_SHOWN),
  };
}
