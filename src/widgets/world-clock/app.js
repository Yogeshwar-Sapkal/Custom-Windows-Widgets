// World Clock widget. Plain ES module, no bundler.
import {
  appWindow, loadConfig, saveConfig, applyOpacity, applyAlwaysOnTop,
  mountChrome, createPanels, createFit, bindSegmented,
} from "../../shared/widget.js";
import { ZONES } from "./zones.js";

const MAX_CLOCKS = 4;
const STORAGE_KEY = "worldclock.config.v1"; // unchanged, so saved clocks survive restructures
const SIZES = [{ label: "Small", value: 32 }, { label: "Medium", value: 48 }, { label: "Large", value: 64 }, { label: "Extra large", value: 80 }];
const LAYOUTS = [{ label: "Column", value: "column" }, { label: "Row", value: "row" }, { label: "2 × 2", value: "grid" }];

// ---- Zones -----------------------------------------------------------
const zoneById = new Map(ZONES.map((z) => [z.id, z]));

// Legacy names some runtimes report for the local zone -> names in the bundled list.
const ALIASES = {
  "Asia/Calcutta": "Asia/Kolkata", "Asia/Katmandu": "Asia/Kathmandu", "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Rangoon": "Asia/Yangon", "Asia/Thimbu": "Asia/Thimphu", "Asia/Dacca": "Asia/Dhaka",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar", "Asia/Macao": "Asia/Macau", "Europe/Kiev": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe", "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "Pacific/Truk": "Pacific/Chuuk", "Pacific/Ponape": "Pacific/Pohnpei", "UTC": "Etc/UTC",
};
const canonical = (id) => ALIASES[id] || id;
const LOCAL_ZONE = canonical(Intl.DateTimeFormat().resolvedOptions().timeZone || "");

function zoneFor(id) {
  if (zoneById.has(id)) return zoneById.get(id);
  const city = id.split("/").pop().replace(/_/g, " ");
  return { id, city, country: "" };
}

// ---- Config ----------------------------------------------------------
const DEFAULTS = {
  clocks: null, // null = first launch, seeded with the local zone
  layout: "column",
  size: 48,
  opacity: 85,
  hour24: true,
  seconds: false,
  offset: false,
  alwaysOnTop: false,
};

const config = loadConfig(STORAGE_KEY, DEFAULTS);
if (!Array.isArray(config.clocks)) config.clocks = LOCAL_ZONE ? [LOCAL_ZONE] : [];
config.clocks = config.clocks.filter((id, i, a) => a.indexOf(id) === i).slice(0, MAX_CLOCKS);
const save = () => saveConfig(STORAGE_KEY, config);

// ---- Elements --------------------------------------------------------
const $ = (id) => document.getElementById(id);
const el = {
  card: $("card"), fit: $("fit"), clocks: $("clocks"),
  searchPanel: $("search"), searchInput: $("search-input"), searchResults: $("search-results"),
  clockPanel: $("clock-panel"), clockName: $("clock-panel-name"), removeClock: $("btn-remove-clock"),
  settingsPanel: $("settings"),
  layout: $("opt-layout"), size: $("opt-size"), opacity: $("opt-opacity"),
  h24: $("opt-24h"), seconds: $("opt-seconds"), offset: $("opt-offset"), top: $("opt-top"),
};

const panels = createPanels();
const { fit, resizeWindowToContent, autoSizeOnce } = createFit({
  fitEl: el.fit, contentEl: el.clocks, sizedKey: "worldclock.sized.v1",
});

// ---- Time formatting -------------------------------------------------
const fmtCache = new Map();

function formatters(zoneId) {
  const key = [zoneId, config.hour24, config.seconds].join("|");
  let f = fmtCache.get(key);
  if (f) return f;
  const timeOpts = {
    timeZone: zoneId,
    hour: config.hour24 ? "2-digit" : "numeric",
    minute: "2-digit",
    hourCycle: config.hour24 ? "h23" : "h12",
  };
  if (config.seconds) timeOpts.second = "2-digit";
  f = {
    time: new Intl.DateTimeFormat(undefined, timeOpts),
    numeric: new Intl.DateTimeFormat("en-US", {
      timeZone: zoneId, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    }),
  };
  fmtCache.set(key, f);
  return f;
}

/** The wall-clock fields of `now` in the clock's zone. */
function zoneParts(numericFmt, now) {
  const p = {};
  for (const part of numericFmt.formatToParts(now)) p[part.type] = +part.value;
  return p;
}

function offsetMinutes(parts, now) {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return Math.round((asUtc - Math.floor(now.getTime() / 1000) * 1000) / 60000);
}

/** -1 = the clock's date is yesterday for you, 0 = same day, 1 = tomorrow. */
function dayDifference(parts, now) {
  const zoneDay = Date.UTC(parts.year, parts.month - 1, parts.day);
  const localDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((zoneDay - localDay) / 86400000);
}

function dayLabel(diff) {
  if (diff === 0) return "";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return diff > 0 ? "In " + diff + " days" : Math.abs(diff) + " days ago";
}

function offsetText(diffMin) {
  if (diffMin === 0) return "same time as you";
  const sign = diffMin > 0 ? "+" : "−";
  const abs = Math.abs(diffMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return sign + h + "h" + (m ? String(m).padStart(2, "0") : "");
}

const SUN = '<svg class="sun" viewBox="0 0 24 24" fill="currentColor" aria-label="Day"><circle cx="12" cy="12" r="4.5"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></g></svg>';
const MOON = '<svg class="moon" viewBox="0 0 24 24" fill="currentColor" aria-label="Night"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>';

// ---- Rendering -------------------------------------------------------
let nodes = []; // [{ id, time, sub, icon, lastIcon }]

function renderClocks() {
  el.clocks.className = config.layout;
  el.clocks.textContent = "";
  nodes = config.clocks.map((id) => {
    const zone = zoneFor(id);
    const root = document.createElement("div");
    root.className = "clock";
    root.tabIndex = 0;
    root.setAttribute("role", "button");
    root.dataset.id = id;
    root.setAttribute("aria-label", zone.city + " clock. Activate for options.");
    root.innerHTML =
      '<div class="top"><span class="icon"></span><span class="city"></span></div>' +
      '<div class="time"></div><div class="sub" hidden></div>';
    root.querySelector(".city").textContent = zone.city; // the country is in the search results and the tooltip
    root.title = zone.city + (zone.country ? ", " + zone.country : "");
    el.clocks.appendChild(root);
    return {
      id, isLocal: canonical(id) === LOCAL_ZONE,
      time: root.querySelector(".time"), sub: root.querySelector(".sub"),
      icon: root.querySelector(".icon"), lastIcon: "",
    };
  });
  if (config.clocks.length < MAX_CLOCKS) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.id = "add-tile";
    tile.className = "add-tile";
    tile.textContent = config.clocks.length ? "+ Add clock" : "+ Add a clock";
    el.clocks.appendChild(tile);
  }
  tick();
}

function tick() {
  const now = new Date();
  for (const n of nodes) {
    const f = formatters(n.id);
    const parts = f.time.formatToParts(now);
    const period = parts.find((p) => p.type === "dayPeriod");
    const main = parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim();
    const timeHtml = period ? main + "<small>" + period.value.toUpperCase() + "</small>" : main;
    if (n.time.dataset.v !== timeHtml) { n.time.dataset.v = timeHtml; n.time.innerHTML = timeHtml; }

    // The date is only worth a line when it differs from yours ("Tomorrow").
    const zp = zoneParts(f.numeric, now);
    const bits = [];
    const label = dayLabel(dayDifference(zp, now));
    if (label) bits.push(label);
    if (n.isLocal) bits.push('<span class="tag">Your time</span>');
    else if (config.offset) bits.push(offsetText(offsetMinutes(zp, now) + now.getTimezoneOffset()));
    const html = bits.join(" · ");
    if (n.sub.dataset.v !== html) { n.sub.dataset.v = html; n.sub.innerHTML = html; n.sub.hidden = !html; }

    const day = zp.hour % 24 >= 6 && zp.hour % 24 < 18;
    const iconKey = day ? "sun" : "moon";
    if (n.lastIcon !== iconKey) { n.lastIcon = iconKey; n.icon.innerHTML = day ? SUN : MOON; }
  }
}

function scheduleTick() {
  tick();
  setTimeout(scheduleTick, 1000 - (Date.now() % 1000) + 5);
}

// ---- Applying config -------------------------------------------------
function applyStyle() {
  document.documentElement.style.setProperty("--size", config.size + "px");
  applyOpacity(config.opacity);
}

function reflow(resizeWindow) {
  renderClocks();
  if (resizeWindow) resizeWindowToContent(); else fit();
}

// ---- Add / remove clocks ---------------------------------------------
function addClock(id) {
  if (config.clocks.length >= MAX_CLOCKS || config.clocks.includes(id)) return;
  config.clocks.push(id);
  save();
  panels.closeAll();
  reflow(true);
}

let selectedId = null;
function removeSelected() {
  if (!selectedId) return;
  config.clocks = config.clocks.filter((c) => c !== selectedId);
  selectedId = null;
  save();
  panels.closeAll();
  reflow(true);
}

// ---- Search ----------------------------------------------------------
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const searchIndex = ZONES.map((z) => ({ z, c: norm(z.city), k: norm(z.country), i: norm(z.id) }));
let results = [];
let active = 0;

function runSearch() {
  const q = norm(el.searchInput.value.trim());
  const taken = new Set(config.clocks);
  let hits = searchIndex.filter((e) => !taken.has(e.z.id));
  if (q) {
    hits = hits
      .map((e) => {
        let rank = -1;
        if (e.c.startsWith(q)) rank = 0;
        else if (e.k.startsWith(q)) rank = 1;
        else if (e.c.includes(q)) rank = 2;
        else if (e.k.includes(q) || e.i.includes(q)) rank = 3;
        return { e, rank };
      })
      .filter((x) => x.rank >= 0)
      .sort((a, b) => a.rank - b.rank)
      .map((x) => x.e);
  }
  results = hits.slice(0, 40).map((e) => e.z);
  active = 0;
  renderResults();
}

function renderResults() {
  el.searchResults.textContent = "";
  if (!results.length) {
    const li = document.createElement("li");
    li.className = "none";
    li.textContent = "No matching places";
    el.searchResults.appendChild(li);
    return;
  }
  results.forEach((z, idx) => {
    const li = document.createElement("li");
    if (idx === active) li.className = "active";
    li.innerHTML = "<strong></strong> <span></span>";
    li.firstChild.textContent = z.city;
    li.lastChild.textContent = z.country;
    li.addEventListener("click", () => addClock(z.id));
    el.searchResults.appendChild(li);
  });
  const a = el.searchResults.querySelector(".active");
  if (a) a.scrollIntoView({ block: "nearest" });
}

function openSearch() {
  if (config.clocks.length >= MAX_CLOCKS) return;
  if (panels.toggle(el.searchPanel)) {
    el.searchInput.value = "";
    runSearch();
    el.searchInput.focus();
  }
}

function openClockOptions(id) {
  selectedId = id;
  const zone = zoneFor(id);
  el.clockName.textContent = zone.city + (zone.country ? ", " + zone.country : "");
  panels.toggle(el.clockPanel);
}

// ---- Wiring ----------------------------------------------------------
const layoutPicker = bindSegmented(el.layout, LAYOUTS, (value) => { config.layout = value; save(); reflow(true); });
const sizePicker = bindSegmented(el.size, SIZES, (value) => { config.size = value; applyStyle(); save(); reflow(true); });

function syncSettingsUi() {
  layoutPicker.set(config.layout);
  sizePicker.set(config.size);
  el.opacity.value = config.opacity;
  el.h24.checked = config.hour24;
  el.seconds.checked = config.seconds;
  el.offset.checked = config.offset;
  el.top.checked = config.alwaysOnTop;
}

function wire() {
  [el.searchPanel, el.clockPanel, el.settingsPanel].forEach(panels.add);
  mountChrome({
    card: el.card, panels, name: "World Clock",
    items: [{ id: "settings", label: "Settings", action: () => panels.toggle(el.settingsPanel) }],
  });

  // Tap a clock for its options; tap the dashed tile to add one. No hover needed.
  el.clocks.addEventListener("click", (e) => {
    if (e.target.closest("#add-tile")) { openSearch(); return; }
    const clock = e.target.closest(".clock");
    if (clock) openClockOptions(clock.dataset.id);
  });
  el.clocks.addEventListener("keydown", (e) => {
    const clock = e.target.closest(".clock");
    if (clock && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openClockOptions(clock.dataset.id); }
  });
  el.removeClock.addEventListener("click", removeSelected);

  el.searchInput.addEventListener("input", runSearch);
  el.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { active = Math.min(results.length - 1, active + 1); renderResults(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); renderResults(); e.preventDefault(); }
    else if (e.key === "Enter" && results[active]) addClock(results[active].id);
  });

  el.opacity.addEventListener("input", () => { config.opacity = +el.opacity.value; applyStyle(); save(); });
  el.h24.addEventListener("change", () => { config.hour24 = el.h24.checked; save(); reflow(true); });
  el.seconds.addEventListener("change", () => { config.seconds = el.seconds.checked; save(); reflow(true); });
  el.offset.addEventListener("change", () => { config.offset = el.offset.checked; save(); reflow(true); });
  el.top.addEventListener("change", () => { config.alwaysOnTop = el.top.checked; save(); applyAlwaysOnTop(config.alwaysOnTop); });
}

// ---- Start -----------------------------------------------------------
applyStyle();
syncSettingsUi();
wire();
applyAlwaysOnTop(config.alwaysOnTop);
renderClocks();
requestAnimationFrame(() => autoSizeOnce());
scheduleTick();
