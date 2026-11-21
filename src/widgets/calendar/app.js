// Calendar widget. Plain ES module, no bundler. All rules live in model.js (tested); this file is
// the screen: month grid, agenda, entry form, settings and backup.
import {
  loadConfig, saveConfig, applyOpacity, applyAlwaysOnTop,
  mountChrome, createPanels, bindSegmented,
} from "../../shared/widget.js";
import * as M from "./model.js";
import { createStore } from "./store.js";

const STORAGE_KEY = "calendar.config.v1";
const SIZES = [{ label: "Small", value: 13 }, { label: "Medium", value: 15 }, { label: "Large", value: 18 }, { label: "Extra large", value: 22 }];
const WEEK_STARTS = [{ label: "Auto", value: "auto" }, { label: "Mon", value: "1" }, { label: "Sun", value: "0" }, { label: "Sat", value: "6" }];
const COLOUR_NAMES = ["Blue", "Green", "Amber", "Red", "Purple", "Teal"];
const REPEAT_NAMES = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
const SWIPE_MIN = 50; // px

const DEFAULTS = { size: 15, opacity: 85, alwaysOnTop: false, weekStart: "auto", weekNumbers: false, hour24: true };
const config = loadConfig(STORAGE_KEY, DEFAULTS);
const saveSettings = () => saveConfig(STORAGE_KEY, config);
const locale = navigator.language || "en";

const $ = (id) => document.getElementById(id);
const el = {
  card: $("card"), calendar: $("calendar"), banner: $("banner"),
  prev: $("prev"), next: $("next"), today: $("btn-today"), title: $("month-title"),
  weekdays: $("weekdays"), grid: $("grid"), agendaTitle: $("agenda-title"), add: $("btn-add"), agenda: $("agenda"),
  form: $("form"), formTitle: $("form-title"), formCancel: $("form-cancel"), formSave: $("form-save"), formDelete: $("form-delete"),
  fKind: $("f-kind"), fTitle: $("f-title"), fDate: $("f-date"), fHasTime: $("f-has-time"), timeField: $("time-field"), fTime: $("f-time"),
  moreToggle: $("more-toggle"), more: $("more"), multiRow: $("multi-row"), fMulti: $("f-multi"), endDateField: $("enddate-field"),
  fEndDate: $("f-enddate"), endTimeField: $("endtime-field"), fEndTime: $("f-endtime"), fLocation: $("f-location"), fColour: $("f-colour"),
  fRepeat: $("f-repeat"), repeatNote: $("repeat-note"), untilRow: $("until-row"), fUntilSw: $("f-until-sw"), untilField: $("until-field"), fUntil: $("f-until"),
  confirm: $("confirm"), confirmText: $("confirm-text"), confirmNo: $("confirm-no"), confirmYes: $("confirm-yes"),
  settings: $("settings"), optSize: $("opt-size"), optOpacity: $("opt-opacity"), optWeekStart: $("opt-weekstart"),
  optWeekNums: $("opt-weeknums"), opt24h: $("opt-24h"), optTop: $("opt-top"), btnExport: $("btn-export"), btnImport: $("btn-import"),
  toast: $("toast"), toastText: $("toast-text"), toastAction: $("toast-action"),
};

// ---- State -----------------------------------------------------------
const store = createStore();
let entries = [];
let canSave = false; // only after the saved entries were read successfully, so we never overwrite what we couldn't read
let today = M.localDate();
let selected = null; // a day the user tapped, or null for the default "coming up" agenda
let view = { year: M.parts(today).year, month: M.parts(today).month };
const panels = createPanels();

function localWeekStart() {
  try {
    const l = new Intl.Locale(locale);
    const info = typeof l.getWeekInfo === "function" ? l.getWeekInfo() : l.weekInfo;
    if (info && info.firstDay) return info.firstDay % 7; // 1 = Monday ... 7 = Sunday
  } catch (_) { /* older engine */ }
  return 1;
}
const weekStart = () => (config.weekStart === "auto" ? localWeekStart() : Number(config.weekStart));
const utcDate = (ymd) => new Date(M.toDayNumber(ymd) * 86400000);
const fmt = (ymd, opts) => utcDate(ymd).toLocaleDateString(locale, { ...opts, timeZone: "UTC" });

// ---- Saving ----------------------------------------------------------
let saveChain = Promise.resolve();
function persist() {
  if (!canSave) return;
  const snapshot = entries;
  saveChain = saveChain
    .then(() => store.save(snapshot))
    .catch(() => showToast("Couldn't save your changes. They may be lost if you close the widget.", { ms: 12000 }));
}

// ---- Small UI helpers ------------------------------------------------
let toastTimer = null;
function hideToast() { clearTimeout(toastTimer); el.toast.hidden = true; }
function showToast(text, { action = null, onAction = null, ms = 6000 } = {}) {
  clearTimeout(toastTimer);
  el.toastText.textContent = text;
  el.toastAction.hidden = !action;
  if (action) el.toastAction.textContent = action;
  el.toastAction.onclick = () => { hideToast(); if (onAction) onAction(); };
  el.toast.hidden = false;
  toastTimer = setTimeout(hideToast, ms);
}

/** Ask before something that isn't a single-tap undo. Resolves true for OK. */
function confirmDialog(text, okLabel) {
  return new Promise((resolve) => {
    panels.closeAll();
    el.confirmText.textContent = text;
    el.confirmYes.textContent = okLabel;
    el.confirm.hidden = false;
    const done = (value) => { el.confirm.hidden = true; el.confirmYes.onclick = el.confirmNo.onclick = null; resolve(value); };
    el.confirmYes.onclick = () => done(true);
    el.confirmNo.onclick = () => done(false);
  });
}

function showBanner(text) { el.banner.textContent = text; el.banner.hidden = false; }

// ---- Month grid ------------------------------------------------------
function renderNav() {
  el.title.textContent = fmt(view.year + "-" + String(view.month).padStart(2, "0") + "-01", { month: "long", year: "numeric" });
}

function renderGrid() {
  const ws = weekStart();
  const cells = M.monthGrid(view.year, view.month, ws);
  el.calendar.classList.toggle("weeknums", !!config.weekNumbers);

  el.weekdays.textContent = "";
  if (config.weekNumbers) el.weekdays.append(document.createElement("span"));
  for (let i = 0; i < 7; i++) {
    const span = document.createElement("span");
    span.textContent = fmt(cells[i].date, { weekday: "short" });
    el.weekdays.append(span);
  }

  el.grid.textContent = "";
  for (let row = 0; row < 6; row++) {
    if (config.weekNumbers) {
      const wk = document.createElement("span");
      wk.className = "wk";
      wk.textContent = String(M.isoWeekNumber(cells[row * 7 + 3].date));
      wk.title = "Week " + wk.textContent;
      el.grid.append(wk);
    }
    for (let col = 0; col < 7; col++) {
      const c = cells[row * 7 + col];
      const sum = M.daySummary(entries, c.date);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cell" + (c.inMonth ? "" : " other") + (c.date === today ? " today" : "") + (c.date === selected ? " selected" : "");
      b.dataset.date = c.date;
      b.setAttribute("role", "gridcell");
      b.setAttribute("aria-pressed", String(c.date === selected));
      if (c.date === today) b.setAttribute("aria-current", "date");
      b.setAttribute("aria-label", fmt(c.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) +
        (sum.count ? ", " + sum.count + (sum.count === 1 ? " entry" : " entries") : ""));
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(c.day);
      const dots = document.createElement("span");
      dots.className = "dots";
      for (const d of sum.dots) {
        const dot = document.createElement("i");
        dot.className = "dot" + (d.done ? " done" : "");
        dot.style.setProperty("--cc", "var(--c" + d.colour + ")");
        dots.append(dot);
      }
      if (sum.more) { const more = document.createElement("span"); more.className = "more"; more.textContent = "+"; dots.append(more); }
      b.append(num, dots);
      el.grid.append(b);
    }
  }
}

// ---- Agenda ----------------------------------------------------------
function daysBetween(a, b) { return M.toDayNumber(b) - M.toDayNumber(a); }

function itemElement(item, date, { overdue = false } = {}) {
  const { entry, start, firstDay, done } = item;
  const root = document.createElement("div");
  root.className = "item" + (entry.kind === "todo" ? " todo" : "") + (done ? " done" : "") + (date < today ? " past" : "") + (overdue ? " overdue" : "");
  root.style.setProperty("--cc", "var(--c" + entry.colour + ")");

  if (entry.kind === "todo") {
    const tick = document.createElement("button");
    tick.type = "button";
    tick.className = "tick";
    tick.dataset.id = entry.id;
    tick.dataset.start = start;
    tick.setAttribute("aria-pressed", String(done));
    tick.setAttribute("aria-label", (done ? "Done: " : "Mark done: ") + entry.title);
    const box = document.createElement("span");
    box.className = "box";
    box.textContent = done ? "✓" : "";
    tick.append(box);
    root.append(tick);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "spacer";
    spacer.append(document.createElement("i"));
    root.append(spacer);
  }

  const body = document.createElement("button");
  body.type = "button";
  body.className = "body";
  body.dataset.id = entry.id;
  body.setAttribute("aria-label", "Edit " + entry.title);

  const time = document.createElement("span");
  time.className = "time";
  if (firstDay) time.textContent = M.timeLabel(entry, config.hour24);
  else time.textContent = "Day " + (daysBetween(start, date) + 1) + " of " + (daysBetween(entry.date, entry.endDate) + 1);

  const text = document.createElement("span");
  text.className = "text";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = entry.title;
  text.append(title);
  const subParts = [entry.location && "📍 " + entry.location, REPEAT_NAMES[entry.repeat.freq] && "↻ " + REPEAT_NAMES[entry.repeat.freq]].filter(Boolean);
  if (subParts.length) {
    const sub = document.createElement("span");
    sub.className = "sub";
    sub.textContent = subParts.join(" · ");
    text.append(sub);
  }
  if (overdue) {
    const due = document.createElement("span");
    due.className = "sub due";
    due.textContent = "Was due " + M.dayHeading(start, today, locale);
    text.append(due);
  }
  body.append(time, text);
  root.append(body);
  return root;
}

function renderAgenda() {
  const a = M.buildAgenda(entries, today, { selected });
  el.agendaTitle.textContent = selected ? fmt(selected, { weekday: "long", day: "numeric", month: "long" }) : "Coming up";
  const scroll = el.agenda.scrollTop;
  el.agenda.textContent = "";

  if (a.overdue.length) {
    const g = document.createElement("div");
    g.className = "group overdue";
    const h = document.createElement("h4");
    h.textContent = "Overdue (" + a.overdue.length + ")";
    g.append(h);
    for (const item of a.overdue) g.append(itemElement(item, item.start, { overdue: true }));
    el.agenda.append(g);
  }
  let shown = a.overdue.length;
  for (const group of a.groups) {
    if (!group.items.length) continue;
    shown += group.items.length;
    const g = document.createElement("div");
    g.className = "group";
    if (!a.selected) {
      const h = document.createElement("h4");
      h.textContent = M.dayHeading(group.date, today, locale);
      g.append(h);
    }
    for (const item of group.items) g.append(itemElement(item, group.date));
    el.agenda.append(g);
  }
  if (!shown) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = a.selected ? "Nothing planned for this day. Tap + Add to plan something." : "Nothing planned. Tap a day, then + Add.";
    el.agenda.append(empty);
  }
  el.agenda.scrollTop = scroll;
}

function renderAll() { renderNav(); renderGrid(); renderAgenda(); }

// ---- Navigating ------------------------------------------------------
function goToMonth(delta) { view = M.shiftMonth(view.year, view.month, delta); renderAll(); }

function goToToday() {
  today = M.localDate();
  view = { year: M.parts(today).year, month: M.parts(today).month };
  selected = null;
  renderAll();
}

function selectDay(date) {
  selected = selected === date ? null : date; // tap again to go back to "coming up"
  const p = M.parts(date);
  if (p.year !== view.year || p.month !== view.month) view = { year: p.year, month: p.month };
  renderAll();
}

// ---- The entry form --------------------------------------------------
const form = { editing: null, kind: "event", colour: 0, moreOpen: false };
const kindPicker = bindSegmented(el.fKind, [{ label: "Event", value: "event" }, { label: "To-do", value: "todo" }], (v) => { form.kind = v; syncForm(); });

const swatches = COLOUR_NAMES.map((name, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "swatch";
  b.style.setProperty("--cc", "var(--c" + i + ")");
  b.setAttribute("role", "radio");
  b.setAttribute("aria-label", name);
  b.addEventListener("click", () => setColour(i));
  el.fColour.append(b);
  return b;
});
function setColour(i) {
  form.colour = i;
  swatches.forEach((b, n) => { b.setAttribute("aria-checked", String(n === i)); b.textContent = n === i ? "✓" : ""; });
}

function setMore(open) {
  form.moreOpen = open;
  el.more.hidden = !open;
  el.moreToggle.setAttribute("aria-expanded", String(open));
  el.moreToggle.textContent = open ? "Fewer options ▴" : "More options ▾";
}

/** Show only the fields that apply to what has been chosen so far. */
function syncForm() {
  const todo = form.kind === "todo";
  const hasTime = el.fHasTime.checked;
  const repeats = el.fRepeat.value !== "none";
  el.timeField.hidden = !hasTime;
  el.endTimeField.hidden = !hasTime;
  el.multiRow.hidden = todo;
  el.endDateField.hidden = todo || !el.fMulti.checked;
  el.untilRow.hidden = !repeats;
  el.untilField.hidden = !repeats || !el.fUntilSw.checked;
  el.repeatNote.hidden = !(form.editing && form.editing.repeat.freq !== "none");
  el.formDelete.hidden = !form.editing;
  el.formTitle.textContent = form.editing ? "Edit entry" : "New entry";
}

function clearErrors() { document.querySelectorAll("#form .error").forEach((e) => { e.hidden = true; e.textContent = ""; }); }
function showErrors(errors) {
  clearErrors();
  const fields = { title: el.fTitle, date: el.fDate, time: el.fTime, endDate: el.fEndDate, endTime: el.fEndTime, until: el.fUntil };
  let first = null;
  for (const key of Object.keys(fields)) {
    if (!errors[key]) continue;
    const box = $("e-" + key);
    box.textContent = errors[key];
    box.hidden = false;
    first = first || fields[key];
  }
  if (first && el.more.contains(first)) setMore(true);
  if (first) first.focus();
}

function openForm(entry, presetDate) {
  panels.closeAll();
  clearErrors();
  form.editing = entry || null;
  const e = entry || {};
  form.kind = e.kind || "event";
  kindPicker.set(form.kind);
  el.fTitle.value = e.title || "";
  el.fDate.value = e.date || presetDate || selected || today;
  el.fHasTime.checked = !!e.time;
  el.fTime.value = e.time || "";
  el.fMulti.checked = !!e.endDate;
  el.fEndDate.value = e.endDate || "";
  el.fEndTime.value = e.endTime || "";
  el.fLocation.value = e.location || "";
  setColour(Number.isInteger(e.colour) ? e.colour : 0);
  el.fRepeat.value = (e.repeat && e.repeat.freq) || "none";
  el.fUntilSw.checked = !!(e.repeat && e.repeat.until);
  el.fUntil.value = (e.repeat && e.repeat.until) || "";
  setMore(!!(e.location || e.endDate || e.endTime || (e.colour > 0) || (e.repeat && e.repeat.freq !== "none")));
  syncForm();
  el.form.hidden = false;
  el.form.scrollTop = 0;
  if (!entry) el.fTitle.focus(); // new entry: the keyboard is what you want next
}

function closeForm() { el.form.hidden = true; form.editing = null; }

function readForm() {
  const hasTime = el.fHasTime.checked;
  const candidate = {
    id: form.editing ? form.editing.id : undefined,
    kind: form.kind,
    title: el.fTitle.value,
    date: el.fDate.value,
    time: hasTime ? el.fTime.value || null : null,
    endDate: form.kind === "event" && el.fMulti.checked ? el.fEndDate.value || "" : null,
    endTime: hasTime ? el.fEndTime.value || null : null,
    location: el.fLocation.value,
    colour: form.colour,
    repeat: { freq: el.fRepeat.value, until: el.fRepeat.value !== "none" && el.fUntilSw.checked ? el.fUntil.value || "" : null },
    done: form.editing ? form.editing.done : [],
  };
  const result = M.validateEntry(candidate);
  // Switches that are on but still empty need their own message (the model treats empty as "not set").
  if (hasTime && !el.fTime.value) result.errors.time = "Pick a time";
  if (candidate.endDate === "") result.errors.endDate = "Pick an end date";
  if (candidate.repeat.until === "") result.errors.until = "Pick a last day";
  result.ok = Object.keys(result.errors).length === 0;
  return result;
}

function saveForm() {
  const { ok, errors, entry } = readForm();
  if (!ok) { showErrors(errors); return; }
  const index = entries.findIndex((e) => e.id === entry.id);
  entries = index >= 0 ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry];
  persist();
  closeForm();
  hideToast();
  // Show the entry straight away: jump to its day, whatever month that is.
  selected = entry.date;
  view = { year: M.parts(entry.date).year, month: M.parts(entry.date).month };
  renderAll();
}

async function deleteEntry() {
  const entry = form.editing;
  if (!entry) return;
  if (entry.repeat.freq !== "none") {
    const yes = await confirmDialog("Delete “" + entry.title + "” and all of its repeats?", "Delete all");
    if (!yes) return;
  }
  removeEntry(entry);
}

function removeEntry(entry) {
  const index = entries.findIndex((e) => e.id === entry.id);
  if (index < 0) return;
  entries = entries.filter((e) => e.id !== entry.id);
  persist();
  closeForm();
  renderAll();
  if (entry.repeat.freq === "none") {
    showToast("Deleted “" + entry.title + "”", {
      action: "Undo",
      onAction: () => { entries = [...entries.slice(0, index), entry, ...entries.slice(index)]; persist(); renderAll(); },
    });
  } else {
    showToast("Deleted “" + entry.title + "” and its repeats", {
      action: "Undo",
      onAction: () => { entries = [...entries.slice(0, index), entry, ...entries.slice(index)]; persist(); renderAll(); },
    });
  }
}

function toggleDone(id, start) {
  entries = entries.map((e) => (e.id === id ? M.toggleDone(e, start) : e));
  persist();
  renderAll();
}

// ---- Settings and backup ---------------------------------------------
function applyStyle() {
  document.documentElement.style.setProperty("--size", config.size + "px");
  applyOpacity(config.opacity);
}

const sizePicker = bindSegmented(el.optSize, SIZES, (v) => { config.size = v; applyStyle(); saveSettings(); });
const weekPicker = bindSegmented(el.optWeekStart, WEEK_STARTS, (v) => { config.weekStart = v; saveSettings(); renderAll(); });

function syncSettingsUi() {
  sizePicker.set(config.size);
  weekPicker.set(config.weekStart);
  el.optOpacity.value = config.opacity;
  el.optWeekNums.checked = !!config.weekNumbers;
  el.opt24h.checked = !!config.hour24;
  el.optTop.checked = !!config.alwaysOnTop;
  const canBackup = store.canBackup();
  el.btnExport.disabled = el.btnImport.disabled = !canBackup;
  el.btnExport.title = el.btnImport.title = canBackup ? "" : "Backups work in the Windows app";
}

async function exportBackup() {
  try { if (await store.exportBackup()) showToast("Backup saved."); }
  catch (e) { showToast("Couldn't save the backup: " + (e && e.message ? e.message : e)); }
}

async function importBackup() {
  let result;
  try { result = await store.chooseBackup(); }
  catch (e) { showToast(typeof e === "string" ? e : e && e.message ? e.message : "Couldn't read that file."); return; }
  if (!result) return; // cancelled
  const n = result.entries.length;
  const skipped = result.dropped ? " (" + result.dropped + " damaged " + (result.dropped === 1 ? "entry" : "entries") + " will be skipped.)" : "";
  const yes = await confirmDialog(
    "Replace your " + entries.length + (entries.length === 1 ? " entry" : " entries") + " with the " + n + (n === 1 ? " entry" : " entries") +
    " in this file?" + skipped + " Your current entries are kept safe first, and you can undo this.", "Replace");
  if (!yes) return;
  const previous = entries;
  entries = result.entries;
  persist();
  selected = null;
  renderAll();
  showToast("Imported " + n + (n === 1 ? " entry." : " entries."), {
    action: "Undo", ms: 10000,
    onAction: () => { entries = previous; persist(); renderAll(); },
  });
}

// ---- Wiring ----------------------------------------------------------
function wire() {
  [el.form, el.confirm, el.settings].forEach(panels.add);
  mountChrome({
    card: el.card, panels, name: "Calendar",
    items: [{ id: "settings", label: "Settings", action: () => panels.toggle(el.settings) }],
  });

  el.prev.addEventListener("click", () => goToMonth(-1));
  el.next.addEventListener("click", () => goToMonth(1));
  el.today.addEventListener("click", goToToday);
  el.add.addEventListener("click", () => openForm(null));

  // Month grid: tap a day, or swipe sideways to change month.
  let swipe = null;
  let lastSwipe = 0;
  el.grid.addEventListener("pointerdown", (e) => { swipe = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
  el.grid.addEventListener("pointerup", (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 2) { lastSwipe = performance.now(); goToMonth(dx < 0 ? 1 : -1); }
  });
  el.grid.addEventListener("pointercancel", () => { swipe = null; });
  el.grid.addEventListener("click", (e) => {
    if (performance.now() - lastSwipe < 400) return; // the click that ends a swipe is not a tap
    const cell = e.target.closest(".cell");
    if (cell) { panels.closeAll(); selectDay(cell.dataset.date); }
  });
  window.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, select, textarea")) return;
    if (e.key === "PageUp") goToMonth(-1); else if (e.key === "PageDown") goToMonth(1);
  });

  // Agenda: tick a to-do, or tap a row to edit it.
  el.agenda.addEventListener("click", (e) => {
    panels.closeAll();
    const tick = e.target.closest(".tick");
    if (tick) { toggleDone(tick.dataset.id, tick.dataset.start); return; }
    const body = e.target.closest(".body");
    if (body) { const entry = entries.find((x) => x.id === body.dataset.id); if (entry) openForm(entry); }
  });

  // Form
  el.formCancel.addEventListener("click", closeForm);
  el.formSave.addEventListener("click", saveForm);
  el.formDelete.addEventListener("click", deleteEntry);
  el.fTitle.addEventListener("keydown", (e) => { if (e.key === "Enter") saveForm(); });
  el.moreToggle.addEventListener("click", () => setMore(!form.moreOpen));
  el.fHasTime.addEventListener("change", () => { if (el.fHasTime.checked && !el.fTime.value) el.fTime.value = "09:00"; syncForm(); });
  el.fMulti.addEventListener("change", () => { if (el.fMulti.checked && !el.fEndDate.value) el.fEndDate.value = M.addDays(el.fDate.value || today, 1); syncForm(); });
  el.fUntilSw.addEventListener("change", syncForm);
  el.fRepeat.addEventListener("change", syncForm);

  // Settings
  el.optOpacity.addEventListener("input", () => { config.opacity = +el.optOpacity.value; applyStyle(); saveSettings(); });
  el.optWeekNums.addEventListener("change", () => { config.weekNumbers = el.optWeekNums.checked; saveSettings(); renderAll(); });
  el.opt24h.addEventListener("change", () => { config.hour24 = el.opt24h.checked; saveSettings(); renderAll(); });
  el.optTop.addEventListener("change", () => { config.alwaysOnTop = el.optTop.checked; saveSettings(); applyAlwaysOnTop(config.alwaysOnTop); });
  el.btnExport.addEventListener("click", exportBackup);
  el.btnImport.addEventListener("click", importBackup);

  // Roll over to the new day without needing a restart.
  const checkDay = () => { const t = M.localDate(); if (t !== today) { today = t; renderAll(); } };
  setInterval(checkDay, 30000);
  document.addEventListener("visibilitychange", checkDay);
  window.addEventListener("focus", checkDay);
}

// ---- Start -----------------------------------------------------------
applyStyle();
syncSettingsUi();
wire();
applyAlwaysOnTop(config.alwaysOnTop);
renderAll();

store.load().then(({ entries: loaded, dropped }) => {
  entries = loaded;
  canSave = true;
  renderAll();
  if (dropped) showToast(dropped + " damaged " + (dropped === 1 ? "entry was" : "entries were") + " skipped while loading.", { ms: 10000 });
}).catch((e) => {
  showBanner("Couldn't read your saved entries, so changes won't be saved until this is fixed. (" + (e && e.message ? e.message : e) + ")");
});
