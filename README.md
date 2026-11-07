# The Leaf Village

Sharaf's personal training and study tracker: pull-up and dip missions, study hours, ranks from Academy Student to Hokage, XP and streaks.

**Open it:** add this site to your iPhone home screen from Safari (Share → Add to Home Screen) and always open it from that icon.

**Where data lives:** on the phone only, in the browser's storage for this site. Nothing is uploaded. Download a backup from Settings every week.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app: screens, game rules, styles |
| `platform.js` | Saving on the phone (IndexedDB), added photos and sounds, and the backup download. Swap this file to add sync later |
| `sw.js` | Offline support: keeps the app, photos and music cached |
| `media/` | Photos, music and sound effects, named by their asset id |
| `ranks/` | Rank photos |
| `icons/`, `manifest.webmanifest` | Home-screen icon and app name |

When a file changes, update the `VERSION` in `sw.js` so phones fetch the new copies.
