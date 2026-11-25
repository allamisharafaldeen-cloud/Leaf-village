# The Leaf Village — Manual

Your personal workout, study and sleep tracker. Live at https://allamisharafaldeen-cloud.github.io/Leaf-village/
Code: github.com/allamisharafaldeen-cloud/Leaf-village (main branch). Every push to main redeploys the app (GitHub Pages)
and the sync server (Cloudflare Worker, via GitHub Actions).

## How it works, in one minute
- Everything (XP, ranks, streaks, maxes, Ryō, scrolls) is **calculated from your logs**. Nothing is stored as a score, so
  nothing can drift. Past days cannot be edited.
- Data lives on each device (IndexedDB) and syncs through the Cloudflare Worker. Pictures, videos and sounds you add
  stay on the device you added them on.
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
- **One-time swap**: trade today's mission with tomorrow's, this week only.
- **On call** (Mission tab, 2 a week, today only): the day counts like an exam day: what you do still earns, nothing
  missed costs XP or breaks a streak, and no scroll is used.
- **Side quests** (Ninja tab): 3 optional challenges a week, picked by the week. Done = Ryō, missed = nothing.

## XP, ranks, streaks
- XP from sets, completed missions, tests, new maxes, rest days, study hours, good nights, weekly sensei challenges and
  beating your shadow clone (last weeks' you). Missed days cost XP and break the streak. Streak multiplies XP.
- Ranks follow total XP. Each rank has a cinematic that plays once at rank-up (replay in the Hokage Book).

## Ryō and Tsunade's Shop (Ninja tab)
- 5 XP gained = 1 Ryō. Missed days never take Ryō back.
- Skins (the 11 forms from other worlds), bounties (missions that unlock forms), card styles, titles, jutsu effects,
  Ichiraku Ramen (double Ryō for the day), Forbidden Scroll.

## Protection scrolls
- 7 unbroken days in an area (workout, study, sleep) → a scroll for that area (hold 2). 30 days → Rare (any area, hold 2).
  60 days → Forbidden (any area, hold 1; or buy for 3,000 Ryō, one a month).
- A missed day uses one automatically: area → Rare → Forbidden. The streak survives; the day gives no XP and no penalty;
  that area's count restarts. Counting started 24 Nov 2026.

## Settings worth knowing
- Rank wallpapers and scenes: up to 5 pictures + 1 video per rank (and a scene per bought form). On this device only.
- Tab backgrounds, sound effects, music, notifications, exam weeks, sleep goal.

## If something breaks
1. Close the app fully and reopen (gets the newest version).
2. Still broken: Settings → Backup → export, keep the file safe.
3. GitHub → Actions: the monthly **Health check** says whether the app, the sync server and the Cloudflare key are fine.
   Red = open the run and read the failed step. The Cloudflare key never expires.
4. To undo a bad change: GitHub → the repo → commits → find the last good one → "Revert" the bad commit. Pages and
   the Worker redeploy on their own within ~2 minutes.

## For whoever edits the code
- `index.html` is the whole app; `leaf-engine.js` is all the maths (also used by tests); `worker/src/engine.js` is the
  server copy of the maths — **any change to statuses, targets or XP must be made in both**.
- `sw.js`: bump `VERSION` on every release or phones keep the old version.
- Tests: `npm test` (unit + browser). Keep them green before pushing.
