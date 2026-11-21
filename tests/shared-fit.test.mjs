// Regression test: a widget window must keep the size the user gave it.
// Bug: every data refresh and every app launch called resizeWindowToContent(), which set the
// window back to its default size. Policy now: size to content once (autoSizeOnce), and
// afterwards only when the user changes a content-sizing setting (resizeWindowToContent).
//
// Run with: npm test   (Node's built-in test runner, no extra dependencies)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const setSizeCalls = [];
const store = new Map();

// Minimal browser/Tauri stand-ins; widget.js reads these at import time.
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
const observed = [];
globalThis.ResizeObserver = class { observe(node) { observed.push(node); } };
globalThis.document = { addEventListener() {} };
globalThis.window = {
  __TAURI__: {
    dpi: { LogicalSize: class { constructor(w, h) { this.width = w; this.height = h; } } },
    window: { getCurrentWindow: () => ({ label: "test", setSize: async (s) => { setSizeCalls.push([s.width, s.height]); } }) },
  },
};

const { createFit, PADDING, WINDOW_EXTRA } = await import("../src/shared/widget.js");

const fakeEl = (props) => ({ style: {}, ...props });
function makeFit({ hasContent = true, sizedKey = "test.sized.v1" } = {}) {
  const content = fakeEl({ offsetWidth: 200, offsetHeight: 100 });
  const fitEl = fakeEl({ clientWidth: 500, clientHeight: 400 });
  return { content, ...createFit({ fitEl, contentEl: content, hasContent: () => hasContent, sizedKey }) };
}

beforeEach(() => { setSizeCalls.length = 0; store.clear(); observed.length = 0; });

test("first launch sizes the window to its content, exactly once", async () => {
  const f = makeFit();
  await f.autoSizeOnce();
  assert.deepEqual(setSizeCalls, [[200 + WINDOW_EXTRA, 100 + WINDOW_EXTRA]]);
  await f.autoSizeOnce(); // e.g. a data refresh re-rendering
  await f.autoSizeOnce();
  assert.equal(setSizeCalls.length, 1, "later renders must not resize the window");
});

test("a relaunch keeps the window size the user chose (and Tauri restored)", async () => {
  await makeFit().autoSizeOnce();
  setSizeCalls.length = 0;
  const relaunched = makeFit(); // new page load, same saved state
  await relaunched.autoSizeOnce();
  assert.equal(setSizeCalls.length, 0);
});

test("content is still scaled to fit the user's window after a refresh", async () => {
  const f = makeFit();
  await f.autoSizeOnce();
  await f.autoSizeOnce();
  // window area 500x400 minus padding vs content 200x100 -> limited by width: (500-28)/200
  assert.equal(f.content.style.transform, "scale(" + (500 - PADDING * 2) / 200 + ")");
});

test("an explicit user change (size slider, layout, toggles) still resizes the window", async () => {
  const f = makeFit();
  await f.autoSizeOnce();
  setSizeCalls.length = 0;
  await f.resizeWindowToContent();
  assert.equal(setSizeCalls.length, 1);
});

test("no content yet (no data, error message) does not size or burn the first-time flag", async () => {
  await makeFit({ hasContent: false }).autoSizeOnce();
  assert.equal(setSizeCalls.length, 0);
  assert.equal(store.size, 0, "flag not set, so the first real content still gets sized");
  await makeFit({ hasContent: true }).autoSizeOnce();
  assert.equal(setSizeCalls.length, 1);
});

test("each widget has its own first-time flag", async () => {
  await makeFit({ sizedKey: "a.sized.v1" }).autoSizeOnce();
  await makeFit({ sizedKey: "b.sized.v1" }).autoSizeOnce();
  assert.equal(setSizeCalls.length, 2);
});

test("the scale is recalculated when the content changes size, not only when the window does", () => {
  const f = makeFit();
  assert.ok(observed.includes(f.content), "the content element is observed (e.g. a clock gains a 'Tomorrow' line)");
  assert.equal(observed.length, 2, "the window area and the content");
});

test("the window is sized so the content fits at 100%, border included (it used to come out 2px short, i.e. ~98%)", async () => {
  // The card has a 1px border on each side, and the fit area sits inside it.
  assert.equal(WINDOW_EXTRA, PADDING * 2 + 2);
  const content = fakeEl({ offsetWidth: 200, offsetHeight: 100 });
  const sized = [];
  window.__TAURI__.window.getCurrentWindow = () => ({ label: "t", setSize: async (s) => sized.push([s.width, s.height]) });
  // After the window has been sized, the fit area is the window minus the border.
  const fitEl = fakeEl({ clientWidth: 200 + WINDOW_EXTRA - 2, clientHeight: 100 + WINDOW_EXTRA - 2 });
  const f = createFit({ fitEl, contentEl: content, sizedKey: "scale.sized.v1" });
  await f.resizeWindowToContent();
  assert.equal(content.style.transform, "scale(1)", "content shown at full size, not 0.98");
});
