# Firebase Setup & Testing Guide

Companion to `push-notifications-plan.md`. Follow this top to bottom to get
a real push notification landing on your phone.

## Part 1 — Create the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and
   click **Add project**. Name it whatever you like (e.g. "daily-tasks").
   You can decline Google Analytics — not needed here.
2. Once created, you're in the project dashboard.

## Part 2 — Register a Web app (gets you the public config)

1. On the project overview page, click the **`</>`** (web) icon to add a
   web app.
2. Give it a nickname (e.g. "daily-tasks-web"). You don't need Firebase
   Hosting — this app is on GitHub Pages.
3. Firebase shows you a `firebaseConfig` object — copy it, you'll need it
   in Part 5.

## Part 3 — Enable Cloud Messaging + get a VAPID key

1. In the console, go to **Project settings** (gear icon) → **Cloud
   Messaging** tab.
2. Under **Web configuration → Web Push certificates**, click **Generate
   key pair**. This gives you a VAPID key — copy it, you'll need it too.

## Part 4 — Generate the service-account key (for the server)

This is what lets your Node server send pushes — keep it secret.

1. **Project settings** → **Service accounts** tab.
2. Click **Generate new private key** → confirm. A JSON file downloads.
3. Move that file into `server/service-account.json` in this repo.
   **Never commit this file** — it's already in `server/.gitignore`.

## Part 5 — Configure the server

```bash
cd server
npm install
cp .env.example .env
```

Edit `.env`:
- `ALLOWED_ORIGIN` — your GitHub Pages URL (only matters once the main
  frontend is wired up; harmless for now).
- `FIREBASE_SERVICE_ACCOUNT_PATH` — leave as `./service-account.json` if
  you put the file where Part 4 says.

```bash
cp public/firebase-config.example.js public/firebase-config.js
```

Edit `public/firebase-config.js` and paste in:
- The `firebaseConfig` object from Part 2 → `window.FIREBASE_CONFIG`.
- The VAPID key from Part 3 → `window.FCM_VAPID_KEY`.

## Part 6 — Run the server

```bash
npm start
```

You should see:
```
[server] listening on :3000
[scheduler] running, checking every minute
```

Visit `http://localhost:3000/api/health` — should return `{"ok":true}`.

## Part 7 — Test the full loop (test-client.html)

This validates Firebase + the server + the cron job together, without
touching the main app yet.

1. Open `http://localhost:3000/test-client.html` in a browser.
   - **Testing on iPhone**: Safari on iOS only supports push for an
     *installed* PWA (Add to Home Screen), not a page in a regular tab —
     see the caveat at the end of this doc. For this first test, use a
     desktop browser (Chrome/Edge/Firefox) — regular tabs support push
     there, so it's the fastest way to confirm the backend works at all.
2. Click **1. Request permission & get token** — accept the browser's
   permission prompt. A token should appear.
3. Click **2. Register device** — should log `{"ok": true}`.
4. Set minutes to `1`, click **3. Sync test task to server** — this
   creates an "event" due one minute from now and syncs it.
5. Wait about a minute (the cron tick runs every minute), or click
   **4. Force check now** to skip the wait once the time has actually
   passed.
6. You should see a browser notification appear. If the test-client tab is
   focused when it arrives, you'll instead see it logged + an `alert()` (the
   "foreground message" path) — switch away from the tab or minimize the
   browser before the time hits to see the real notification banner.

If nothing arrives:
- Check the server's terminal output for `[scheduler] push failed for
  device ...` — the error message usually tells you exactly what's wrong
  (bad token, wrong project, etc.).
- Double-check `public/firebase-config.js` doesn't still have
  `REPLACE_ME` values.
- Make sure `server/service-account.json` is the file for the **same**
  Firebase project as `firebase-config.js`.

## Part 8 — Testing on your actual iPhone

1. Deploy the `server/` folder somewhere with a public HTTPS URL (see the
   "Deployment note" in `push-notifications-plan.md` — this can't run on
   `localhost` and be reached by your phone unless they're on the exact
   same network and you use your Mac's local IP, which is fine for a quick
   test too: find it via `ipconfig getifaddr en0`, then visit
   `http://<that-ip>:3000/test-client.html` from your phone — note this
   is HTTP, not HTTPS, so push will **not** work this way; it's only
   useful for confirming the page loads. Real push testing on iOS needs a
   real HTTPS deployment.)
2. Once deployed with HTTPS, add the *deployed* `test-client.html` URL to
   your iPhone's Home Screen (Share → Add to Home Screen).
3. Open it **from the Home Screen icon**, not Safari — this is the part
   that's easy to get wrong and silently fail.
4. Repeat steps 2–6 from Part 7 on the phone.
5. Lock your phone or switch to another app before the scheduled time —
   that's the real test of "does this work when closed."

## Known limitations (by design, for this minimal setup)

- No auth beyond the `deviceId` — fine for personal use, noted in the plan.
- Only `event` and daily-recurrence tasks get pushed (weekly/monthly have
  no time-of-day field yet).
- `npm audit` will show a handful of moderate-severity transitive
  advisories (a `uuid` bounds-check issue) pulled in by `firebase-admin`'s
  own dependencies — upstream, not something this project introduced;
  worth an occasional `npm audit` re-check but not urgent for a personal
  single-user server.
- The main app's frontend isn't wired up yet (no `deviceId`/token
  registration or task sync from `app.js`) — that's the next step once
  this backend is confirmed working, per the plan doc.
