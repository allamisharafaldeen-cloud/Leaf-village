# The Leaf Village — Manual

Your personal workout, study and sleep tracker. Live at https://allamisharafaldeen-cloud.github.io/Leaf-village/
Code: github.com/allamisharafaldeen-cloud/Leaf-village (main branch). Every push to main redeploys the app (GitHub Pages)
and the sync server (Cloudflare Worker, via GitHub Actions).

## How it works, in one minute
- Everything (XP, ranks, streaks, maxes, Ryō, scrolls) is **calculated from your logs**. Nothing is stored as a score, so
  nothing can drift. Past days cannot be edited.
- Data lives on each device (IndexedDB) and syncs through the Cloudflare Worker. Pictures, videos and sounds you add
  stay on the device you added them on.
- Sync rules: logged sets and study minutes from two devices are always joined. Settings: the latest edit wins,
  except purchases, used scrolls, claimed quests and deload weeks, which are never lost whichever device edits last.
- Settings → Backup exports everything (except your own pictures/videos) to a .json file. Import restores it.

## Training
- **Groove days**: mini-sets at a % of your max (default 50%), never to failure. Finish the minimum sets to complete.
- **Friday test**: 2 sets to failure per exercise. The best set becomes your max and sets next week's targets.
- **Weights**: the picker above the reps (− / +, 2.5 kg steps). Your working weight = the weight of your latest test.
  The first test of each month is a bodyweight check (keeps the working weight). Hit 12 at your weight → the next test
  suggests +2.5 kg. Weighted reps earn XP × (bodyweight + weight) ÷ bodyweight. Bodyweight comes from your weigh-ins.
- **Strength score** (Stats): estimated one-rep max = (bodyweight + weight) × (1 + reps ÷ 30), from sets of 12 or fewer.
- **Skill tree** (Ninja): moves unlock by bodyweight max (Pull by pull-ups, Push by dips). Unlocking is a badge; a move
  only joins training after its baseline test and if you add it to a day in the Plan tab.
- **Rest timer** (Friday test): starts by itself after each test set (3 min by default; 2–5 min chips, +30 s, Skip).
  A bell rings at zero. No timer after the last set.
- **Plateau → deload week**: if a max at the same weight hasn't beaten the earlier best for 3 Friday tests, Kakashi
  offers a lighter week on the Mission tab: half the groove sets, a share 15% lower (never under 30%), no Friday
  test. It starts the next day and lasts 7 days. It still has to be done (it counts like a normal day). At most one
  every 28 days; "Keep pushing" hides that offer. A deload week can't be cancelled.
- **Goals** (Stats): up to 6, e.g. 20 pull-ups or 10 dips at +20 kg. The date is a straight line through your test
  maxes of the last 8 weeks (needs 3 tests). Weighted goals use the strength score converted to reps at that weight.
- **Progress photos** (Stats): front, side, back, once a month. The camera shows a faint copy of the last photo of
  that pose to line up with, has a 5/10 s timer and moves on to the next pose by itself. Compare any two dates side by
  side (with the weight and tape changes if you weighed in within 10 days). **On this device only**, not synced, not in
  the backup file.
- **Sleep rhythm** (Stats → Sleep): how steady your bed and wake times are over the last 14 nights (a stat, no XP).
  Usual time = the median; drift = the average distance from it. Score = 100 − the average of the two drifts in
  minutes (85+ Like clockwork, 70+ Steady, 50+ Uneven, below Irregular). Needs 5 nights with both times; on-call
  nights are left out. The chart shows each night as a bar from falling asleep to waking.
- **One-time swap**: trade today's mission with tomorrow's, this week only.
- **On call** (Mission tab, 2 a week, today only): the day counts like an exam day: what you do still earns, nothing
  missed costs XP or breaks a streak, and no scroll is used.
- **Weekly quests** (Ninja tab), one card with two parts:
  - *Sensei challenges*: Kakashi, Guy, Jiraiya, the Third Hokage (Village duty and Scholar's week). Bonus XP is added
    by itself the day you finish one. A lost one (a missed mission for Village duty) is greyed out.
  - *Side quests*: 3 optional challenges a week, picked by the week. A finished one shows a red badge on the Ninja tab
    and the card; tap Claim to collect the Ryō. Rewards left from earlier weeks gather in one "Claim all" row.
    Missed = nothing.

## XP, ranks, streaks
- XP from sets, completed missions, tests, new maxes, rest days, study hours, good nights, weekly sensei challenges and
  beating your shadow clone (last weeks' you; the race and the week strip are on the Stats tab). Missed days cost XP
  and break the streak. Streak multiplies XP.
- Ranks follow total XP. Each rank has a cinematic that plays once at rank-up (replay in the Hokage Book).

## Ryō and Tsunade's Shop (Ninja tab)
- 5 XP gained = 1 Ryō. Missed days never take Ryō back.
- Skins (18 forms from other worlds), bounties (missions that unlock forms), card styles, titles, jutsu effects,
  Ichiraku Ramen (double Ryō for the day), Forbidden Scroll.

- Second wave (added 28 Nov 2026): Thorfinn, Gabimaru, Zuko, Mark Grayson, Aang, Vegeta, Goku. Their missions
  count only from 29 Nov 2026, so none of them unlocked or paid a bounty for earlier logs.
  - Thorfinn (Uncommon): 12 workout missions done. Gabimaru (Rare): 3 sets before 9 am on 12 days.
  - Zuko (Rare): a new max with added weight on 3 test days. Mark Grayson (Rare): 5+ hours of study on 14 days.
  - Aang (Epic): one Sunday-to-Saturday week with every workout mission, the study target every study day, 5 good
    nights and a weigh-in. Vegeta (Epic): 9,001 XP earned. Goku (Legendary): both maxes 5 above the best before 29 Nov.

## Protection scrolls
- 7 unbroken days in an area (workout, study, sleep) → a scroll for that area (hold 2). 30 days → Rare (any area, hold 2).
  60 days → Forbidden (any area, hold 1; or buy for 3,000 Ryō, one a month).
- A missed day uses one automatically: area → Rare → Forbidden. The streak survives; the day gives no XP and no penalty;
  that area's count restarts. Counting started 24 Nov 2026. The sync server knows the same rules, so a reminder never
  calls a covered day missed, even before the app has been opened.

## Settings worth knowing
- Rank wallpapers and scenes: up to 5 pictures + 1 video per rank (and a scene per bought form). On this device only.
- Tab backgrounds, sound effects, music, notifications, exam weeks, sleep goal.
- Launch screens (`splash/`): iOS shows them while the app opens. iOS picks them up when the app is added to the Home
  Screen. Don't delete the old icon to get them: that wipes the pictures, videos, music and photos stored on the
  device.

## If something breaks
1. Close the app fully and reopen (gets the newest version). An app left open in the background also updates itself
   the next time you come back to it.
   Settings → Backup lists any problem the app noticed on that device; "Copy for Claude" copies the list to paste.
2. Still broken: Settings → Backup → export, keep the file safe.
3. GitHub → Actions: the monthly **Health check** says whether the app, the sync server and the Cloudflare key are fine.
   Red = open the run and read the failed step. The Cloudflare key never expires.
4. To undo a bad change: GitHub → the repo → commits → find the last good one → "Revert" the bad commit. Pages and
   the Worker redeploy on their own within ~2 minutes.

## For whoever edits the code
- `index.html` is the whole app; `leaf-engine.js` is all the maths (also used by tests); `worker/src/engine.js` is the
  server copy of the maths — **any change to statuses, targets or XP must be made in both**.
- `sw.js`: bump `VERSION` on every release or phones keep the old version.
- Deploys: `.github/workflows/worker.yml` (actions/checkout@v7, setup-node@v7 on Node 24, Wrangler 4). GitHub Pages
  deploys the app by itself. The Worker keeps a checkpoint of its running totals (v3, includes the scroll inventory).
- New forms: generate the full picture (prompt doc in the Project), save it to `guests/originals/<id>.jpg`, run
  `python3 tools/make_guest.py <id>=guests/originals/<id>.jpg` (needs `pip install rembg`), paste the printed
  GUEST_ART entry into index.html, and add the form to TRANSFORMS and RARITY_OF in leaf-engine.js with a `from` date.
- **Friends' copy** (`open/`, link: `.../Leaf-village/open/`): the same app for friends and family, generated by
  `python3 tools/build_open.py` (needs Pillow). Device-only: its own IndexedDB names and an `open:` prefix on every
  localStorage key (so it never mixes with the main village, even on the same phone), no sync, no notifications, no
  forms, no rank-up videos; rank figures are leaf crests on scenery, its own icon, launch screens and service worker
  (`leafopen-` caches; the main worker skips `/open/`). Setup lets them pick two exercises (pull-ups, chin-ups,
  inverted rows or push-ups; dips, push-ups, squats or pike push-ups). Rebuild it after every app change: the unit
  test `open.test.mjs` fails until you do. Tell friends to export a backup now and then (Settings → Backup).
- Tests: `npm test` (unit + browser + a short random-data check). `npm run test:fuzz` runs 200 random villages
  through the app maths and the server maths and fails if they disagree. Keep them green before pushing.
