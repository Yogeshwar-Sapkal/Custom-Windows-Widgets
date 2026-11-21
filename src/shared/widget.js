// Code shared by every widget window. Plain ES module, no bundler.

export const T = window.__TAURI__;
export const appWindow = T && T.window ? T.window.getCurrentWindow() : null;
export const PADDING = 14; // keep in sync with #fit padding in widget.css
export const BORDER = 1;   // keep in sync with the #card border in widget.css
/** Extra window size around the content: padding plus the card's border on both sides. */
export const WINDOW_EXTRA = PADDING * 2 + BORDER * 2;

// ---- Saved settings (one localStorage key per widget) ------------------
export function loadConfig(key, defaults) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch (_) { /* storage unavailable */ }
  return { ...defaults };
}

export function saveConfig(key, config) {
  try { localStorage.setItem(key, JSON.stringify(config)); } catch (_) { /* ignore */ }
}

// ---- Look --------------------------------------------------------------
export function applyOpacity(percent) {
  document.documentElement.style.setProperty("--opacity", String(percent / 100));
}

export async function applyAlwaysOnTop(on) {
  if (appWindow) { try { await appWindow.setAlwaysOnTop(!!on); } catch (_) { /* ignore */ } }
}

// ---- Panels (menu, settings, forms): only one open at a time -----------
// A panel with a data-title gets a header with a "Done" button (data-done changes its label),
// so a touch-only user never needs Esc or a precise tap outside to close it.
export function createPanels(...initial) {
  const panels = [];
  const closeAll = () => panels.forEach((p) => { p.hidden = true; });
  const toggle = (panel) => {
    const wasOpen = !panel.hidden;
    closeAll();
    if (!wasOpen) panel.hidden = false;
    return !wasOpen;
  };
  const add = (panel) => {
    panels.push(panel);
    if (panel.dataset.title !== undefined && !panel.querySelector(":scope > .panel-head")) {
      const head = document.createElement("div");
      head.className = "panel-head";
      const title = document.createElement("strong");
      title.textContent = panel.dataset.title;
      const done = document.createElement("button");
      done.type = "button";
      done.className = "btn primary";
      done.textContent = panel.dataset.done || "Done";
      done.addEventListener("click", closeAll);
      head.append(title, done);
      panel.prepend(head);
    }
  };
  initial.forEach(add);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
  return { closeAll, toggle, add };
}

// ---- Window chrome: one labelled menu, drag by background, hide to tray --
const HIDE_HINT_KEY = "widgets.hide-hint-seen.v1";
const DRAG_THRESHOLD = 6; // px a pointer must move before a press becomes a window drag

function hideNow() {
  if (T && T.core && appWindow) T.core.invoke("hide_widget", { label: appWindow.label }).catch(() => {});
  else window.close();
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/**
 * Adds the widget's menu button (always visible, 44 px) and its menu, wires dragging, and
 * returns helpers. `items` are { id, label, action }; "Hide widget" is always added last.
 * The first time someone hides a widget they are told how to bring it back.
 */
export function mountChrome({ card, panels, items = [], name = "this widget" }) {
  const menuButton = el("button", { id: "btn-menu", type: "button", className: "menu-btn", textContent: "⋯", title: "Menu" });
  menuButton.setAttribute("aria-label", "Widget menu");
  menuButton.setAttribute("aria-haspopup", "menu");
  card.append(el("div", { id: "controls" }, [menuButton]));

  const menu = el("section", { id: "menu", className: "panel menu", hidden: true });
  menu.setAttribute("role", "menu");
  for (const it of [...items, { id: "hide", label: "Hide widget" }]) {
    const b = el("button", { type: "button", textContent: it.label });
    b.dataset.id = it.id;
    b.setAttribute("role", "menuitem");
    menu.append(b);
  }

  const hint = el("section", { id: "hide-hint", className: "panel hint", hidden: true });
  const cancel = el("button", { type: "button", className: "btn", textContent: "Cancel" });
  const confirm = el("button", { type: "button", className: "btn primary", textContent: "Hide" });
  hint.append(
    el("p", { textContent: "Hide " + name + "? It keeps running in the background. To show it again, click the ^ arrow near the clock on the taskbar, then the widgets icon, and tick " + name + "." }),
    el("div", { className: "actions" }, [cancel, confirm]),
  );
  card.append(menu, hint);
  panels.add(menu);
  panels.add(hint);

  const seenHint = () => { try { return localStorage.getItem(HIDE_HINT_KEY) === "1"; } catch (_) { return true; } };
  const rememberHint = () => { try { localStorage.setItem(HIDE_HINT_KEY, "1"); } catch (_) { /* ignore */ } };
  menuButton.addEventListener("click", () => panels.toggle(menu));
  cancel.addEventListener("click", panels.closeAll);
  confirm.addEventListener("click", () => { rememberHint(); panels.closeAll(); hideNow(); });
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    panels.closeAll();
    if (b.dataset.id === "hide") {
      if (seenHint()) hideNow(); else panels.toggle(hint);
    } else {
      const item = items.find((i) => i.id === b.dataset.id);
      if (item) item.action();
    }
  });

  // Drag the window by its background, but only once the pointer actually moves, so a plain
  // tap on a clock, a day or a row still works. Touch has no hover, so nothing depends on it.
  let press = null;
  card.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button, input, select, textarea, a, label, .panel, .no-drag")) return;
    panels.closeAll();
    press = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  card.addEventListener("pointermove", (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
    press = null;
    if (appWindow) appWindow.startDragging().catch(() => {});
  });
  const endPress = () => { press = null; };
  card.addEventListener("pointerup", endPress);
  card.addEventListener("pointercancel", endPress);
  // A long press must not open the browser's own context menu (Back / Reload ...).
  card.addEventListener("contextmenu", (e) => { if (!e.target.closest("input, textarea")) e.preventDefault(); });

  // Tell the tray menu this window exists so its checkmark matches reality.
  if (T && T.core) T.core.invoke("sync_tray").catch(() => {});
  return { menuButton, closeMenu: panels.closeAll };
}

// ---- Size presets (Small / Medium / Large ...) and other segmented choices ----
/**
 * Fills `container` with one button per option and returns { set(value) }.
 * For numeric values the nearest option is highlighted, so an older custom size still shows.
 */
export function bindSegmented(container, options, onChange) {
  container.classList.add("seg");
  container.setAttribute("role", "radiogroup");
  const buttons = options.map((o) => {
    const b = el("button", { type: "button", textContent: o.label });
    b.dataset.value = String(o.value);
    b.setAttribute("role", "radio");
    b.addEventListener("click", () => { set(o.value); onChange(o.value); });
    container.append(b);
    return { b, value: o.value };
  });
  function set(value) {
    let best = buttons[0];
    if (typeof value === "number") {
      for (const x of buttons) if (Math.abs(x.value - value) < Math.abs(best.value - value)) best = x;
    } else {
      best = buttons.find((x) => x.value === value) || best;
    }
    for (const x of buttons) x.b.setAttribute("aria-checked", String(x === best));
  }
  return { set };
}

// ---- Fit: scale content to the window, size the window to content -----
// The window keeps whatever size the user gives it. It is sized to its content only
//  - the first time it ever has content (`autoSizeOnce`), and
//  - when the user changes a setting that changes the content's size (`resizeWindowToContent`).
// Data refreshes and app launches must never call `resizeWindowToContent`, or they would
// overwrite the size the user chose (and the size Tauri restores at launch).
export function createFit({ fitEl, contentEl, hasContent = () => true, sizedKey = null }) {
  function natural() {
    contentEl.style.transform = "none";
    return { w: contentEl.offsetWidth, h: contentEl.offsetHeight };
  }

  function fit() {
    if (!hasContent()) { contentEl.style.transform = "none"; return; }
    const nat = natural();
    const availW = fitEl.clientWidth - PADDING * 2;
    const availH = fitEl.clientHeight - PADDING * 2;
    if (!nat.w || !nat.h || availW <= 0 || availH <= 0) return;
    contentEl.style.transform = "scale(" + Math.min(availW / nat.w, availH / nat.h) + ")";
  }

  // Resize the window to the content's natural size (scale 1).
  async function resizeWindowToContent() {
    if (!appWindow || !hasContent() || !T.dpi) { fit(); return; }
    const nat = natural();
    try {
      await appWindow.setSize(new T.dpi.LogicalSize(nat.w + WINDOW_EXTRA, nat.h + WINDOW_EXTRA));
    } catch (_) { /* ignore */ }
    fit();
  }

  const wasSized = () => { try { return !!sizedKey && localStorage.getItem(sizedKey) === "1"; } catch (_) { return false; } };
  const markSized = () => { try { if (sizedKey) localStorage.setItem(sizedKey, "1"); } catch (_) { /* ignore */ } };

  // Safe to call after every render or at launch: sizes the window to its content only once.
  async function autoSizeOnce() {
    if (!appWindow || !hasContent() || wasSized()) { fit(); return; }
    await resizeWindowToContent();
    markSized();
  }

  // Re-fit when the window changes size and also when the content does (a line appears,
  // fonts finish loading). fit() only changes the transform, so this cannot loop.
  const observer = new ResizeObserver(fit);
  observer.observe(fitEl);
  observer.observe(contentEl);
  return { fit, resizeWindowToContent, autoSizeOnce };
}
