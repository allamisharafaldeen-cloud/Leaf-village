# Fable session 1 · Sync and smart sensei reminders

You are working on **The Leaf Village**, Sharaf's personal training-and-study tracker (pull-ups, dips, study hours, Naruto-style ranks, XP and streaks). It is a home-screen web app on his iPad, hosted on GitHub Pages from this repository (`main` branch, root folder). Sharaf is the only user. He is a final-year medical student; the app must stay strict and honest.

Read this whole brief, then `README.md`, `platform.js`, `sw.js` and the parts of `index.html` you need. Work on `main` in small, tested commits.

## Goal

1. **Sync**: his data is saved on the device *and* in a small online database he owns, so it survives a lost iPad and works on more than one device.
2. **Smart reminders**: real push notifications at 5:40, 11:40, 17:40 and 22:40 (Asia/Baghdad), written in the voices of four senseis, based on his actual progress that day.

Everything must run on **Cloudflare's free tier**. No paid services, no AI APIs.

## What already exists (do not break)

- `index.html` is the whole app (about 3,100 lines): views, game engine (`compute()`), styles. It talks to storage only through `window.claude.use('db' | 'assets' | 'downloads')`, which `platform.js` provides.
- `platform.js` is the storage layer: an IndexedDB store of documents keyed by path, with `doc(path).onSnapshot/set/get` and `collection(path).onSnapshot`. **Add sync here**, so `index.html` barely changes.
- Document paths (see `PATH` in `index.html`):
  - `leaf/main` settings (schedule history, baselines, notify switches, studyStart, examWeeks, …)
  - `leaf/main/days/<YYYY-MM-DD>` workout day `{date, sets:[{ex, reps, t}]}`
  - `leaf/main/study/<YYYY-MM-DD>` study day `{date, entries:[{start, end, min, src}], shield, offday}`
  - `leaf/main/body/<YYYY-MM-DD>` weigh-in
  - `leaf/prefs`, `leaf/media`, `leaf/timer`, `leaf/summary`
- Media files (photos, music) live in `media/` and `ranks/`, plus user uploads in IndexedDB `blobs`. **Uploads do not need to sync** in this session; mention it in your final notes.
- Backup download/import in Settings must keep working and keep the same JSON format.
- `sw.js` caches the app for offline use. Bump `VERSION` when files change and add any new static files to `FILES`.

## Rules that must never change

- No editing or deleting past days. Logged sets and study entries are append-only (the app's own Undo only removes the most recent entry, today).
- XP rules, rank thresholds, streak rules, shields, exam weeks and the Thursday off-day study rules stay exactly as they are.
- The app must keep working fully offline. Sync is a background extra: if the server is unreachable, nothing in the app blocks or errors.

## Sync design (requirements)

- **Backend**: a Cloudflare Worker in `worker/` with a D1 database (or KV if you can justify it). Endpoints for pushing changed documents and pulling documents changed since a cursor.
- **Auth**: single user. Use a long random sync key, stored as a Worker secret (`LEAF_SYNC_KEY`) and entered once in the app's Settings (stored on the device). Reject everything without it. CORS limited to `https://allamisharafaldeen-cloud.github.io`.
- **Merging must never lose a logged set or study minute.** Days and study docs: merge entries as a union (by timestamp and value), then sort. `shield` and `offday`: true wins. Settings/prefs/media/timer: last-write-wins with a server timestamp.
- **First sync**: upload everything already on the iPad. A second device that syncs pulls everything down.
- Settings gets a small **Sync** card: status (last synced time, or the error in plain words), the sync key field, and a "Sync now" button.

## Reminders design (requirements)

- Web Push with VAPID keys (keys stored as Worker secrets). iPadOS supports push for home-screen web apps on 16.4 and newer, and permission must be requested from a tap: add a "Turn on notifications" button to the existing Reminders card in Settings. Store the push subscription in the database.
- A Worker **cron trigger** at 02:40, 08:40, 14:40 and 19:40 UTC (5:40, 11:40, 17:40 and 22:40 in Baghdad) reads the synced data and decides what to send.
- The existing notify switches in `leaf/main` (`notify: {enabled, briefing, streak, test, promotion, weekly, study}`; missing means on) control everything.
- **Port these rules exactly** (they ran in the old Claude-hosted version):
  - Slots: 5:40 MORNING, 11:40 MIDDAY, 17:40 EVENING, 22:40 LASTCALL.
  - **Exam week** (today inside any `settings.examWeeks` item): no streak or study nags; in the MORNING only, one calm good-luck line from the Third Hokage naming the day of the exam week.
  - **Workout mission**: entry = latest `settings.scheduleHistory` item with `from <= today`; day = `entry.plan[weekday, Sunday=0]`, type `gtg` (one exercise `ex`), `combo` (several `exs`), `test`, or `rest`. Target reps = `max(1, round(max * entry.gtg.pct / 100))`, using the latest test max, else `settings.baseline[ex].max`. gtg done = at least `entry.gtg.minSets` sets of `ex` at or above target. combo done = every exercise has at least `entry.combo.sets` (default 3) sets at target. test done = each `entry.test.ex` has at least `entry.test.sets` sets. Missing a groove/mixed day costs 100 XP, a test day 150, and resets the workout streak.
  - **Workout sensei**: Sunday that isn't test/rest = Third Hokage; test day = Guy; rest day = Jiraiya; other groove/mixed days = Kakashi.
  - **Study** (only if `settings.studyStart <= today`): targets come from the active schedule entry's `study` field (`{week:{min,full}, end:{min,full}}` in minutes; defaults Sun–Wed 240/360, Fri–Sat 360/480). Thursday has no target (off-day study is optional and never at risk). Minutes = sum of `entries[].min` plus a running timer (`leaf/timer`: if `state==='running'`, add `(min(now, checkAt) - segStart)/60000`). Shielded days get no study reminder. The shield is still available if none was used this Sunday-to-Saturday week.
  - **MORNING**: workout briefing from the day's sensei (sets × reps; rest = recovery; test = maxes to beat and Guy's +100 XP for a new max). Plus the Third Hokage's study target. On Sundays (if `weekly`), lead with a weekly report for last week: reps per exercise, missions done vs missed, study hours, XP, new maxes.
  - **MIDDAY / EVENING / LASTCALL workout**: if `streak` is on, not a rest day and the mission isn't done, a reminder with real progress (on mixed days give each exercise, e.g. "pull-ups 2/3, dips 1/3"). LASTCALL is the most urgent.
  - **Study**: MIDDAY only if 0 minutes; EVENING if below the minimum; LASTCALL whenever below the minimum, with the exact time still needed and, if the shield is unused this week, a reminder that he can tap "Protect my streak" before midnight if today was truly hard.
  - **EVENING**: if `promotion` is on and the next rank is 300 XP or less away, a short Third Hokage line.
  - **Rest-day EVENING**: Jiraiya may remind him to log his weight if the weekly weigh-in challenge isn't done.
  - Nothing applies: send nothing.
- **Format**: one notification, plain text, up to 3 short lines, one per sensei, each starting with the sensei's name and a colon, under 320 characters, with real numbers.
- **Lines**: write a large pool of **original** lines per sensei and situation (at least 6 per situation) with placeholders for numbers. Never quote the anime. Voices: Kakashi calm, dry, a little teasing, precise about form; Guy loud and fiery with exclamation marks; Jiraiya playful, boastful "great sage", jokes about his research (keep it clean); Third Hokage warm, wise, patient. Avoid repeating a line on consecutive days.
- XP-to-next-rank and streak numbers: compute them in the Worker from the synced data, or have the app write `leaf/summary` (it already does via `writeSummary`) and sync it. Prefer computing from raw data where it matters (mission done, study minutes).

## Deployment

The session's network can usually reach GitHub but not Cloudflare. So deploy through **GitHub Actions**:
- Add `.github/workflows/worker.yml` that deploys `worker/` with Wrangler on pushes to `main` that touch `worker/`.
- Sharaf has added these repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `LEAF_SYNC_KEY` (a long password he made up and will type into the app once). Create D1, apply migrations and set Worker secrets from the workflow (pass `LEAF_SYNC_KEY` through as a Worker secret).
- VAPID keys must stay stable across deploys. Generate them once and keep them safely (for example as repository secrets you ask Sharaf to add, with exact copy-paste steps, or generated once by the Worker and stored in D1). Never print a private key in logs.
- Check the Actions run results with the GitHub tools and fix failures.

## Testing (required)

- Playwright (Chromium is pre-installed; `require('playwright')` works; do not reinstall browsers) against a local copy served under a `/Leaf-village/` path.
- Use a backup-shaped test file. Prove: offline use still works; two simulated devices merge without losing entries; Undo still removes only the last entry; import/export unchanged; no page errors.
- Unit-test the reminder decision function with fixed dates covering: gtg day behind, combo day partly done, test day, rest day, Thursday, shield used, exam week, Sunday report, last call with shield available.

## When you finish

Reply to Sharaf in plain, friendly words (he is not a programmer): what's live, the exact taps to turn on sync and notifications on his iPad, anything he must do (secrets, keys), and anything left undone. Keep it short.
