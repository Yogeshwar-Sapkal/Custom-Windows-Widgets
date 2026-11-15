// Battery widget. Plain ES module, no bundler. Data comes from the Rust side
// (`get_batteries`): this PC's battery plus paired Bluetooth devices.
import {
  T, appWindow, loadConfig, saveConfig, applyOpacity, applyAlwaysOnTop,
  setupChrome, createPanels, createFit,
} from "../../shared/widget.js";
import { buildRows, levelClass } from "./format.js";

const STORAGE_KEY = "battery.config.v1";
const REFRESH_MS = 2 * 60 * 1000;
const RETRY_MS = 30 * 1000;

const DEFAULTS = { size: 15, opacity: 85, alwaysOnTop: false, showNoReading: true, showDisconnected: false };
const config = loadConfig(STORAGE_KEY, DEFAULTS);
const save = () => saveConfig(STORAGE_KEY, config);

const $ = (id) => document.getElementById(id);
const el = {
  card: $("card"), fit: $("fit"), battery: $("battery"), message: $("message"),
  status: $("status"), rows: $("rows"),
  refresh: $("btn-refresh"), settings: $("btn-settings"), close: $("btn-close"),
  settingsPanel: $("settings"),
  size: $("opt-size"), sizeVal: $("size-val"), opacity: $("opt-opacity"),
  noReading: $("opt-noreading"), disconnected: $("opt-disconnected"), top: $("opt-top"),
};

const panels = createPanels(el.settingsPanel);
let hasData = false;
let lastReport = null;
let lastUpdated = 0;
const { fit, resizeWindowToContent } = createFit({ fitEl: el.fit, contentEl: el.battery, hasContent: () => hasData });

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
  el.status.className = "note" + (report.error ? " warn" : "");
  el.status.textContent = report.error ? "Bluetooth scan failed - showing this PC only" : "Updated " + clockTime(lastUpdated);

  el.rows.textContent = "";
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "row" + (r.dim ? " dim" : "");
    row.innerHTML =
      '<div class="ico"></div><div class="info"><div class="name"></div><div class="sub"></div></div>' +
      '<div class="level"><div class="bar"><i></i></div><div class="pct"></div></div>';
    row.querySelector(".ico").textContent = r.icon;
    row.querySelector(".name").textContent = r.name;
    row.querySelector(".name").title = r.name;
    row.querySelector(".sub").textContent = r.sub;
    const bar = row.querySelector(".bar");
    const pct = row.querySelector(".pct");
    if (r.percent == null) {
      row.classList.add("noread");
      bar.style.display = "none";
      pct.textContent = "-";
      pct.className = "pct none";
    } else {
      bar.className = "bar " + levelClass(r.percent);
      bar.firstChild.style.width = r.percent + "%";
      pct.textContent = r.percent + "%";
    }
    el.rows.appendChild(row);
  }
  resizeWindowToContent();
}

let timer = null;
let inFlight = false;
function schedule(ms) { clearTimeout(timer); timer = setTimeout(refresh, ms); }

async function refresh() {
  if (!(T && T.core)) { lastReport = { supported: false, devices: [] }; render(); return; }
  if (inFlight) return;
  inFlight = true;
  el.refresh.disabled = true;
  try {
    lastReport = await T.core.invoke("get_batteries");
    lastUpdated = Date.now();
    render();
    schedule(REFRESH_MS);
  } catch (_) {
    if (lastReport) { el.status.className = "note warn"; el.status.textContent = "Couldn't refresh - showing earlier data"; }
    else showMessage("Couldn't read battery information.");
    schedule(RETRY_MS);
  } finally {
    inFlight = false;
    el.refresh.disabled = false;
  }
}

function applyStyle() {
  document.documentElement.style.setProperty("--size", config.size + "px");
  applyOpacity(config.opacity);
}

function syncSettingsUi() {
  el.size.value = config.size;
  el.sizeVal.textContent = config.size + " px";
  el.opacity.value = config.opacity;
  el.noReading.checked = config.showNoReading;
  el.disconnected.checked = config.showDisconnected;
  el.top.checked = config.alwaysOnTop;
}

function wire() {
  setupChrome({ card: el.card, closeButton: el.close, onBackgroundPress: panels.closeAll });
  el.refresh.addEventListener("click", () => { schedule(REFRESH_MS); refresh(); });
  el.settings.addEventListener("click", () => panels.toggle(el.settingsPanel));
  el.size.addEventListener("input", () => { config.size = +el.size.value; el.sizeVal.textContent = config.size + " px"; applyStyle(); save(); fit(); });
  el.size.addEventListener("change", () => resizeWindowToContent());
  el.opacity.addEventListener("input", () => { config.opacity = +el.opacity.value; applyStyle(); save(); });
  el.noReading.addEventListener("change", () => { config.showNoReading = el.noReading.checked; save(); if (lastReport) render(); });
  el.disconnected.addEventListener("change", () => { config.showDisconnected = el.disconnected.checked; save(); if (lastReport) render(); });
  el.top.addEventListener("change", () => { config.alwaysOnTop = el.top.checked; save(); applyAlwaysOnTop(config.alwaysOnTop); });
}

applyStyle();
syncSettingsUi();
wire();
applyAlwaysOnTop(config.alwaysOnTop);
showMessage("Reading batteries...");
refresh();
