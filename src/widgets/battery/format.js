// Pure display logic for the Battery widget (no DOM), so it can be tested directly.

const ICONS = [
  [/head(phone|set)|buds|airpods|earbud|earphone|pods|wh-|wf-/i, "🎧"],
  [/mouse|mx master|trackpad|trackball/i, "🖱️"],
  [/keyboard|keychron|k\d{3}/i, "⌨️"],
  [/phone|galaxy|iphone|pixel|oneplus|redmi|xiaomi|sm-[a-z]\d/i, "📱"],
  [/watch|band|fit/i, "⌚"],
  [/speaker|soundbar|boom|jbl|echo|home/i, "🔊"],
  [/controller|gamepad|xbox|dualsense|dualshock|joy-?con/i, "🎮"],
];

export function iconForDevice(name) {
  for (const [re, icon] of ICONS) if (re.test(name)) return icon;
  return "🔵";
}

/** low <= 20, medium <= 40, otherwise ok. */
export function levelClass(percent) {
  if (percent <= 20) return "low";
  if (percent <= 40) return "mid";
  return "ok";
}

export function timeLeftText(minutes) {
  if (minutes == null) return "";
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (h === 0) return m + " min left";
  return h + " h " + String(m).padStart(2, "0") + " min left";
}

/** One row per thing to display, from the report the Rust side returns. */
export function buildRows(report, { showDisconnected, showNoReading }) {
  const rows = [];
  if (report.pc) {
    const pc = report.pc;
    let sub;
    if (pc.charging) sub = "Charging";
    else if (pc.pluggedIn) sub = pc.percent >= 100 ? "Plugged in, full" : "Plugged in";
    else sub = timeLeftText(pc.minutesLeft) || "On battery";
    rows.push({ key: "pc", icon: pc.pluggedIn ? "🔌" : "🔋", name: "This PC", sub, percent: pc.percent, charging: pc.charging, dim: false });
  }
  for (const d of report.devices || []) {
    if (d.connected === false && !showDisconnected) continue;
    if (d.percent == null && !showNoReading) continue;
    let sub = d.connected === false ? "Not connected" : d.connected === true ? "Connected" : "";
    if (d.percent == null) sub = (sub ? sub + " - " : "") + "battery not reported";
    rows.push({ key: d.id, icon: iconForDevice(d.name), name: d.name, sub, percent: d.percent, charging: false, dim: d.connected === false });
  }
  return rows;
}
