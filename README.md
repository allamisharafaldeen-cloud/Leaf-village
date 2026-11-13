# The Leaf Village

Sharaf's personal training and study tracker: pull-up and dip missions, study hours, ranks from Academy Student to Hokage, XP and streaks.

**Open it:** add this site to your iPad or iPhone home screen from Safari (Share → Add to Home Screen) and always open it from that icon.

**Where data lives:** on the device first, in the browser's storage for this site. With **Sync** turned on (Settings → Sync), every change is also copied to a small online database you own (Cloudflare, free tier), so your logs survive a lost device and follow you to another one. Photos, sounds and music you add stay on the device you added them on. A weekly backup download from Settings is still a good habit.

**Reminders:** with sync on, Settings → Reminders → *Turn on notifications*. The senseis then send one short notification at 5:40, 11:40, 17:40 and 22:40 (Baghdad time), written from what was really logged that day. Needs iPadOS/iOS 16.4 or newer and the home-screen icon.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app: screens, game rules, styles |
| `platform.js` | Saving on the device (IndexedDB), added photos and sounds, the backup download, and background sync (`window.LeafSync`) |
| `leaf-merge.js` | The merge rules shared by the app and the Worker: days are joined, never replaced |
| `sw.js` | Offline support (keeps the app, photos and music cached) and showing notifications |
| `worker/` | The Cloudflare Worker: sync endpoints, the reminder rules and sensei lines, Web Push, database migrations |
| `.github/workflows/worker.yml` | Deploys `worker/` to Cloudflare on every push to `main` that touches it |
| `media/`, `ranks/` | Photos, music, sound effects and rank art |
| `icons/`, `manifest.webmanifest` | Home-screen icon and app name |
| `tests/` | Automated tests (see below) |

When a file the app loads changes, update the `VERSION` in `sw.js` (and add new files to `FILES`) so devices fetch the new copies.

## How sync works

- The app saves locally exactly as before. If a sync key is set, changed documents are pushed to the Worker and documents changed elsewhere are pulled, in the background. If the server can't be reached nothing in the app waits or errors; it catches up later.
- **Workout days and study days are merged as a union** of their entries (by time and value), then sorted, so two devices never overwrite each other's sets or study minutes. The app's own Undo leaves a small "removed" note so the undone entry disappears everywhere and stays gone. `shield` and `offday`: true wins.
- Settings, prefs, media list, timer and weigh-ins: the latest edit wins.
- First sync uploads everything on the device. A new device types the key on the enrollment screen and pulls everything down.
- The Worker rejects every request without the sync key (`LEAF_SYNC_KEY`, a Worker secret) and only accepts browsers coming from `https://allamisharafaldeen-cloud.github.io`.

## Deploying the Worker

Pushing to `main` runs the workflow, which creates the D1 database the first time, applies `worker/migrations`, deploys with Wrangler, stores `LEAF_SYNC_KEY` as a Worker secret and smoke-tests the live Worker. It needs three repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `LEAF_SYNC_KEY`. The push (VAPID) keys are generated once by the Worker and kept in the database, so they stay the same across deploys.

## Tests

Needs Node 22+. The browser tests also need Playwright with Chromium.

```bash
node --test "tests/unit/*.test.mjs"
```

```bash
node --test tests/e2e/app.test.mjs
```

- `tests/unit`: merge rules, the reminder decisions at fixed dates (groove day behind, mixed day partly done, test day, rest day, Thursday, shield used, exam week, Sunday report, last call with the shield available, switches), push encryption, the sync endpoints against a real SQLite database, and the engine checkpoint.
- `tests/e2e`: the real app in Chromium served under `/Leaf-village/`, syncing against the real Worker code: import/export unchanged, the Worker's engine agrees with the app's, offline use, two devices merging without losing entries, Undo, settings, and the notification path end to end.
- `tests/fixtures/backup.json` is a backup-shaped file with ten weeks of made-up history (`node tests/make-fixture.mjs` rebuilds it).
