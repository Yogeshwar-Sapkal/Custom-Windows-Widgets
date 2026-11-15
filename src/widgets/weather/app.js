// Weather widget. Plain ES module, no bundler. Data: Open-Meteo (no account or key).
import {
  appWindow, loadConfig, saveConfig, applyOpacity, applyAlwaysOnTop,
  setupChrome, createPanels, createFit,
} from "../../shared/widget.js";
import { geocodeUrl, parseGeocode, forecastUrl, parseForecast, unitLabels, uvLabel } from "./api.js";
import { describe } from "./codes.js";

const STORAGE_KEY = "weather.config.v1";
const CACHE_KEY = "weather.cache.v1";
const REFRESH_MS = 15 * 60 * 1000; // Open-Meteo refreshes its current conditions every 15 minutes
const RETRY_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;

const DEFAULTS = { location: null, units: "metric", hour24: true, size: 44, opacity: 85, alwaysOnTop: false };
const config = loadConfig(STORAGE_KEY, DEFAULTS);
const save = () => saveConfig(STORAGE_KEY, config);

// ---- Elements --------------------------------------------------------
const $ = (id) => document.getElementById(id);
const el = {
  card: $("card"), fit: $("fit"), weather: $("weather"), message: $("message"),
  loc: $("loc"), status: $("status"),
  nowIcon: $("now-icon"), nowTemp: $("now-temp"), nowText: $("now-text"), nowFeels: $("now-feels"), nowRange: $("now-range"),
  wind: $("st-wind"), precipKey: $("st-precip-k"), precip: $("st-precip"), uv: $("st-uv"), hum: $("st-hum"),
  chart: $("chart"), daily: $("daily"),
  place: $("btn-place"), refresh: $("btn-refresh"), settings: $("btn-settings"), close: $("btn-close"),
  searchPanel: $("search"), searchInput: $("search-input"), searchResults: $("search-results"),
  settingsPanel: $("settings"),
  units: $("opt-units"), size: $("opt-size"), sizeVal: $("size-val"), opacity: $("opt-opacity"),
  h24: $("opt-24h"), top: $("opt-top"),
};

const panels = createPanels(el.searchPanel, el.settingsPanel);
let hasData = false;
const { fit, resizeWindowToContent, autoSizeOnce } = createFit({ fitEl: el.fit, contentEl: el.weather, hasContent: () => hasData, sizedKey: "weather.sized.v1" });

// ---- Formatting helpers ----------------------------------------------
const round = (n) => Math.round(n);
const fmtTemp = (t) => round(t) + "°";

function hourLabel(h) {
  if (config.hour24) return String(h).padStart(2, "0") + ":00";
  return (h % 12 || 12) + " " + (h < 12 ? "AM" : "PM");
}

function dayName(dateStr) {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
}

function clockTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: !config.hour24 });
}

function amount(n, unit) {
  const digits = unit === "in" ? 2 : 1;
  return (Math.round(n * 10 ** digits) / 10 ** digits).toString();
}

// ---- Hourly chart (SVG built from numbers and formatted labels only) ---
const CHART = { W: 320, H: 112, padX: 14, padTop: 22, padBot: 22 };
let chartHours = [];

const chartX = (i, n) => CHART.padX + (i * (CHART.W - 2 * CHART.padX)) / Math.max(1, n - 1);

function hourlyChart(hours) {
  const { W, H, padX, padTop, padBot } = CHART;
  const n = hours.length;
  const temps = hours.map((x) => x.temp);
  const min = Math.min(...temps), max = Math.max(...temps);
  const span = max - min || 1;
  const x = (i) => chartX(i, n);
  const y = (t) => padTop + (1 - (t - min) / span) * (H - padTop - padBot);
  const base = H - padBot;
  const f = (v) => v.toFixed(1);

  // Night hours: a light band behind the line.
  let night = "";
  for (let i = 0; i < n; ) {
    if (hours[i].isDay) { i++; continue; }
    let j = i;
    while (j + 1 < n && !hours[j + 1].isDay) j++;
    const x0 = i === 0 ? padX : (x(i) + x(i - 1)) / 2;
    const x1 = j === n - 1 ? W - padX : (x(j) + x(j + 1)) / 2;
    night += '<rect class="night" x="' + f(x0) + '" y="' + padTop + '" width="' + f(x1 - x0) + '" height="' + (base - padTop) + '"/>';
    i = j + 1;
  }

  // Midnight dividers with the day name.
  let days = "";
  hours.forEach((p, i) => {
    if (p.hour !== 0 || i === 0) return;
    days += '<line class="midnight" x1="' + f(x(i)) + '" x2="' + f(x(i)) + '" y1="4" y2="' + base + '"/>' +
      '<text class="dayname" x="' + f(x(i) + 4) + '" y="12">' + dayName(p.date) + "</text>";
  });

  // Label "Now" and every round 3 hours (3 AM, 6 AM ... or 03:00, 06:00 ...).
  const labelled = hours.map((p, i) => i).filter((i) => i === 0 || (hours[i].hour % 3 === 0 && i >= 3));
  let labels = "";
  for (const i of labelled) {
    const p = hours[i];
    labels +=
      '<line class="tick" x1="' + f(x(i)) + '" x2="' + f(x(i)) + '" y1="' + f(y(p.temp)) + '" y2="' + base + '"/>' +
      '<circle class="dot" cx="' + f(x(i)) + '" cy="' + f(y(p.temp)) + '" r="2.5"/>' +
      '<text x="' + f(x(i)) + '" y="' + f(y(p.temp) - 7) + '">' + fmtTemp(p.temp) + "</text>" +
      '<text class="hour' + (i === 0 ? " now" : "") + '" x="' + f(x(i)) + '" y="' + (H - 6) + '">' +
      (i === 0 ? "Now" : hourLabel(p.hour)) + "</text>";
  }

  const pts = hours.map((p, i) => f(x(i)) + "," + f(y(p.temp)));
  const area = "M" + f(x(0)) + "," + base + " L" + pts.join(" L") + " L" + f(x(n - 1)) + "," + base + " Z";
  return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Temperature over the next 24 hours">' +
    night + days + '<path class="area" d="' + area + '"/><polyline class="line" points="' + pts.join(" ") + '"/>' + labels +
    '<line class="cursor" y1="' + padTop + '" y2="' + base + '" style="display:none"/></svg>';
}

// Hover: show the exact time, temperature and condition for the point under the pointer.
function wireChartHover() {
  const readout = $("readout");
  const reset = () => {
    readout.textContent = "";
    const c = el.chart.querySelector(".cursor");
    if (c) c.style.display = "none";
  };
  el.chart.addEventListener("mouseleave", reset);
  el.chart.addEventListener("mousemove", (e) => {
    const svg = el.chart.querySelector("svg");
    const n = chartHours.length;
    if (!svg || !n) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * CHART.W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - CHART.padX) / (CHART.W - 2 * CHART.padX)) * (n - 1))));
    const p = chartHours[i];
    const when = i === 0 ? "Now" : dayName(p.date) + " " + hourLabel(p.hour);
    readout.textContent = when + " \u00b7 " + fmtTemp(p.temp) + " \u00b7 " + describe(p.code, p.isDay).text;
    const c = el.chart.querySelector(".cursor");
    c.setAttribute("x1", chartX(i, n).toFixed(1));
    c.setAttribute("x2", chartX(i, n).toFixed(1));
    c.style.display = "";
  });
}

// ---- Rendering -------------------------------------------------------
function showMessage(text) {
  hasData = false;
  el.weather.hidden = true;
  el.message.textContent = text;
  el.message.hidden = false;
}

function render(data, { stale }) {
  const u = unitLabels(config.units);
  const c = data.current;
  const cond = describe(c.code, c.isDay);

  hasData = true;
  el.message.hidden = true;
  el.weather.hidden = false;

  const l = config.location;
  el.loc.textContent = l.name + (l.country ? ", " + l.country : "");
  el.status.className = "note" + (stale ? " warn" : "");
  el.status.textContent = stale ? "Offline - showing data from " + clockTime(data.fetchedAt) : "Updated " + clockTime(data.fetchedAt);

  el.nowIcon.textContent = cond.icon;
  el.nowTemp.textContent = fmtTemp(c.temp);
  el.nowText.textContent = cond.text;
  el.nowFeels.textContent = "Feels like " + fmtTemp(c.feels);
  el.nowRange.textContent = data.today ? "H " + fmtTemp(data.today.max) + "  L " + fmtTemp(data.today.min) : "";

  el.wind.textContent = round(c.wind) + " " + u.wind;
  if (c.snow > 0) { el.precipKey.textContent = "Snow"; el.precip.textContent = amount(c.snow, u.snow) + " " + u.snow; }
  else { el.precipKey.textContent = "Rain"; el.precip.textContent = amount(c.precip, u.rain) + " " + u.rain; }
  el.uv.textContent = c.uv == null ? "-" : round(c.uv) + " " + uvLabel(c.uv);
  el.hum.textContent = round(c.humidity) + "%";

  chartHours = data.hours;
  el.chart.innerHTML = hourlyChart(data.hours);

  el.daily.textContent = "";
  data.days.forEach((d) => {
    const row = document.createElement("div");
    row.className = "day";
    const wet = d.snow > 0 ? amount(d.snow, u.snow) + " " + u.snow + " snow" : d.precip > 0 ? amount(d.precip, u.rain) + " " + u.rain : "";
    row.innerHTML = '<span class="name"></span><span class="icon"></span><span class="rain"></span><span class="range"></span>';
    row.children[0].textContent = dayName(d.date);
    row.children[1].textContent = describe(d.code, true).icon;
    row.children[1].title = describe(d.code, true).text;
    row.children[2].textContent = wet;
    row.children[3].innerHTML = "<span></span> <span class='lo'></span>";
    row.children[3].children[0].textContent = fmtTemp(d.max);
    row.children[3].children[1].textContent = fmtTemp(d.min);
    el.daily.appendChild(row);
  });

  autoSizeOnce(); // never resizes after the first time: a refresh must not undo the user's window size
}

// ---- Fetching and caching --------------------------------------------
const cacheId = () => config.location ? [config.location.latitude, config.location.longitude, config.units].join(",") : "";

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    return c && c.id === cacheId() ? c.data : null;
  } catch (_) { return null; }
}

function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ id: cacheId(), data })); } catch (_) { /* ignore */ }
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

let refreshTimer = null;
let inFlight = false;

function scheduleRefresh(ms) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, ms);
}

async function refresh() {
  if (!config.location) { showMessage("Search for a city to see the weather."); return; }
  if (inFlight) return;
  inFlight = true;
  el.refresh.disabled = true;
  try {
    const data = parseForecast(await fetchJson(forecastUrl(config.location, config.units)));
    writeCache(data);
    render(data, { stale: false });
    scheduleRefresh(REFRESH_MS);
  } catch (_) {
    const cached = readCache();
    if (cached) render(cached, { stale: true });
    else showMessage("Couldn't load the weather. Check your connection - retrying soon.");
    scheduleRefresh(RETRY_MS);
  } finally {
    inFlight = false;
    el.refresh.disabled = false;
  }
}

// ---- Location search -------------------------------------------------
let results = [];
let active = 0;
let searchTimer = null;
let searchSeq = 0;

function renderResults(note) {
  el.searchResults.textContent = "";
  if (!results.length) {
    const li = document.createElement("li");
    li.className = "none";
    li.textContent = note || "Type a city name";
    el.searchResults.appendChild(li);
    return;
  }
  results.forEach((r, idx) => {
    const li = document.createElement("li");
    if (idx === active) li.className = "active";
    li.innerHTML = "<strong></strong> <span></span>";
    li.firstChild.textContent = r.name;
    li.lastChild.textContent = [r.admin1, r.country].filter(Boolean).join(", ");
    li.addEventListener("click", () => chooseLocation(r));
    el.searchResults.appendChild(li);
  });
}

async function runSearch() {
  const q = el.searchInput.value.trim();
  const seq = ++searchSeq;
  if (q.length < 2) { results = []; renderResults(); return; }
  try {
    const found = parseGeocode(await fetchJson(geocodeUrl(q)));
    if (seq !== searchSeq) return; // a newer search replaced this one
    results = found; active = 0;
    renderResults("No matching places");
  } catch (_) {
    if (seq !== searchSeq) return;
    results = [];
    renderResults("Search failed - check your connection");
  }
}

function chooseLocation(r) {
  config.location = r;
  save();
  panels.closeAll();
  showMessage("Loading weather...");
  refresh();
}

function openSearch() {
  if (panels.toggle(el.searchPanel)) {
    el.searchInput.value = "";
    results = [];
    renderResults();
    el.searchInput.focus();
  }
}

// ---- Wiring ----------------------------------------------------------
function applyStyle() {
  document.documentElement.style.setProperty("--size", config.size + "px");
  applyOpacity(config.opacity);
}

function syncSettingsUi() {
  el.units.value = config.units;
  el.size.value = config.size;
  el.sizeVal.textContent = config.size + " px";
  el.opacity.value = config.opacity;
  el.h24.checked = config.hour24;
  el.top.checked = config.alwaysOnTop;
}

function rerenderFromCache() {
  const cached = readCache();
  if (cached) render(cached, { stale: false });
}

function wire() {
  setupChrome({ card: el.card, closeButton: el.close, onBackgroundPress: panels.closeAll });
  el.place.addEventListener("click", openSearch);
  el.refresh.addEventListener("click", () => { scheduleRefresh(REFRESH_MS); refresh(); });
  el.settings.addEventListener("click", () => panels.toggle(el.settingsPanel));

  el.searchInput.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 300); });
  el.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { active = Math.min(results.length - 1, active + 1); renderResults(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); renderResults(); e.preventDefault(); }
    else if (e.key === "Enter" && results[active]) chooseLocation(results[active]);
  });

  el.units.addEventListener("change", () => { config.units = el.units.value; save(); showMessage("Loading weather..."); refresh(); });
  el.size.addEventListener("input", () => { config.size = +el.size.value; el.sizeVal.textContent = config.size + " px"; applyStyle(); save(); fit(); });
  el.size.addEventListener("change", () => resizeWindowToContent());
  el.opacity.addEventListener("input", () => { config.opacity = +el.opacity.value; applyStyle(); save(); });
  el.h24.addEventListener("change", () => { config.hour24 = el.h24.checked; save(); rerenderFromCache(); });
  el.top.addEventListener("change", () => { config.alwaysOnTop = el.top.checked; save(); applyAlwaysOnTop(config.alwaysOnTop); });

  wireChartHover();
  window.addEventListener("online", () => { scheduleRefresh(REFRESH_MS); refresh(); });
}

// ---- Start -----------------------------------------------------------
applyStyle();
syncSettingsUi();
wire();
applyAlwaysOnTop(config.alwaysOnTop);

if (!config.location) {
  showMessage("Search for a city to see the weather.");
  openSearch();
} else {
  const cached = readCache();
  if (cached) render(cached, { stale: false }); else showMessage("Loading weather...");
  refresh();
}
