// World Clock widget front end. Plain JS, no build step.
(() => {
  "use strict";

  const MAX_CLOCKS = 4;
  const PADDING = 14; // keep in sync with #fit padding in styles.css
  const STORAGE_KEY = "worldclock.config.v1";

  // ---- Tauri bridge (absent when opened in a plain browser) -------------
  const T = window.__TAURI__;
  const appWindow = T && T.window ? T.window.getCurrentWindow() : null;

  // ---- Zones -------------------------------------------------------------
  const ZONES = window.ZONES || [];
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

  function zoneFor(id) {
    if (zoneById.has(id)) return zoneById.get(id);
    const city = id.split("/").pop().replace(/_/g, " ");
    return { id, city, country: "" };
  }

  // ---- Config ------------------------------------------------------------
  const DEFAULTS = {
    clocks: null, // null = first launch, seeded with the local zone
    layout: "column",
    size: 48,
    opacity: 85,
    hour24: true,
    seconds: false,
    offset: false,
    level: "desktop", // desktop | normal | top
  };

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (_) { /* storage unavailable */ }
    return { ...DEFAULTS };
  }

  const config = loadConfig();
  if (!Array.isArray(config.clocks)) {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    config.clocks = local ? [canonical(local)] : [];
  }
  config.clocks = config.clocks.filter((id, i, a) => a.indexOf(id) === i).slice(0, MAX_CLOCKS);

  function saveConfig() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch (_) { /* ignore */ }
  }

  // ---- Elements ----------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const el = {
    card: $("card"), fit: $("fit"), clocks: $("clocks"), empty: $("empty"),
    add: $("btn-add"), settings: $("btn-settings"), close: $("btn-close"),
    searchPanel: $("search"), searchInput: $("search-input"), searchResults: $("search-results"),
    settingsPanel: $("settings"),
    layout: $("opt-layout"), size: $("opt-size"), sizeVal: $("size-val"), opacity: $("opt-opacity"),
    h24: $("opt-24h"), seconds: $("opt-seconds"), offset: $("opt-offset"),
    level: $("opt-level"), autostart: $("opt-autostart"),
  };

  // ---- Time formatting ---------------------------------------------------
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
      date: new Intl.DateTimeFormat(undefined, { timeZone: zoneId, weekday: "short", day: "numeric", month: "short" }),
      numeric: new Intl.DateTimeFormat("en-US", {
        timeZone: zoneId, hourCycle: "h23",
        year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
      }),
    };
    fmtCache.set(key, f);
    return f;
  }

  function zoneOffsetMinutes(numericFmt, now) {
    const p = {};
    for (const part of numericFmt.formatToParts(now)) p[part.type] = part.value;
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUtc - Math.floor(now.getTime() / 1000) * 1000) / 60000);
  }

  function zoneHour(numericFmt, now) {
    const part = numericFmt.formatToParts(now).find((x) => x.type === "hour");
    return part ? +part.value % 24 : 12;
  }

  function offsetText(diffMin) {
    if (diffMin === 0) return "same time as local";
    const sign = diffMin > 0 ? "+" : "−";
    const abs = Math.abs(diffMin);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return sign + h + "h" + (m ? String(m).padStart(2, "0") : "");
  }

  const SUN = '<svg class="sun" viewBox="0 0 24 24" fill="currentColor" aria-label="Day"><circle cx="12" cy="12" r="4.5"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></g></svg>';
  const MOON = '<svg class="moon" viewBox="0 0 24 24" fill="currentColor" aria-label="Night"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>';

  // ---- Rendering ---------------------------------------------------------
  let nodes = []; // [{ id, time, sub, icon, lastIcon }]

  function renderClocks() {
    el.clocks.className = config.layout;
    el.clocks.textContent = "";
    nodes = config.clocks.map((id) => {
      const zone = zoneFor(id);
      const root = document.createElement("div");
      root.className = "clock";
      root.innerHTML =
        '<div class="top"><span class="icon"></span><span class="city"></span>' +
        '<button class="remove" title="Remove clock" aria-label="Remove clock">&times;</button></div>' +
        '<div class="time"></div><div class="sub"></div>';
      root.querySelector(".city").textContent = zone.city + (zone.country ? ", " + zone.country : "");
      root.title = zone.id;
      el.clocks.appendChild(root);
      return {
        id, time: root.querySelector(".time"), sub: root.querySelector(".sub"),
        icon: root.querySelector(".icon"), lastIcon: "",
      };
    });
    el.empty.hidden = config.clocks.length > 0;
    el.add.disabled = config.clocks.length >= MAX_CLOCKS;
    el.add.title = el.add.disabled ? "Maximum of " + MAX_CLOCKS + " clocks" : "Add clock";
    tick();
  }

  function tick() {
    const now = new Date();
    const localOffset = -now.getTimezoneOffset();
    for (const n of nodes) {
      const f = formatters(n.id);
      const parts = f.time.formatToParts(now);
      const period = parts.find((p) => p.type === "dayPeriod");
      const main = parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim();
      const timeHtml = period ? main + "<small>" + period.value.toUpperCase() + "</small>" : main;
      if (n.time.dataset.v !== timeHtml) { n.time.dataset.v = timeHtml; n.time.innerHTML = timeHtml; }

      let sub = f.date.format(now);
      if (config.offset) sub += " · " + offsetText(zoneOffsetMinutes(f.numeric, now) - localOffset);
      if (n.sub.textContent !== sub) n.sub.textContent = sub;

      const h = zoneHour(f.numeric, now);
      const day = h >= 6 && h < 18;
      const iconKey = day ? "sun" : "moon";
      if (n.lastIcon !== iconKey) { n.lastIcon = iconKey; n.icon.innerHTML = day ? SUN : MOON; }
    }
  }

  function scheduleTick() {
    tick();
    setTimeout(scheduleTick, 1000 - (Date.now() % 1000) + 5);
  }

  // ---- Fit: scale the layout to the window -------------------------------
  function naturalSize() {
    el.clocks.style.transform = "none";
    return { w: el.clocks.offsetWidth, h: el.clocks.offsetHeight };
  }

  function fit() {
    if (!config.clocks.length) { el.clocks.style.transform = "none"; return; }
    const nat = naturalSize();
    const availW = el.fit.clientWidth - PADDING * 2;
    const availH = el.fit.clientHeight - PADDING * 2;
    if (!nat.w || !nat.h || availW <= 0 || availH <= 0) return;
    const scale = Math.min(availW / nat.w, availH / nat.h);
    el.clocks.style.transform = "scale(" + scale + ")";
  }

  // Resize the window to the natural size of the content (scale 1).
  async function resizeWindowToContent() {
    if (!appWindow || !config.clocks.length || !T.dpi) { fit(); return; }
    const nat = naturalSize();
    try {
      await appWindow.setSize(new T.dpi.LogicalSize(nat.w + PADDING * 2, nat.h + PADDING * 2));
    } catch (_) { /* ignore */ }
    fit();
  }

  // ---- Applying config ---------------------------------------------------
  function applyStyle() {
    document.documentElement.style.setProperty("--size", config.size + "px");
    document.documentElement.style.setProperty("--opacity", String(config.opacity / 100));
  }

  // Window level: "desktop" keeps the widget behind every other window.
  async function applyLevel() {
    if (!appWindow) return;
    const level = config.level;
    try {
      if (level === "top") {
        await appWindow.setAlwaysOnBottom(false);
        await appWindow.setAlwaysOnTop(true);
      } else if (level === "desktop") {
        await appWindow.setAlwaysOnTop(false);
        await appWindow.setAlwaysOnBottom(true);
      } else {
        await appWindow.setAlwaysOnTop(false);
        await appWindow.setAlwaysOnBottom(false);
      }
    } catch (_) { /* ignore */ }
  }

  function reflow(resizeWindow) {
    renderClocks();
    if (resizeWindow) resizeWindowToContent(); else fit();
  }

  // ---- Add / remove clocks ----------------------------------------------
  function addClock(id) {
    if (config.clocks.length >= MAX_CLOCKS || config.clocks.includes(id)) return;
    config.clocks.push(id);
    saveConfig();
    closePanels();
    reflow(true);
  }

  function removeClock(id) {
    config.clocks = config.clocks.filter((c) => c !== id);
    saveConfig();
    reflow(true);
  }

  // ---- Search ------------------------------------------------------------
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

  // ---- Panels ------------------------------------------------------------
  function closePanels() {
    el.searchPanel.hidden = true;
    el.settingsPanel.hidden = true;
  }

  function openSearch() {
    if (config.clocks.length >= MAX_CLOCKS) return;
    const wasOpen = !el.searchPanel.hidden;
    closePanels();
    if (wasOpen) return;
    el.searchPanel.hidden = false;
    el.searchInput.value = "";
    runSearch();
    el.searchInput.focus();
  }

  function openSettings() {
    const wasOpen = !el.settingsPanel.hidden;
    closePanels();
    if (!wasOpen) el.settingsPanel.hidden = false;
  }

  // ---- Wiring ------------------------------------------------------------
  function syncSettingsUi() {
    el.layout.value = config.layout;
    el.size.value = config.size;
    el.sizeVal.textContent = config.size + " px";
    el.opacity.value = config.opacity;
    el.h24.checked = config.hour24;
    el.seconds.checked = config.seconds;
    el.offset.checked = config.offset;
    el.level.value = config.level;
  }

  function wire() {
    el.add.addEventListener("click", openSearch);
    el.settings.addEventListener("click", openSettings);
    el.close.addEventListener("click", () => { if (appWindow) appWindow.close(); else window.close(); });

    el.searchInput.addEventListener("input", runSearch);
    el.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { active = Math.min(results.length - 1, active + 1); renderResults(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); renderResults(); e.preventDefault(); }
      else if (e.key === "Enter" && results[active]) addClock(results[active].id);
      else if (e.key === "Escape") closePanels();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanels(); });

    el.layout.addEventListener("change", () => { config.layout = el.layout.value; saveConfig(); reflow(true); });
    el.size.addEventListener("input", () => {
      config.size = +el.size.value; el.sizeVal.textContent = config.size + " px";
      applyStyle(); saveConfig(); fit();
    });
    el.size.addEventListener("change", () => resizeWindowToContent());
    el.opacity.addEventListener("input", () => { config.opacity = +el.opacity.value; applyStyle(); saveConfig(); });
    el.h24.addEventListener("change", () => { config.hour24 = el.h24.checked; saveConfig(); reflow(true); });
    el.seconds.addEventListener("change", () => { config.seconds = el.seconds.checked; saveConfig(); reflow(true); });
    el.offset.addEventListener("change", () => { config.offset = el.offset.checked; saveConfig(); reflow(true); });
    el.level.addEventListener("change", () => { config.level = el.level.value; saveConfig(); applyLevel(); });
    // Clicking the widget raises it; drop it back behind other windows when focus moves away.
    if (appWindow && appWindow.onFocusChanged) {
      appWindow.onFocusChanged(({ payload: focused }) => {
        if (!focused && config.level === "desktop") applyLevel();
      }).catch(() => {});
    }

    if (T && T.autostart) {
      T.autostart.isEnabled().then((on) => { el.autostart.checked = on; }).catch(() => {});
      el.autostart.addEventListener("change", () => {
        (el.autostart.checked ? T.autostart.enable() : T.autostart.disable()).catch(() => {});
      });
    } else {
      el.autostart.disabled = true;
    }

    // Each clock has its own hover "x" to remove it.
    el.clocks.addEventListener("click", (e) => {
      const btn = e.target.closest(".remove");
      if (!btn) return;
      const i = [...el.clocks.children].indexOf(btn.closest(".clock"));
      if (i >= 0) removeClock(config.clocks[i]);
    });

    // Drag the window by its background; click outside panels closes them.
    el.card.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("button, input, select, .panel, .remove")) return;
      closePanels();
      if (appWindow) appWindow.startDragging().catch(() => {});
    });

    new ResizeObserver(fit).observe(el.fit);
  }

  // ---- Start -------------------------------------------------------------
  applyStyle();
  syncSettingsUi();
  wire();
  applyLevel();
  renderClocks();
  requestAnimationFrame(() => (appWindow ? resizeWindowToContent() : fit()));
  scheduleTick();
})();
