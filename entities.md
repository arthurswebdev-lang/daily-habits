# Entities

Structured version of `entities` — categories now have a fixed color + icon,
and each task type is described as I understand it. Review and comment; I'll
update based on feedback.

## Categories

Each category gets a unique color and an icon. Colors are the exact 8 hex
values from your palette image (bright/neon set), mapped to categories below.

Order (also the order of the swipeable category pages in the app):

| # | Category    | Color                                        | Hex       | Icon |
|---|-------------|-----------------------------------------------|-----------|------|
| 1 | Important   | <span style="color:#fb1919">■</span> Red      | `#fb1919` | ⭐   |
| 2 | Work        | <span style="color:#13c2f9">■</span> Sky Blue | `#13c2f9` | 💼   |
| 3 | Supplements | <span style="color:#27b621">■</span> Green    | `#27b621` | 💊   |
| 4 | Food        | <span style="color:#ffed02">■</span> Yellow   | `#ffed02` | 🍎   |
| 5 | Education   | <span style="color:#bce211">■</span> Lime     | `#bce211` | 🎓   |
| 6 | Selfcare    | <span style="color:#13d4c7">■</span> Teal     | `#13d4c7` | 🧘   |
| 7 | Gym         | <span style="color:#ff8000">■</span> Orange   | `#ff8000` | 🏋️   |
| 8 | Reading     | <span style="color:#f5228e">■</span> Pink     | `#f5228e` | 📖   |

Category is **optional** on the add-task form — a task created without
picking one lands in a neutral "Other" bucket (gray, 🗂️) that only appears
as a page/tab when at least one uncategorized task exists.

Notes:
- Colors are assigned to fixed slots, not reused/cycled — if a category is
  added or removed later, existing colors stay put and the new one takes the
  next unused slot.
- Food (yellow) and Education (lime) sit close enough in hue that they're
  hard to tell apart by color alone (checked against colorblind simulation
  and normal vision) — kept as-is per your call, since every task chip also
  shows icon + category name as text, so color is never the only signal.
- "Important" is a category like any other here (not a priority flag on top
  of other categories) — open to revisiting if you want priority to work
  differently (e.g. a flag any task can have, independent of category).

## Subtasks

Any task (of any type below) can optionally have a checklist of subtasks
instead of a single done/not-done state. Every add-task form (one-time,
event, weekly, monthly, daily) now has a "Subtasks" builder: type a step,
tap + (or Enter) to add it, tap × to remove — resolved the earlier gap
where subtasks existed in the data model but there was no way to actually
add one from the UI.

- Each subtask is just a label + its own done flag: `{ label, done }`.
- When a task has subtasks, its own `done` is *derived*, not stored directly
  — it's fully done only when every subtask is checked. There's no separate
  "mark whole task done" action once subtasks exist; you check them off
  individually.
- Progress is shown as a percentage (`doneCount / total`), e.g. "2/4 · 50%",
  with a ring/progress indicator taking the place of the plain checkbox.
- A task with zero subtasks behaves exactly like today — a plain checkbox.
- Daily recurrence's auto-generated time slots (see below) are subtasks
  too, tagged `isSlot: true`; any extra steps you add on a daily task sit
  alongside the time slots in the same checklist, but only the time slots
  get regenerated each day — extra steps stay as you left them.
- Subtasks can be added or removed later too, via editing the task (see
  Editing below) — not just fixed at creation.

## Editing

Tap the pencil icon on any ticket to reopen the same form used to create
it, pre-filled with its current values (label, category, date/time or
recurrence schedule, subtasks). Saving updates the ticket in place.
Editing does not change a ticket's fundamental type (e.g. you can't turn a
one-time task into an event) — only its fields. Editing a task's other
fields never resets an already-completed checkbox or checked-off subtask
(matched back up by label).

## Task Types

### One-time
A single task with just a label — no scheduled time. Lives in a general
backlog/today list. Done whenever you get to it, then moves to a "done" list.
No due date, no recurrence.

- Fields: `label`, `category`, `done`, `createdAt`, `completedAt`
- Example: "Renew passport", "Call the plumber"

### Event
A task tied to one specific date + time in the future — something you must
not forget, happening once. Distinct from "one-time" because it has a fixed
moment rather than "whenever."

- Fields: `label`, `category`, `datetime` (specific date + time), `done`
- Example: "Interview at 2pm on Aug 5", "Doctor's appointment Aug 12, 10:30am"
- Open question: should Event support a reminder lead time (e.g. notify 30
  min before), or just show up on that day/time in the UI?

### Repetitive
A task that recurs on a schedule. Has one of these recurrence modes:

1. **Weekly by day-of-week** — select which days it repeats on (e.g. every
   day except Sat/Sun, or just Mon/Wed/Fri).
2. **Monthly by day-of-month** — repeats on a specific day number each month
   (e.g. the 1st of every month). Open question: what happens in shorter
   months if the day is set to 30/31?
3. **Daily interval** — repeats throughout the day starting at a first time
   (e.g. 9:00) and repeating every N hours until an explicit end time (e.g.
   9:00 → 11:00 → ... → 19:00 for a 2h interval ending at 20:00). Useful for
   things like "drink water" or "stretch."
   Each interval is generated as its own checkable slot (reusing the
   subtasks mechanism — see below) rather than one flat done flag, so
   checking off 9:00 doesn't mark the whole day done; progress shows as
   e.g. "2/6 · 33%" until every slot for the day is checked.

- Fields: `label`, `category`, `recurrence` (`{ kind: "weekly" | "monthly" |
  "daily", ...type-specific fields }`). Weekly/monthly still use a single
  `done` flag per ticket (no reset logic yet — see open question below);
  daily auto-generates its per-slot `subtasks` at creation time.

Tasks now persist in IndexedDB (survive reload/close). Daily recurrence
regenerates a fresh, unchecked set of per-slot subtasks whenever the
calendar day has moved on since they were last generated, so a checked-off
9:00 doesn't stay checked forever — checked at most once every 20s, and
once at load.

Open question for weekly/monthly recurring tasks: when marked done, does it
just reset next cycle, or do we keep a history (streak / completion log) you
can look back on? These two still use a single `done` flag with no
reset/history logic yet.
