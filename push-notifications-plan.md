# Push Notifications Plan

Goal: real notifications that fire even when the Daily Tasks PWA is closed,
using **Firebase only as the push-delivery transport** (Firebase Cloud
Messaging). Everything else — the schedule of what's due when, the "who
gets notified," the actual decision to send — is a small custom Node.js
server we own and run ourselves. No Firestore, no Cloud Functions, no
Cloud Scheduler: those are optional Firebase products we are deliberately
**not** using here, to keep this on a plain Node process with flat-file
storage instead of tying the whole thing to Google Cloud billing.

## Why this shape

- The frontend stays a static site on GitHub Pages — no change there.
- Firebase Cloud Messaging (FCM) is the only Firebase piece involved: it
  delivers a push message to a specific browser/device. It's free with no
  practical limit for personal-app volume.
- The scheduler ("is anything due right now?") and the storage ("what did
  this device ask to be reminded about?") live in a Node server we control,
  so there's no Google Cloud billing account, no Firestore quota to think
  about, and the data format is just JSON files we can read by eye.

## Architecture

```
┌─────────────────────┐         register token / sync tasks        ┌──────────────────────┐
│  Daily Tasks PWA     │ ───────────────────────────────────────►  │  Node.js server        │
│  (GitHub Pages)      │                                            │  (Express + node-cron) │
│                       │ ◄─────────────────────────────────────── │                        │
│  Firebase JS SDK      │      (no direct connection back —         │  data/devices/*.json    │
│  gets an FCM token    │       server pushes via FCM instead)      │  one file per device    │
└─────────────────────┘                                            └──────────┬─────────────┘
                                                                                │ every minute,
                                                                                │ checks each
        ┌────────────────────────────────────────────────────────────────────┘ device's due
        │                                                                        items
        ▼
┌───────────────────────┐        admin.messaging().send()      ┌───────────────────┐
│ Firebase Cloud          │ ──────────────────────────────────► │  iOS / browser      │
│ Messaging (FCM)         │        (Google's push infra)         │  shows the alert    │
└───────────────────────┘                                       └───────────────────┘
```

Flow:
1. The PWA (once reinstated — see "Frontend work" below) asks for
   notification permission and gets an **FCM registration token** via the
   Firebase JS SDK. This works for **installed** PWAs on iOS 16.4+, or any
   modern browser tab elsewhere.
2. The PWA sends that token, plus its reminder-relevant tasks (events and
   daily-recurrence tasks — the only two types with an exact time), to our
   Node server, tagged with a `deviceId` generated once and kept in
   `localStorage`.
3. The server stores that in `data/devices/<deviceId>.json` — one file per
   device, never merged with any other device's data.
4. A `node-cron` job runs every minute, loads every device file, computes
   what's due "now" for that device, and for anything newly due, calls the
   Firebase Admin SDK to send a push to that device's token.
5. FCM delivers it through Apple/Google's native push infrastructure — this
   is what lets it arrive even if the PWA isn't open.

## What's schedulable (matches the current data model)

Only two ticket types carry an exact clock time today, so only these two
get pushed:

- **Event** — `date` + `time`, fires once.
- **Repetitive / daily** — a time slot fires every day at each generated
  `HH:MM` (e.g. 09:00, 11:00, ..., per the start/interval/end you set).

Weekly and monthly recurrence don't currently have a time-of-day field (see
the open question already noted in `entities.md`), so they're out of scope
for push alerts until/unless a time field is added to those forms too.
One-time tasks have no schedule at all, so they're never pushed.

## Data storage — one JSON file per device

`server/data/devices/<deviceId>.json`:

```json
{
  "deviceId": "6f2b1e9a-6c1e-4f2a-9d3a-2b6a1a9c9e4a",
  "token": "<FCM registration token>",
  "tasks": [
    { "id": "abc123", "type": "event", "label": "Dentist appointment", "date": "2026-08-05", "time": "14:00" },
    { "id": "def456", "type": "repetitive", "label": "Drink water",
      "recurrence": { "kind": "daily", "start": "09:00", "intervalHours": 2, "end": "20:00" } }
  ],
  "notifiedDate": "2026-08-01",
  "notifiedKeys": ["event:abc123", "slot:def456:09:00"],
  "updatedAt": "2026-08-01T10:03:00.000Z"
}
```

- `notifiedDate` / `notifiedKeys` is the server's memory of what it's
  already pushed today, so nothing fires twice. When the calendar date
  rolls over, `notifiedKeys` resets — this is the server-side equivalent
  of the client's daily-slot reset logic.
- `deviceId` is validated against `^[a-zA-Z0-9-]{8,64}$` before ever
  touching the filesystem (it's used to build a file path), so one device
  can never read or overwrite another's file, and there's no path-traversal
  risk from a malformed id.
- No database, no ORM — just `fs.readFile`/`fs.writeFile` on a small JSON
  file. Fine for a single-user personal app; would not scale to many
  concurrent writers, which isn't a concern here.

## Server endpoints (minimal Express app)

| Method | Path | Body | Purpose |
|---|---|---|---|
| `POST` | `/api/devices/:deviceId/register` | `{ token }` | Create/update a device's FCM token |
| `PUT`  | `/api/devices/:deviceId/tasks` | `{ tasks: [...] }` | Replace a device's synced task list (events + daily only) |
| `POST` | `/api/devices/:deviceId/test` | — | Force an immediate due-check for this device (doesn't wait for the next cron minute) — for testing |
| `GET`  | `/api/health` | — | Liveness check |

No authentication beyond the `deviceId` itself — acceptable for a personal,
low-stakes tool; noted here explicitly rather than silently skipped. If
this ever needs to be shared beyond one person, add a per-device secret.

## Cron / due-check logic

Runs every minute (`node-cron`, `* * * * *`). For each device file:

1. If `notifiedDate` isn't today, reset `notifiedKeys` to `[]` and set
   `notifiedDate` to today (daily reset).
2. For each `event` task not already in `notifiedKeys`: if `date`+`time`
   has passed, it's due.
3. For each daily-recurrence task, regenerate its time slots from
   `recurrence` and check each one not already in `notifiedKeys`: if the
   slot's time has passed, it's due.
4. For everything due: send `admin.messaging().send({ token, notification: { title: label, body } })`,
   then add its key to `notifiedKeys` and persist the file.
5. Same "don't retroactively fire for stuff already overdue" rule as the
   client had: when a task is *first synced*, anything already overdue at
   that moment is pre-marked as notified rather than firing immediately.

## Frontend work (not done yet — separate step)

The main app currently has **no** notification code (removed earlier,
temporarily). Reinstating it means, in `app.js`:

1. Add the Firebase JS SDK (via CDN `<script>` tags — no build step, matches
   the project's no-bundler approach).
2. On first user interaction, request Notification permission and call
   `getToken()` from Firebase Messaging to get this browser's FCM token.
3. Generate a `deviceId` once (`crypto.randomUUID()`), persist it in
   `localStorage`.
4. `POST` the token to `/api/devices/:deviceId/register`.
5. Whenever tasks change (add/edit/delete/toggle), `PUT` the current
   events + daily-recurrence tasks to `/api/devices/:deviceId/tasks`.
6. Register an `onBackgroundMessage` handler in `sw.js` so a push that
   arrives while the PWA is closed still shows a notification.

This is intentionally left out of this change — the plan and server exist
first so the backend can be stood up and tested independently before
wiring the frontend back in.

## Deployment note

The `server/` folder is a normal Node app — it does **not** get served by
GitHub Pages (Pages only serves static files and will simply ignore this
folder). It needs to run on its own host — see the earlier hosting
discussion (a small VPS, Fly.io, Oracle Cloud Free Tier, etc.). This plan
doesn't pick one; wherever it runs, it just needs a Node runtime, the
`server/` folder, its `.env`, and the Firebase service-account JSON.

## Setup & testing

See `firebase-setup-and-testing.md` for the step-by-step Firebase console
setup and how to test the full loop end-to-end using the included minimal
test page (`server/public/test-client.html`) — this validates FCM, the
server, and the cron job all work together without needing to reinstate
the frontend integration first.
