# Calendar

A widget that shows a month and lists the user's own entries (events and to-dos), kept only on this PC and never synced with any other calendar.

## Language

**Entry**:
Anything saved in the Calendar: an Event or a To-do. It has a title, a date, an optional time, an optional end, an optional location, a colour, and an optional Repeat.
_Avoid_: Item, appointment, reminder, task

**Event**:
An Entry for something that happens at a time or over several days, such as a meeting or a trip. It may have an end date and end time. An Event is never Overdue.
_Avoid_: Meeting, appointment

**To-do**:
An Entry the user ticks off when it is Done. It is the only kind of Entry that can be Done or Overdue.
_Avoid_: Task, reminder, checklist item

**Done**:
A To-do that has been ticked off for one particular day. Ticking a repeating To-do marks only that day's Occurrence as Done.
_Avoid_: Completed, finished, checked

**Overdue**:
A To-do that is not Done and whose day has passed. It appears in a red group at the top of the Agenda until it is ticked off or deleted.
_Avoid_: Late, missed, expired

**Repeat**:
A rule that makes an Entry come back daily, weekly, monthly or yearly, optionally until an end date. Editing or deleting a repeating Entry changes all of it.
_Avoid_: Recurrence, series, schedule

**Occurrence**:
One appearance of a repeating Entry on a particular day.
_Avoid_: Instance, copy

**Month grid**:
The part of the Calendar that shows one month, with today highlighted and a dot on each day that has Entries. The dot is lighter when every To-do that day is Done.
_Avoid_: Calendar view, month view

**Agenda**:
The list below the Month grid. It shows the Overdue group first, then today and the next 7 days, or just the day the user clicked.
_Avoid_: Schedule, upcoming list

**Backup**:
A file the user exports that holds all their Entries. Importing a Backup replaces everything after a confirmation; the Entries that were there are saved first so a wrong import can be undone.
_Avoid_: Export file, snapshot
