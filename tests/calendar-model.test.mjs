// Calendar rules: dates, repeats, to-do done/overdue, month grid and backup parsing.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidDate, isValidTime, daysInMonth, toDayNumber, fromDayNumber, addDays, weekday, startOfWeek,
  isoWeekNumber, monthGrid, shiftMonth, localDate, timeLabel, dayHeading, validateEntry, entriesOnDay,
  daySummary, toggleDone, overdue, buildAgenda, serialize, parseBackup, BACKUP_VERSION,
} from "../src/widgets/calendar/model.js";

// A valid entry with overrides, normalised the way the app stores it.
let seq = 0;
function make(over = {}) {
  const base = { id: "id" + ++seq, kind: "event", title: "Thing", date: "2026-11-24", time: null, endDate: null, endTime: null,
    location: "", colour: 0, repeat: { freq: "none", until: null }, done: [] };
  const { ok, errors, entry } = validateEntry({ ...base, ...over });
  assert.ok(ok, "fixture is valid: " + JSON.stringify(errors));
  return entry;
}
const on = (entries, ymd) => entriesOnDay(entries, ymd).map((i) => i.entry.title);

// ---- dates ------------------------------------------------------------
test("date and time validation", () => {
  for (const ok of ["2026-11-21", "2024-02-29", "2026-12-31", "2000-01-01"]) assert.ok(isValidDate(ok), ok);
  for (const bad of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-00-10", "2026-1-1", "26-11-21", "", null, undefined, 20261121, "2026-11-31"]) assert.ok(!isValidDate(bad), String(bad));
  for (const ok of ["00:00", "09:30", "23:59"]) assert.ok(isValidTime(ok), ok);
  for (const bad of ["24:00", "9:30", "09:60", "", null, "noon"]) assert.ok(!isValidTime(bad), String(bad));
});

test("month lengths and leap years", () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2100, 2), 28, "2100 is not a leap year");
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
});

test("adding days crosses months, years and leap days", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(fromDayNumber(toDayNumber("2026-11-21")), "2026-11-21");
  assert.equal(toDayNumber("2026-11-22") - toDayNumber("2026-11-21"), 1);
});

test("weekday, start of week and ISO week numbers", () => {
  assert.equal(weekday("2026-11-21"), 6, "21 Nov 2026 is a Saturday");
  assert.equal(weekday("2026-11-22"), 0);
  assert.equal(startOfWeek("2026-11-21", 1), "2026-11-16", "Monday start");
  assert.equal(startOfWeek("2026-11-22", 1), "2026-11-16", "a Sunday belongs to the week before");
  assert.equal(startOfWeek("2026-11-22", 0), "2026-11-22", "Sunday start");
  assert.equal(startOfWeek("2026-11-21", 6), "2026-11-21", "Saturday start");
  assert.equal(isoWeekNumber("2026-01-01"), 1);
  assert.equal(isoWeekNumber("2026-12-31"), 53, "2026 starts on a Thursday so it has 53 weeks");
  assert.equal(isoWeekNumber("2021-01-03"), 53, "belongs to 2020's last week");
  assert.equal(isoWeekNumber("2024-12-30"), 1, "belongs to 2025's first week");
  assert.equal(isoWeekNumber("2026-11-21"), 47);
});

test("the month grid is always six rows and respects the week start", () => {
  const mon = monthGrid(2026, 11, 1);
  assert.equal(mon.length, 42);
  assert.equal(mon[0].date, "2026-10-26"); assert.equal(mon[0].inMonth, false);
  assert.equal(mon[6].date, "2026-11-01"); assert.equal(mon[6].inMonth, true);
  assert.equal(mon[41].date, "2026-12-06");
  assert.equal(mon.filter((c) => c.inMonth).length, 30);
  const sun = monthGrid(2026, 11, 0);
  assert.equal(sun[0].date, "2026-11-01"); assert.equal(sun[0].inMonth, true);
  const sat = monthGrid(2026, 11, 6);
  assert.equal(sat[0].date, "2026-10-31");
  // February of a leap year and a month that starts on the week start
  assert.equal(monthGrid(2024, 2, 1).filter((c) => c.inMonth).length, 29);
  for (const ws of [0, 1, 6]) assert.equal(weekday(monthGrid(2026, 3, ws)[0].date), ws);
});

test("moving between months", () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 11, 14), { year: 2028, month: 1 });
  assert.deepEqual(shiftMonth(2026, 11, -23), { year: 2024, month: 12 });
  assert.deepEqual(shiftMonth(2026, 6, 0), { year: 2026, month: 6 });
});

test("local date and labels", () => {
  assert.equal(localDate(new Date(2026, 10, 21, 23, 59)), "2026-11-21");
  assert.equal(localDate(new Date(2026, 0, 5, 0, 0)), "2026-01-05");
  assert.equal(timeLabel({ time: "09:30", endTime: "10:45" }, true), "09:30–10:45");
  assert.equal(timeLabel({ time: "15:05", endTime: null }, false), "3:05 PM");
  assert.equal(timeLabel({ time: "00:10", endTime: "12:00" }, false), "12:10 AM–12:00 PM");
  assert.equal(timeLabel({ time: null, endTime: null }, true), "");
  assert.equal(timeLabel({ time: null, endTime: "18:00" }, true), "until 18:00");
  assert.equal(dayHeading("2026-11-21", "2026-11-21", "en-GB"), "Today");
  assert.equal(dayHeading("2026-11-22", "2026-11-21", "en-GB"), "Tomorrow");
  assert.equal(dayHeading("2026-11-20", "2026-11-21", "en-GB"), "Yesterday");
  assert.match(dayHeading("2026-11-24", "2026-11-21", "en-GB"), /Tue.*24.*Nov/);
});

// ---- validation -------------------------------------------------------
test("a good entry is accepted and tidied", () => {
  const { ok, entry } = validateEntry({ kind: "event", title: "  Dentist  ", date: "2026-11-24", time: "09:30", location: " Clinic ", colour: 3 });
  assert.ok(ok);
  assert.equal(entry.title, "Dentist"); assert.equal(entry.location, "Clinic"); assert.equal(entry.colour, 3);
  assert.ok(entry.id, "an id is assigned"); assert.deepEqual(entry.repeat, { freq: "none", until: null });
});

test("each kind of mistake gets a message next to the right field", () => {
  const bad = (over) => validateEntry({ kind: "event", title: "x", date: "2026-11-24", ...over }).errors;
  assert.ok(validateEntry({ date: "2026-11-24" }).errors.title);
  assert.ok(validateEntry({ title: "   ", date: "2026-11-24" }).errors.title);
  assert.ok(bad({ date: "2026-02-30" }).date);
  assert.ok(bad({ date: undefined }).date);
  assert.ok(bad({ time: "25:00" }).time);
  assert.ok(bad({ time: "09:30", endTime: "9:45" }).endTime);
  assert.ok(bad({ endTime: "10:00" }).endTime, "an end time needs a start time");
  assert.ok(bad({ time: "10:00", endTime: "09:00" }).endTime, "same day: the end can't be before the start");
  assert.equal(bad({ time: "10:00", endTime: "09:00", endDate: "2026-11-25" }).endTime, undefined, "an overnight event may end earlier in the day");
  assert.ok(bad({ endDate: "2026-11-23" }).endDate);
  assert.ok(bad({ repeat: { freq: "weekly", until: "2026-11-01" } }).until);
  assert.deepEqual(bad({}), {});
});

test("tidying: end date, to-dos, repeat, colour and done list", () => {
  assert.equal(validateEntry({ title: "x", date: "2026-11-24", endDate: "2026-11-24" }).entry.endDate, null, "same-day end date is dropped");
  assert.equal(validateEntry({ kind: "todo", title: "x", date: "2026-11-24", endDate: "2026-11-26" }).entry.endDate, null, "to-dos have no end date");
  assert.deepEqual(validateEntry({ title: "x", date: "2026-11-24", repeat: { freq: "none", until: "2027-01-01" } }).entry.repeat, { freq: "none", until: null });
  assert.equal(validateEntry({ title: "x", date: "2026-11-24", repeat: { freq: "fortnightly" } }).entry.repeat.freq, "none");
  assert.equal(validateEntry({ title: "x", date: "2026-11-24", colour: 9 }).entry.colour, 0);
  assert.equal(validateEntry({ title: "x", date: "2026-11-24", colour: "red" }).entry.colour, 0);
  assert.deepEqual(validateEntry({ kind: "todo", title: "x", date: "2026-11-24", done: ["2026-11-25", "bad", "2026-11-24", "2026-11-25"] }).entry.done, ["2026-11-24", "2026-11-25"]);
  assert.deepEqual(validateEntry({ kind: "event", title: "x", date: "2026-11-24", done: ["2026-11-24"] }).entry.done, [], "events are never done");
  assert.equal(validateEntry({ title: "x".repeat(500), date: "2026-11-24" }).entry.title.length, 200);
  for (const junk of [null, undefined, 42, "text", []]) { const r = validateEntry(junk); assert.equal(r.ok, false); assert.equal(typeof r.entry, "object"); }
  assert.equal(validateEntry({ id: "keep-me", title: "x", date: "2026-11-24" }).entry.id, "keep-me");
});

// ---- repeats ----------------------------------------------------------
test("a one-off entry is only on its day", () => {
  const e = make({ title: "A", date: "2026-11-24" });
  assert.deepEqual(on([e], "2026-11-24"), ["A"]);
  assert.deepEqual([on([e], "2026-11-23"), on([e], "2026-11-25")], [[], []]);
});

test("daily repeats start on the date and respect the end date (inclusive)", () => {
  const e = make({ title: "D", date: "2026-11-24", repeat: { freq: "daily", until: "2026-11-27" } });
  assert.deepEqual(on([e], "2026-11-23"), []);
  for (const d of ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]) assert.deepEqual(on([e], d), ["D"], d);
  assert.deepEqual(on([e], "2026-11-28"), []);
  assert.deepEqual(on([make({ title: "D", date: "2026-01-01", repeat: { freq: "daily" } })], "2030-06-15"), ["D"], "no end date runs on");
});

test("weekly repeats stay on their weekday", () => {
  const e = make({ title: "W", date: "2026-11-24", repeat: { freq: "weekly" } }); // a Tuesday
  for (const d of ["2026-11-24", "2026-12-01", "2026-12-08", "2027-01-05"]) assert.deepEqual(on([e], d), ["W"], d);
  for (const d of ["2026-11-25", "2026-12-02", "2026-11-17"]) assert.deepEqual(on([e], d), [], d);
});

test("monthly repeats: the 31st lands on the last day of shorter months", () => {
  const e = make({ title: "M", date: "2026-01-31", repeat: { freq: "monthly" } });
  for (const d of ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-09-30", "2026-12-31", "2028-02-29"]) assert.deepEqual(on([e], d), ["M"], d);
  for (const d of ["2026-02-27", "2026-04-29", "2026-03-30", "2028-02-28"]) assert.deepEqual(on([e], d), [], d);
  const thirty = make({ title: "T", date: "2026-01-30", repeat: { freq: "monthly" } });
  assert.deepEqual(on([thirty], "2026-02-28"), ["T"]); assert.deepEqual(on([thirty], "2026-03-30"), ["T"]); assert.deepEqual(on([thirty], "2026-03-31"), []);
  const mid = make({ title: "15", date: "2026-03-15", repeat: { freq: "monthly" } });
  assert.deepEqual(on([mid], "2026-02-15"), [], "not before it starts");
  assert.deepEqual(on([mid], "2026-04-15"), ["15"]); assert.deepEqual(on([mid], "2026-04-14"), []);
});

test("yearly repeats, including a 29 February birthday", () => {
  const e = make({ title: "B", date: "2024-02-29", repeat: { freq: "yearly" } });
  assert.deepEqual(on([e], "2024-02-29"), ["B"]);
  assert.deepEqual(on([e], "2025-02-28"), ["B"], "non-leap years use the 28th");
  assert.deepEqual(on([e], "2028-02-29"), ["B"]);
  assert.deepEqual(on([e], "2028-02-28"), [], "but not twice in a leap year");
  assert.deepEqual(on([e], "2025-03-01"), []);
  assert.deepEqual(on([e], "2023-02-28"), [], "not before it starts");
  const xmas = make({ title: "X", date: "2026-12-25", repeat: { freq: "yearly", until: "2028-12-31" } });
  assert.deepEqual(on([xmas], "2027-12-25"), ["X"]); assert.deepEqual(on([xmas], "2027-11-25"), []);
  assert.deepEqual(on([xmas], "2029-12-25"), [], "stops after the end date");
});

test("multi-day events appear on every day they cover", () => {
  const trip = make({ title: "Trip", date: "2026-11-24", endDate: "2026-11-26" });
  assert.deepEqual(on([trip], "2026-11-23"), []);
  assert.deepEqual(entriesOnDay([trip], "2026-11-24").map((i) => i.firstDay), [true]);
  const mid = entriesOnDay([trip], "2026-11-25")[0];
  assert.equal(mid.firstDay, false); assert.equal(mid.start, "2026-11-24");
  assert.deepEqual(on([trip], "2026-11-26"), ["Trip"]); assert.deepEqual(on([trip], "2026-11-27"), []);
  const weekly = make({ title: "Retreat", date: "2026-11-24", endDate: "2026-11-25", repeat: { freq: "weekly" } });
  const second = entriesOnDay([weekly], "2026-12-02")[0];
  assert.equal(second.start, "2026-12-01"); assert.equal(second.firstDay, false);
  assert.deepEqual(on([weekly], "2026-11-30"), []);
});

test("a day is ordered: untimed first, then by time, then by title", () => {
  const items = [
    make({ title: "Zed", date: "2026-11-24", time: "09:00" }),
    make({ title: "Apple", date: "2026-11-24", time: "14:30" }),
    make({ title: "Banana", date: "2026-11-24" }),
    make({ title: "avocado", date: "2026-11-24" }),
    make({ title: "Mid", date: "2026-11-24", time: "09:00" }),
    make({ title: "Trip", date: "2026-11-22", endDate: "2026-11-25", time: "08:00" }), // continuing from earlier: no time shown
  ];
  assert.deepEqual(on(items, "2026-11-24"), ["avocado", "Banana", "Trip", "Mid", "Zed", "Apple"]);
});

test("the dots under a day", () => {
  const items = [make({ title: "a", colour: 1 }), make({ title: "b", colour: 2 }), make({ title: "c", colour: 3 }),
    make({ title: "d", colour: 4, kind: "todo", done: ["2026-11-24"] })];
  const s = daySummary(items, "2026-11-24");
  assert.equal(s.count, 4); assert.equal(s.dots.length, 3); assert.equal(s.more, 1);
  const one = daySummary([make({ kind: "todo", date: "2026-11-24", done: ["2026-11-24"], colour: 5 })], "2026-11-24");
  assert.deepEqual(one.dots, [{ colour: 5, done: true }]);
  assert.deepEqual(daySummary([], "2026-11-24"), { count: 0, dots: [], more: 0 });
});

// ---- done and overdue -------------------------------------------------
test("ticking a repeating to-do marks only that day done", () => {
  const todo = make({ kind: "todo", title: "Water plants", date: "2026-11-22", repeat: { freq: "weekly" } });
  const ticked = toggleDone(todo, "2026-11-22");
  assert.deepEqual(todo.done, [], "the original is not changed");
  assert.equal(entriesOnDay([ticked], "2026-11-22")[0].done, true);
  assert.equal(entriesOnDay([ticked], "2026-11-29")[0].done, false, "next week is a fresh, unticked item");
  assert.deepEqual(toggleDone(ticked, "2026-11-22").done, [], "tick again to undo");
  assert.deepEqual(toggleDone(toggleDone(todo, "2026-12-06"), "2026-11-29").done, ["2026-11-29", "2026-12-06"], "kept in order");
  const event = make({ title: "Meeting" });
  assert.equal(toggleDone(event, "2026-11-24"), event, "events cannot be ticked");
});

test("overdue: one-off to-dos stay overdue until ticked or deleted; events never are", () => {
  const today = "2026-11-21";
  const yesterday = make({ kind: "todo", title: "Yesterday", date: "2026-11-20" });
  const old = make({ kind: "todo", title: "Old", date: "2026-08-01" });
  const done = make({ kind: "todo", title: "Done", date: "2026-11-19", done: ["2026-11-19"] });
  const todayTodo = make({ kind: "todo", title: "Today", date: "2026-11-21" });
  const future = make({ kind: "todo", title: "Future", date: "2026-11-22" });
  const event = make({ kind: "event", title: "Event", date: "2026-11-01" });
  assert.deepEqual(overdue([yesterday, old, done, todayTodo, future, event], today).map((i) => i.entry.title), ["Old", "Yesterday"], "oldest first");
});

test("overdue: a repeating to-do reports only its most recent missed occurrence", () => {
  const today = "2026-11-21";
  const daily = make({ kind: "todo", title: "Daily", date: "2026-10-22", repeat: { freq: "daily" } });
  const got = overdue([daily], today);
  assert.equal(got.length, 1, "a month of missed days is one item, not thirty");
  assert.equal(got[0].start, "2026-11-20");
  assert.deepEqual(overdue([toggleDone(daily, "2026-11-20")], today), [], "yesterday done: nothing overdue even though earlier days were missed");
  const weekly = make({ kind: "todo", title: "Weekly", date: "2026-10-04", repeat: { freq: "weekly" } }); // Sundays
  assert.equal(overdue([weekly], today)[0].start, "2026-11-15");
  const ended = make({ kind: "todo", title: "Ended", date: "2026-10-01", repeat: { freq: "daily", until: "2026-10-05" } });
  assert.equal(overdue([ended], today)[0].start, "2026-10-05", "uses the last occurrence before the end date");
  const notYet = make({ kind: "todo", title: "Starts today", date: "2026-11-21", repeat: { freq: "daily" } });
  assert.deepEqual(overdue([notYet], today), []);
  const yearly = make({ kind: "todo", title: "Yearly", date: "2025-12-01", repeat: { freq: "yearly" } });
  assert.equal(overdue([yearly], today)[0].start, "2025-12-01");
});

test("the agenda: overdue first, then today and the next week; or just the chosen day", () => {
  const today = "2026-11-21";
  const entries = [
    make({ title: "Late", kind: "todo", date: "2026-11-18" }),
    make({ title: "Now", date: "2026-11-21", time: "10:00" }),
    make({ title: "Soon", date: "2026-11-24" }),
    make({ title: "Edge", date: "2026-11-28" }),        // 7 days ahead: included
    make({ title: "Far", date: "2026-11-29" }),         // 8 days ahead: not in the default view
  ];
  const a = buildAgenda(entries, today);
  assert.deepEqual(a.overdue.map((i) => i.entry.title), ["Late"]);
  assert.deepEqual(a.groups.map((g) => g.date), ["2026-11-21", "2026-11-24", "2026-11-28"], "only days with something");
  assert.equal(a.selected, false);
  const day = buildAgenda(entries, today, { selected: "2026-11-30" });
  assert.deepEqual(day.groups, [{ date: "2026-11-30", items: [] }], "a chosen empty day still gets its heading");
  assert.deepEqual(day.overdue, []); assert.equal(day.selected, true);
  assert.deepEqual(buildAgenda([], today), { overdue: [], groups: [], selected: false });
});

// ---- backup -----------------------------------------------------------
test("a backup round-trips exactly", () => {
  const entries = [
    make({ title: "Dentist", time: "09:30", endTime: "10:15", location: "Clinic", colour: 2, repeat: { freq: "yearly", until: null } }),
    make({ kind: "todo", title: "Plants", repeat: { freq: "weekly", until: "2027-01-01" }, done: ["2026-11-24"] }),
    make({ title: "Trip", date: "2026-12-01", endDate: "2026-12-05" }),
  ];
  const back = parseBackup(serialize(entries));
  assert.deepEqual(back.entries, entries); assert.equal(back.dropped, 0);
  assert.equal(JSON.parse(serialize(entries)).version, BACKUP_VERSION);
  assert.deepEqual(parseBackup(serialize([])).entries, []);
});

test("a backup that is not a Calendar backup is refused with a plain message", () => {
  assert.throws(() => parseBackup("not json at all"), /couldn't be read/);
  assert.throws(() => parseBackup("{}"), /no entries/);
  assert.throws(() => parseBackup(JSON.stringify({ entries: "nope" })), /no entries/);
  assert.throws(() => parseBackup("[]"), /no entries/);
  assert.throws(() => parseBackup(JSON.stringify({ version: BACKUP_VERSION + 1, entries: [] })), /newer version/);
  assert.throws(() => parseBackup(""), /couldn't be read/);
});

test("a damaged backup keeps what it can and says how much it dropped", () => {
  const good = make({ title: "Keep" });
  const text = JSON.stringify({ version: 1, entries: [good, { title: "", date: "2026-11-24" }, { title: "x", date: "nope" }, null, 7, { ...good, id: good.id, title: "Same id" }, { title: "No id", date: "2026-11-24" }] });
  const { entries, dropped } = parseBackup(text);
  assert.equal(dropped, 4);
  assert.deepEqual(entries.map((e) => e.title), ["Keep", "Same id", "No id"]);
  assert.equal(new Set(entries.map((e) => e.id)).size, 3, "duplicate and missing ids are fixed");
  assert.equal(entries[0].id, good.id);
});
