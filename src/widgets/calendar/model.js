// Calendar logic: dates, repeats, overdue, the month grid and the backup format.
// Pure functions with no DOM, so every rule can be tested (tests/calendar-model.test.mjs).
//
// Dates are plain "YYYY-MM-DD" strings and times are "HH:MM" in the PC's local time. All date
// arithmetic goes through whole day numbers (days since 1970-01-01, in UTC), so daylight saving
// and the PC's time zone can never shift an entry to another day.

export const BACKUP_VERSION = 1;
export const REPEATS = ["none", "daily", "weekly", "monthly", "yearly"];
export const COLOUR_COUNT = 6;
export const MAX_TITLE = 200;

// ---- Dates -----------------------------------------------------------
const DAY_MS = 86400000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidDate(ymd) {
  if (typeof ymd !== "string") return false;
  const m = DATE_RE.exec(ymd);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export const isValidTime = (t) => typeof t === "string" && TIME_RE.test(t);

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-12; day 0 of the next month
}

export function toDayNumber(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNumber(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export const addDays = (ymd, n) => fromDayNumber(toDayNumber(ymd) + n);
export const parts = (ymd) => { const [year, month, day] = ymd.split("-").map(Number); return { year, month, day }; };

/** The local calendar date of a JS Date, as "YYYY-MM-DD". */
export function localDate(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate());
}

/** 0 = Sunday ... 6 = Saturday. */
export const weekday = (ymd) => new Date(toDayNumber(ymd) * DAY_MS).getUTCDay();

/** The first day of the week (0 = Sunday, 1 = Monday, 6 = Saturday) on or before `ymd`. */
export function startOfWeek(ymd, weekStart) {
  return addDays(ymd, -((weekday(ymd) - weekStart + 7) % 7));
}

/** ISO 8601 week number (weeks start on Monday; week 1 contains the year's first Thursday). */
export function isoWeekNumber(ymd) {
  const n = toDayNumber(ymd);
  const thursday = n - ((weekday(ymd) + 6) % 7) + 3;
  const jan1 = toDayNumber(parts(fromDayNumber(thursday)).year + "-01-01");
  return Math.floor((thursday - jan1) / 7) + 1;
}

/** Six rows of seven days covering `month` (1-12), so the grid never changes height. */
export function monthGrid(year, month, weekStart) {
  const first = year + "-" + String(month).padStart(2, "0") + "-01";
  const start = toDayNumber(startOfWeek(first, weekStart));
  return Array.from({ length: 42 }, (_, i) => {
    const date = fromDayNumber(start + i);
    const p = parts(date);
    return { date, day: p.day, inMonth: p.month === month && p.year === year };
  });
}

/** The first of the month `delta` months away from year/month (month is 1-12). */
export function shiftMonth(year, month, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

// ---- Times and headings ----------------------------------------------
function clock(hhmm, hour24) {
  const [h, m] = hhmm.split(":").map(Number);
  if (hour24) return hhmm;
  return (h % 12 || 12) + ":" + String(m).padStart(2, "0") + " " + (h < 12 ? "AM" : "PM");
}

/** "09:30", "09:30–10:45", or "" for an entry with no time. */
export function timeLabel(entry, hour24 = true) {
  if (!entry.time && !entry.endTime) return "";
  if (!entry.time) return "until " + clock(entry.endTime, hour24);
  return entry.endTime ? clock(entry.time, hour24) + "–" + clock(entry.endTime, hour24) : clock(entry.time, hour24);
}

/** "Today", "Tomorrow", "Yesterday", otherwise e.g. "Mon 24 Nov". */
export function dayHeading(ymd, todayYmd, locale) {
  const diff = toDayNumber(ymd) - toDayNumber(todayYmd);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return new Date(toDayNumber(ymd) * DAY_MS).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

// ---- Entries ---------------------------------------------------------
export function newId() {
  const c = globalThis.crypto;
  return c && c.randomUUID ? c.randomUUID() : "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * Check and tidy an entry from the form or from a backup file. Returns { ok, errors, entry }:
 * `errors` maps a field name to a short message the form can show next to it.
 */
export function validateEntry(input) {
  const errors = {};
  const e = input && typeof input === "object" ? input : {};
  const kind = e.kind === "todo" ? "todo" : "event";
  const title = typeof e.title === "string" ? e.title.trim().slice(0, MAX_TITLE) : "";
  if (!title) errors.title = "Give it a title";

  const date = e.date;
  if (!isValidDate(date)) errors.date = "Pick a date";

  const time = e.time == null || e.time === "" ? null : e.time;
  if (time !== null && !isValidTime(time)) errors.time = "Use a time like 09:30";
  const endTime = e.endTime == null || e.endTime === "" ? null : e.endTime;
  if (endTime !== null && !isValidTime(endTime)) errors.endTime = "Use a time like 10:30";

  let endDate = kind === "event" && e.endDate ? e.endDate : null;
  if (endDate !== null && !isValidDate(endDate)) { errors.endDate = "Pick an end date"; endDate = null; }
  else if (endDate !== null && isValidDate(date) && endDate < date) errors.endDate = "The end can't be before the start";
  if (endDate === date) endDate = null;

  if (!errors.time && !errors.endTime && endTime !== null) {
    if (time === null) errors.endTime = "Add a start time first";
    else if (endDate === null && endTime < time) errors.endTime = "The end can't be before the start";
  }

  const freq = REPEATS.includes(e.repeat && e.repeat.freq) ? e.repeat.freq : "none";
  let until = freq !== "none" && e.repeat && e.repeat.until ? e.repeat.until : null;
  if (until !== null && !isValidDate(until)) { errors.until = "Pick an end date"; until = null; }
  else if (until !== null && isValidDate(date) && until < date) errors.until = "Repeating can't end before it starts";

  const colour = Number.isInteger(e.colour) && e.colour >= 0 && e.colour < COLOUR_COUNT ? e.colour : 0;
  const location = typeof e.location === "string" ? e.location.trim().slice(0, MAX_TITLE) : "";
  const done = kind === "todo" && Array.isArray(e.done)
    ? [...new Set(e.done.filter(isValidDate))].sort()
    : [];

  const entry = {
    id: typeof e.id === "string" && e.id ? e.id : newId(),
    kind, title, date, time, endDate, endTime, location, colour,
    repeat: { freq, until }, done,
  };
  return { ok: Object.keys(errors).length === 0, errors, entry };
}

// ---- Occurrences -----------------------------------------------------
/** Does an occurrence of `entry` START on day number `n`? */
function startsOn(entry, n, startN, untilN) {
  if (n < startN || n > untilN) return false;
  switch (entry.repeat.freq) {
    case "none": return n === startN;
    case "daily": return true;
    case "weekly": return (n - startN) % 7 === 0;
    case "monthly": {
      const d = parts(fromDayNumber(n));
      return d.day === Math.min(parts(entry.date).day, daysInMonth(d.year, d.month));
    }
    case "yearly": {
      const d = parts(fromDayNumber(n));
      const s = parts(entry.date);
      return d.month === s.month && d.day === Math.min(s.day, daysInMonth(d.year, d.month));
    }
    default: return false;
  }
}

const untilNumber = (entry) => (entry.repeat.until ? toDayNumber(entry.repeat.until) : Infinity);
const spanOf = (entry) => (entry.endDate ? toDayNumber(entry.endDate) - toDayNumber(entry.date) : 0);
export const isDone = (entry, startYmd) => entry.kind === "todo" && entry.done.includes(startYmd);

/**
 * Everything shown on `ymd`: [{ entry, start, firstDay, done }]. `start` is the date the
 * occurrence began (the same as `ymd` except on later days of a multi-day event). A To-do is
 * Done per occurrence, keyed by `start`.
 */
export function entriesOnDay(entries, ymd) {
  const n = toDayNumber(ymd);
  const items = [];
  for (const entry of entries) {
    const startN = toDayNumber(entry.date);
    const untilN = untilNumber(entry);
    const span = spanOf(entry);
    for (let k = 0; k <= span; k++) {
      if (startsOn(entry, n - k, startN, untilN)) {
        const start = fromDayNumber(n - k);
        items.push({ entry, start, firstDay: k === 0, done: isDone(entry, start) });
        break; // overlapping occurrences of a repeating multi-day event show once
      }
    }
  }
  return items.sort(compareItems);
}

/** Entries with no time (and later days of a multi-day event) first, then by time, then title. */
function compareItems(a, b) {
  const ka = a.firstDay && a.entry.time ? a.entry.time : "";
  const kb = b.firstDay && b.entry.time ? b.entry.time : "";
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.entry.title.localeCompare(b.entry.title, undefined, { sensitivity: "base" });
}

/** The dots under a day number: up to three, each marked done or not. */
export function daySummary(entries, ymd) {
  const items = entriesOnDay(entries, ymd);
  return {
    count: items.length,
    dots: items.slice(0, 3).map((i) => ({ colour: i.entry.colour, done: i.done })),
    more: Math.max(0, items.length - 3),
  };
}

export function toggleDone(entry, startYmd) {
  if (entry.kind !== "todo") return entry;
  const done = entry.done.includes(startYmd) ? entry.done.filter((d) => d !== startYmd) : [...entry.done, startYmd].sort();
  return { ...entry, done };
}

/**
 * To-dos that were not ticked off and whose day has passed. A one-off to-do stays overdue until
 * it is ticked off or deleted. A repeating to-do only reports its most recent missed
 * occurrence, so a daily to-do ignored for a month is one item, not thirty.
 */
export function overdue(entries, todayYmd, lookbackDays = 400) {
  const today = toDayNumber(todayYmd);
  const out = [];
  for (const entry of entries) {
    if (entry.kind !== "todo") continue;
    const startN = toDayNumber(entry.date);
    if (startN >= today) continue;
    if (entry.repeat.freq === "none") {
      if (!entry.done.includes(entry.date)) out.push({ entry, start: entry.date, firstDay: true, done: false });
      continue;
    }
    const untilN = untilNumber(entry);
    const lowest = Math.max(startN, today - lookbackDays);
    for (let n = Math.min(today - 1, untilN); n >= lowest; n--) {
      if (!startsOn(entry, n, startN, untilN)) continue;
      const start = fromDayNumber(n);
      if (!entry.done.includes(start)) out.push({ entry, start, firstDay: true, done: false });
      break;
    }
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.entry.title.localeCompare(b.entry.title)));
}

/**
 * What the Agenda shows. With no selected day: the overdue group, then today and the next
 * `days - 1` days (only days that have something). With a selected day: just that day.
 */
export function buildAgenda(entries, todayYmd, { selected = null, days = 8 } = {}) {
  if (selected) {
    return { overdue: [], groups: [{ date: selected, items: entriesOnDay(entries, selected) }], selected: true };
  }
  const groups = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(todayYmd, i);
    const items = entriesOnDay(entries, date);
    if (items.length) groups.push({ date, items });
  }
  return { overdue: overdue(entries, todayYmd), groups, selected: false };
}

// ---- Backup file -----------------------------------------------------
export function serialize(entries) {
  return JSON.stringify({ version: BACKUP_VERSION, entries }, null, 2);
}

/**
 * Read a backup (or the saved data file). Entries that are invalid are dropped and counted;
 * the whole file is refused only if it isn't a Calendar backup at all.
 */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error("That file isn't a Calendar backup (it couldn't be read)."); }
  if (!data || typeof data !== "object" || !Array.isArray(data.entries)) throw new Error("That file isn't a Calendar backup (no entries found).");
  if (typeof data.version === "number" && data.version > BACKUP_VERSION) throw new Error("That backup was made by a newer version of this app.");
  const entries = [];
  const seen = new Set();
  let dropped = 0;
  for (const raw of data.entries) {
    const { ok, entry } = validateEntry(raw);
    if (!ok) { dropped++; continue; }
    if (seen.has(entry.id)) entry.id = newId();
    seen.add(entry.id);
    entries.push(entry);
  }
  return { entries, dropped };
}
