// Battery widget. Plain ES module, no bundler. Data comes from the Rust side
// (`get_batteries`): this PC's battery plus paired Bluetooth devices.
import {
  T, loadConfig, saveConfig, applyOpacity, applyAlwaysOnTop,
  mountChrome, createPanels, createFit, bindSegmented,
} from "../../shared/widget.js";
import { buildRows, levelClass, BLUETOOTH } from "./format.js";

const BLUETOOTH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Bluetooth"><path d="M7 7l10 10-5 5V2l5 5L7 17"/></svg>';
const SIZES = [{ label: "Small", value: 12 }, { label: "Medium", value: 15 }, { label: "Large", value: 19 }, { label: "Extra large", value: 24 }];

const STORAGE_KEY = "battery.config.v1";
const REFRESH_MS = 2 * 60 * 1000;
const RETRY_MS = 30 * 1000;

const DEFAULTS = { size: 15, opacity: 85, alwaysOnTop: false, showNoReading: true, showDisconnected: false };
const config = loadConfig(STORAGE_KEY, DEFAULTS);
const save = () => saveConfig(STORAGE_KEY, config);

const $ = (id) => document.getElementById(id);
const el = {
  card: $("card"), fit: $("fit"), battery: $("battery"), message: $("message"),
  title: $("title"), status: $("status"), rows: $("rows"),
  settingsPanel: $("settings"),
  size: $("opt-size"), opacity: $("opt-opacity"),
  noReading: $("opt-noreading"), disconnected: $("opt-disconnected"), top: $("opt-top"),
};

const panels = createPanels();
let hasData = false;
let lastReport = null;
let lastUpdated = 0;
const { fit, resizeWindowToContent, autoSizeOnce } = createFit({ fitEl: el.fit, contentEl: el.battery, hasContent: () => hasData, sizedKey: "battery.sized.v1" });

const clockTime = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function showMessage(text) {
  hasData = false;
  el.battery.hidden = true;
  el.message.textContent = text;
  el.message.hidden = false;
}

function render() {
  const report = lastReport;
  if (!report.supported) { showMessage("Battery information is only available in the Windows app."); return; }

  const rows = buildRows(report, config);
  if (!rows.length) {
    showMessage(report.error ? "Couldn't read battery information." : "No battery information found on this PC.");
    return;
  }

  hasData = true;
  el.message.hidden = true;
  el.battery.hidden = false;
  // Say nothing about "updated" unless something is wrong; the time stays in a tooltip.
  el.title.title = "Updated " + clockTime(lastUpdated);
  el.status.hidden = !report.error;
  el.status.className = "note warn";
  el.status.textContent = report.error ? "Bluetooth scan failed - showing this PC only" : "";

  el.rows.textContent = "";
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "row-item" + (r.dim ? " dim" : "");
    row.innerHTML =
      '<div class="ico"></div><div class="body"><div class="line"><span class="name"></span><span class="pct"></span></div>' +
      '<div class="bar"><i></i></div><div class="sub"></div></div>';
    const ico = row.querySelector(".ico");
    if (r.icon === BLUETOOTH) ico.innerHTML = BLUETOOTH_SVG; else ico.textContent = r.icon;
    row.querySelector(".name").textContent = r.name;
    const sub = row.querySelector(".sub");
    if (r.sub) {
      sub.textContent = r.sub;
      if (r.low) { sub.textContent = ""; sub.append(...lowTagged(r.sub)); }
    } else sub.hidden = true;
    const bar = row.querySelector(".bar");
    const pct = row.querySelector(".pct");
    if (r.percent == null) {
      bar.hidden = true;
      pct.textContent = "No reading";
      pct.className = "pct none";
    } else {
      bar.className = "bar " + levelClass(r.percent);
      bar.firstChild.style.width = r.percent + "%";
      pct.textContent = r.percent + "%";
    }
    el.rows.appendChild(row);
  }
  autoSizeOnce(); // never resizes after the first time: a refresh must not undo the user's window size
}

// "Charging · Low" -> the word Low is coloured, so a low level never depends on colour alone.
function lowTagged(text) {
  return text.split(" · ").flatMap((part, i) => {
    const node = document.createTextNode((i ? " · " : "") + (part === "Low" ? "" : part));
    if (part !== "Low") return [node];
    const tag = document.createElement("span");
    tag.className = "lowtag";
    tag.textContent = i ? " · Low" : "Low";
    return [tag];
  });
}

let timer = null;
let inFlight = false;
function schedule(ms) { clearTimeout(timer); timer = setTimeout(refresh, ms); }

async function refresh() {
  if (!(T && T.core)) { lastReport = { supported: false, devices: [] }; render(); return; }
  if (inFlight) return;
  inFlight = true;
  try {
    lastReport = await T.core.invoke("get_batteries");
    lastUpdated = Date.now();
    render();
    schedule(REFRESH_MS);
  } catch (_) {
    if (lastReport) { el.status.hidden = false; el.status.className = "note warn"; el.status.textContent = "Couldn't refresh - showing earlier data"; }
    else showMessage("Couldn't read battery information.");
    schedule(RETRY_MS);
  } finally {
    inFlight = false;
  }
}

function applyStyle() {
  document.documentElement.style.setProperty("--size", config.size + "px");
  applyOpacity(config.opacity);
}

function syncSettingsUi() {
  sizePicker.set(config.size);
  el.opacity.value = config.opacity;
  el.noReading.checked = config.showNoReading;
  el.disconnected.checked = config.showDisconnected;
  el.top.checked = config.alwaysOnTop;
}

const sizePicker = bindSegmented(el.size, SIZES, (value) => {
  config.size = value; applyStyle(); save(); resizeWindowToContent();
});

function wire() {
  mountChrome({
    card: el.card, panels, name: "Battery",
    items: [
      { id: "refresh", label: "Refresh now", action: () => { schedule(REFRESH_MS); refresh(); } },
      { id: "settings", label: "Settings", action: () => panels.toggle(el.settingsPanel) },
    ],
  });
  el.opacity.addEventListener("input", () => { config.opacity = +el.opacity.value; applyStyle(); save(); });
  el.noReading.addEventListener("change", () => { config.showNoReading = el.noReading.checked; save(); if (lastReport) { render(); resizeWindowToContent(); } });
  el.disconnected.addEventListener("change", () => { config.showDisconnected = el.disconnected.checked; save(); if (lastReport) { render(); resizeWindowToContent(); } });
  el.top.addEventListener("change", () => { config.alwaysOnTop = el.top.checked; save(); applyAlwaysOnTop(config.alwaysOnTop); });
}

panels.add(el.settingsPanel);
applyStyle();
syncSettingsUi();
wire();
applyAlwaysOnTop(config.alwaysOnTop);
showMessage("Reading batteries...");
refresh();
