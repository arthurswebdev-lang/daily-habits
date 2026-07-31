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
instead of a single done/not-done state:

- Each subtask is just a label + its own done flag: `{ label, done }`.
- When a task has subtasks, its own `done` is *derived*, not stored directly
  — it's fully done only when every subtask is checked. There's no separate
  "mark whole task done" action once subtasks exist; you check them off
  individually.
- Progress is shown as a percentage (`doneCount / total`), e.g. "2/4 · 50%",
  with a ring/progress indicator taking the place of the plain checkbox.
- A task with zero subtasks behaves exactly like today — a plain checkbox.

Open question: should there be a way to add subtasks to a task after
creation (an inline "+ add step" row), or are subtasks fixed once the task
is created?

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
3. **Hourly interval** — repeats throughout the day starting at a first time
   (e.g. 9:00) and repeating every N hours until an implicit/explicit last
   time (e.g. last occurrence ≤ 20:00, so 9:00 → 11:00 → ... → 19:00 if
   interval is 2h). Useful for things like "drink water" or "stretch."
   Open question: should the end time be explicit (you set both start and
   end, and we derive the count) or derived only from the interval?

- Fields: `label`, `category`, `recurrence` (`{ type: "weekly" | "monthly" |
  "hourly", ...type-specific fields }`), plus per-day/per-occurrence
  completion state (a repetitive task's "done" resets each cycle, unlike
  one-time/event which are done once and stay done).

Open question for all recurring tasks: when a recurring instance is marked
done, does it just reset next cycle, or do we keep a history (streak /
completion log) you can look back on?
