// Code shared by every widget window. Plain ES module, no bundler.

export const T = window.__TAURI__;
export const appWindow = T && T.window ? T.window.getCurrentWindow() : null;
export const PADDING = 14; // keep in sync with #fit padding in widget.css

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

// ---- Window chrome: drag by background, close = hide to tray ------------
export function setupChrome({ card, closeButton, onBackgroundPress }) {
  closeButton.addEventListener("click", () => {
    if (T && T.core && appWindow) T.core.invoke("hide_widget", { label: appWindow.label }).catch(() => {});
    else window.close();
  });
  card.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button, input, select, a, .panel, .no-drag")) return;
    if (onBackgroundPress) onBackgroundPress();
    if (appWindow) appWindow.startDragging().catch(() => {});
  });
  // Tell the tray menu this window exists so its checkmark matches reality.
  if (T && T.core) T.core.invoke("sync_tray").catch(() => {});
}

// ---- Panels (search / settings): only one open at a time ---------------
export function createPanels(...panels) {
  const closeAll = () => panels.forEach((p) => { p.hidden = true; });
  const toggle = (panel) => {
    const wasOpen = !panel.hidden;
    closeAll();
    if (!wasOpen) panel.hidden = false;
    return !wasOpen;
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
  return { closeAll, toggle };
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
      await appWindow.setSize(new T.dpi.LogicalSize(nat.w + PADDING * 2, nat.h + PADDING * 2));
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

  new ResizeObserver(fit).observe(fitEl);
  return { fit, resizeWindowToContent, autoSizeOnce };
}
