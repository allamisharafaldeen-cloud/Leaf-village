# Fable session 2 · Audit, tests and new features

You are working on **The Leaf Village**, Sharaf's personal training-and-study tracker: pull-ups and dips with grease-the-groove days and a Friday max test, study hours, Naruto-style ranks (Academy Student to Hokage), XP, workout and study streaks, four senseis with weekly challenges. It is a home-screen web app on his iPad, hosted on GitHub Pages from this repository. Sharaf is the only user, a final-year medical student. He values a strict, honest app: no editing past days.

Read `README.md`, `docs/fable-session-1.md` (what session 1 built: sync and push reminders) and the code before changing anything. Work on `main` in small commits, each tested.

## Part A · Audit and harden (do this first)

1. **Read the whole engine** (`compute()`, `computeStudy()`, `planFor()`, `studyTarget()`, streaks, XP, awards, exam weeks, shields, Thursday off-day study, combos) and list real bugs with concrete failing cases. Fix them. Pay special attention to: midnight and timezone edges (the device is in Asia/Baghdad), the study timer crossing midnight, schedule changes that start tomorrow, exam weeks overlapping shields, a rank ladder change after promotions (`settings.celebrated` and `settings.themeRank` store rank indexes), import of malformed backups, and storage being full.
2. **Fix three known bugs** Sharaf reported earlier:
   - Logging a set makes the open mission scroll roll up or jump. It should stay open and in place.
   - The toast message covers the music player bar at the bottom.
   - Every tap re-renders the whole page, which feels heavy on the iPad. Reduce work: update only what changed, or at least keep scroll position, open scrolls, focus and running animations stable across renders.
3. **Add automated tests** in `tests/` (Node + Playwright; Chromium is pre-installed, `require('playwright')` works, do not reinstall browsers). Cover the engine with fixed-date fixtures (XP totals, streaks, ranks, study statuses, combos, shields, exam weeks) and the UI flows (log set, undo, study timer, import, backup, theme picker, rank wallpapers on every tab). Make them runnable with one command and document it in `README.md`.

## Part B · New features (in this order; stop when time runs out and list what's left)

Keep everything consistent with the existing look (scroll cards, sensei voices, rank colours) and **write original text, never quotes from the anime**. No feature may allow editing past data.

1. **Monthly Mission Report**: on the 1st of each month (and from the Stats tab any time), a report for the previous month: study hours (total, best day, days at minimum/goal), total reps per exercise, max changes, missions done/missed, streak records, XP gained, rank changes, achievements earned, and a short Third Hokage summary. Downloadable as a PDF or image through the existing downloads layer.
2. **Auto-progression**: after each Friday test, suggest next week's groove settings (sets, minimum sets, % of max) from the new maxes and recent completion rates. Show it as a Kakashi card with Accept / Keep mine. Accepting saves a schedule entry starting tomorrow, like the Plan tab does.
3. **Exam countdown**: set an exam name and date in Settings. Show days left on the Mission tab and study hours banked since it was set. The Third Hokage's study lines get more focused in the last 14 days. Separate from the exam-week pass, though it can suggest starting one.
4. **Achievements wall**: a proper gallery in the Ninja tab for the existing achievements plus new ones (for example 100/500/1,000 study hours, 30-day streaks, a perfect month, every column filled for a week, first new max of each exercise, Comeback). Some are hidden until earned. Earning one shows a small moment and a sound.
5. **Shadow clone rival**: a weekly race against himself from four weeks earlier: same weekday-by-weekday comparison of XP, reps and study hours. A small card on the Mission tab ("Your shadow clone had 22h by Wednesday. You have 19h.") and a win/lose result on Sunday, with a small XP bonus for winning (suggest +50; keep it modest).
6. **Story arcs**: each calendar month is a chapter with a generated title from what happened (ranks, records, comebacks). When a month ends, show a short recap scene using the rank wallpapers.
7. **Focus cycles**: an optional study-timer mode: 50 minutes of work, then a 10-minute "chakra recovery" break with a gentle sound. Only work time counts as study. The existing 3-hour "Still studying?" check must keep working.
8. **Jutsu unlocks**: harder pull-up and dip variations unlock at ranks (for example archer pull-ups, L-sit pull-ups, weighted dips). Unlocking only makes them available. They join the plan only if Sharaf adds them, and they need their own baseline test.

## Rules

- XP thresholds (Hokage at 77,500), existing XP rules, streak rules, shields, exam weeks and Thursday off-day rules must not change unless a fix requires it. If one does, explain why in your final message.
- Keep the app working offline and with sync (from session 1).
- Bump `VERSION` in `sw.js` and update `FILES` when files change.
- Before finishing, run the full test suite and check the app at iPad size (1148×802 landscape and 820×1180 portrait) with screenshots you look at yourself.

## When you finish

Reply to Sharaf in plain, friendly words (he is not a programmer): what changed, what to try first on his iPad, and what's left for later. Keep it short.
