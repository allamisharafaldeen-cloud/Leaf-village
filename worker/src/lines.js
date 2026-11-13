/* The Leaf Village · reminder lines.
   Original lines written in each sensei's voice (never quotes from the anime).
   Kakashi: calm, dry, a little teasing, precise about form.
   Guy: loud and fiery, exclamation marks.
   Jiraiya: playful, boastful "great sage", jokes about his research.
   Third Hokage: warm, wise, patient.
   {placeholders} are filled with real numbers by reminders.js. Keep every line short:
   a notification holds up to three lines and must stay under 320 characters. */

export const SENSEI_NAMES = { kakashi:'Kakashi', guy:'Guy', jiraiya:'Jiraiya', hiruzen:'Third Hokage' };

export const LINES = {
  /* ---------- Kakashi · groove and mixed days ---------- */
  'kakashi.brief.gtg': [
    'Yo, {name}. Today: {need} × {target} {ex}. Strict reps, long breaks, no heroics.',
    'Groove day. {need} sets of {target} {ex}, each as clean as the first. I\'ll be reading nearby.',
    '{need} × {target} {ex} today. Stop every set while it still feels easy. That\'s the whole trick.',
    'Morning. {need} × {target} {ex}, full range, slow on the way down. Start early; lateness is my job.',
    'Today\'s order is short: {need} sets of {target} {ex}. Do {goal} if they stay crisp.',
    '{name}, {need} × {target} {ex}. Boring, precise, repeatable. That\'s how strength sneaks up on you.',
    'Mission: {need} sets of {target} {ex}, spread through the day. Every rep should look the same.'
  ],
  'kakashi.brief.combo': [
    'Mixed day, {name}: {combo}. Alternate them and keep every rep honest.',
    'Two grooves today: {combo}. Space the sets out; tired reps teach bad habits.',
    'Today: {combo}. Full range, no rushing, stop before it gets ugly.',
    'Yo. {combo}. Pair a set of each, rest long, repeat. Simple enough even for me.',
    'Mission: {combo}. Quality first on both. I\'ll know if the last reps get lazy.',
    '{combo} today. Small visits to the bar, not one heroic session.'
  ],
  'kakashi.midday': [
    'Midday check: {progress}. Plenty of daylight left; use it.',
    '{progress} so far. Sneak a set in now while you\'re fresh.',
    'Yo. {progress}. The bar hasn\'t moved, and neither has the target.',
    'Noon report: {progress}. One clean set before lunch would be a smart move.',
    '{progress}. Not behind yet, {name}, but afternoons go faster than you think.',
    'Half the day gone and it\'s {progress}. A set now keeps tonight calm.'
  ],
  'kakashi.evening': [
    'Evening. {progress}. Finish before you\'re tired; sloppy reps don\'t count for much.',
    '{progress} and the sun is going down. Knock the rest out, strict as ever.',
    'Still {progress}. I\'m patient, {name}, but midnight isn\'t.',
    '{progress}. A couple of short visits to the bar tonight and the mission is closed.',
    'Evening check: {progress}. {stake} rides on the rest. Keep the form clean.',
    'It\'s {progress}. Start now and you can still take long rests between sets.'
  ],
  'kakashi.lastcall': [
    'Last call. {progress}. Finish before midnight or it costs you {stake}.',
    '{progress} with the day almost gone. {stake} on the line. Clean sets, now.',
    'Even I\'d worry about being this late. {progress}. Midnight takes {stake}.',
    '{name}, it\'s {progress}. A few strict sets now save {stake}. Go.',
    'Final check: {progress}. Rest between sets, but finish by midnight. {stake} at stake.',
    'The day ends at midnight. {progress}. Don\'t hand over {stake} for nothing.'
  ],

  /* ---------- Third Hokage · Sunday missions ---------- */
  'hiruzen.brief.gtg': [
    'A new week, {name}. Open it with {need} × {target} {ex}, done with care.',
    'Sunday sets the tone. {need} sets of {target} {ex} today, one patient set at a time.',
    'The week begins with {need} × {target} {ex}. Small duties, kept daily, build great strength.',
    'Good morning, {name}. Today\'s duty: {need} sets of {target} {ex}. Begin well and the week follows.',
    'A fresh week lies ahead. {need} × {target} {ex} today; let each rep be a promise kept.',
    'Start the week steady: {need} sets of {target} {ex}. There is no hurry, only consistency.'
  ],
  'hiruzen.brief.combo': [
    'A new week, {name}. Today: {combo}. Give each set your full attention.',
    'Sunday\'s duty is {combo}. Take them in turn, with patience.',
    'The week opens with {combo}. Do them well rather than quickly.',
    'Good morning. {combo} today. Two skills tended on one day; both deserve care.',
    'Begin the week with {combo}. Steady hands, steady breath, {name}.',
    'Today: {combo}. A week started with care is half won.'
  ],
  'hiruzen.midday': [
    'Midday on the week\'s first day: {progress}. A set now would be time well spent.',
    '{progress} so far, {name}. The afternoon is long; begin when you are ready, but do begin.',
    'It stands at {progress}. A little now is kinder than a lot tonight.',
    'Noon has come and it is {progress}. One calm set before your next cup of tea.',
    '{progress}. There is time yet, and time is best spent early.',
    'The day is half spent and the count is {progress}. Step up to the bar, {name}.'
  ],
  'hiruzen.evening': [
    'Evening, {name}. {progress}. Finish the week\'s first duty before you rest.',
    '{progress} as the lamps are lit. The remaining sets are waiting patiently for you.',
    'The count is {progress}. {stake} rests on tonight; I trust you to see it through.',
    'It is evening and {progress}. Close the mission while your strength is still good.',
    '{progress}. A promise made on Sunday morning should be kept by Sunday night.',
    'Still {progress}, {name}. One set at a time; that is how every long road is walked.'
  ],
  'hiruzen.lastcall': [
    'The night is late, {name}. {progress}. Midnight would take {stake}; finish now.',
    '{progress} and little time remains. Do not let {stake} slip away tonight.',
    'Last call. {progress}. A few careful sets before midnight keep {stake} safe.',
    'It is nearly midnight and {progress}. Rise once more, {name}; {stake} depends on it.',
    '{progress}. The village sleeps, but your duty is not yet done. {stake} is at risk.',
    'Before the day closes: {progress}. Protect {stake}, then rest well.'
  ],

  /* ---------- Guy · test days ---------- */
  'guy.brief.test': [
    'TEST DAY, {name}! Maxes to beat: {maxes}! A new max wins my +100 XP challenge!',
    'Today we find your limit and step past it! Beat {maxes} and claim +100 XP from me!',
    'Rise and shine! {sets} all-out sets each! Numbers to crush: {maxes}! +100 XP for a new max!',
    'This is the day you trained for! {maxes} are yesterday\'s records! Break one for +100 XP!',
    'Warm up well, then give everything! Targets: {maxes}! One new max and +100 XP is yours!',
    'I can feel it, {name}! Today {maxes} fall! My challenge pays +100 XP for a new max!',
    'Test day! Rest fully between sets and leave nothing behind! Beat {maxes} for +100 XP!'
  ],
  'guy.midday': [
    'Midday and the test stands at {progress}! Warm up and attack the bar!',
    '{progress} so far! Your muscles are rested and ready! Show them what today is for!',
    'Noon check: {progress}! A champion doesn\'t wait for the perfect moment! Make it now!',
    '{progress}! The test sets are calling your name, {name}! Answer with everything!',
    'Half the day is gone and it\'s {progress}! Fresh arms hit the biggest numbers! Go!',
    '{progress}! Eat, breathe, then give me your best set of the week!'
  ],
  'guy.evening': [
    'Evening! {progress}! There is still time for a glorious all-out set!',
    '{progress} and the sun is setting! Finish the test with fire, {name}!',
    'It\'s {progress}! A missed test costs {stake}! I know you won\'t allow it!',
    '{progress}! Warm up for five minutes, then pour your whole heart into every set!',
    'The evening is here and it\'s {progress}! Records are waiting to be broken tonight!',
    '{progress}! Do the remaining sets now, while your spirit burns brightest!'
  ],
  'guy.lastcall': [
    'LAST CALL! {progress}! Finish before midnight or lose {stake}! You can do this!',
    '{progress} and midnight is charging at us! Charge back! {stake} is on the line!',
    'No giving up now, {name}! {progress}! A few all-out sets save {stake}!',
    'The final hour! {progress}! Get to the bar and fight for {stake}!',
    '{progress}! Finish by midnight and I\'ll run a hundred laps for you! {stake} at stake!',
    'It\'s now or never! {progress}! Protect {stake} with everything you have!'
  ],

  /* ---------- Jiraiya · rest days ---------- */
  'jiraiya.brief.rest': [
    'Rest day, kid. Orders from the great sage himself: eat, sleep, grow.',
    'No missions today. Even a legend like me takes days off. I call it research.',
    'Today you recover. Muscle is built on the couch after the bar. Trust the sage.',
    'Day off, {name}. Stretch a little, walk a little, and leave the bar alone.',
    'Rest day! I\'d train you myself, but my research won\'t write itself. Recover well.',
    'Nothing to lift today. A wise ninja guards recovery the way I guard my notebooks.',
    'The great sage declares a rest day. Your streak is safe; your only job is to recover.'
  ],
  'jiraiya.weigh': [
    'Step on the scale and log it, kid. Field research needs numbers: {have}/{goal} this week.',
    'A quiet rest day is perfect for a weigh-in. {have} of {goal} logged; my challenge pays +40 XP.',
    'The great sage requires data! Log your weight tonight. You\'re at {have}/{goal} this week.',
    'Rest day homework: one weigh-in. {have}/{goal} so far, +40 XP when my challenge is done.',
    'Even my finest research began with careful notes. Log your weight: {have}/{goal} this week.',
    'Scale, number, done. Ten seconds, {name}. You have {have} of {goal} weigh-ins this week.'
  ],

  /* ---------- Third Hokage · study ---------- */
  'hiruzen.study.target': [
    'Study target today: {min} at least, {full} to fill the scroll.',
    'For the books: {min} is today\'s minimum, and {full} fills the scroll.',
    'Give your studies {min} today, {name}; {full} if the day allows.',
    'The scroll asks {min} of study today. {full} would fill it completely.',
    'Knowledge grows hour by hour. Today: {min} minimum, {full} in full.',
    'Your books await: {min} keeps the study streak, {full} completes the day.'
  ],
  'hiruzen.study.midday': [
    'No study logged yet today. Begin the first hour now; {min} is the minimum.',
    'The books are still closed, {name}. {min} is needed today; the first page is the hardest.',
    'It is midday and the study scroll is empty. Start the timer; {min} is today\'s minimum.',
    'Not a minute of study yet. One honest hour now and the rest will follow. {min} today.',
    'Your studies have not begun today. {min} is the minimum; begin gently, but begin.',
    'An empty scroll at noon. There is still time for {min}, {name}, if you start now.'
  ],
  'hiruzen.study.evening': [
    'Study stands at {done}. {need} more reaches today\'s minimum.',
    '{done} studied so far, {name}. You still need {need} for the minimum.',
    'The scroll shows {done}. Another {need} tonight keeps your study streak.',
    '{need} of study remain before the minimum. You have done {done}; finish the work.',
    'You have given the books {done} today. {need} more and the day is secured.',
    'Evening study check: {done} done, {need} to go. One focused sitting will do it.'
  ],
  'hiruzen.study.evening0': [
    'No study logged today, and evening is here. {min} is still needed; begin now.',
    'The study scroll is still empty, {name}. {min} before midnight keeps the streak.',
    'Evening has come without a page read. Start the timer; today asks for {min}.',
    'Not a minute at the desk yet. {min} is a long way to go, so the best time to start is now.',
    'Your books have waited all day, {name}. Give them {min} tonight.',
    'An empty scroll at dusk. {min} is today\'s minimum; one hour first, then the next.'
  ],
  'hiruzen.study.lastcall': [
    'Study: exactly {need} still needed before midnight.',
    'The books need {need} more tonight, {name}, to keep the study streak.',
    '{need} of study stand between you and today\'s minimum. Midnight is near.',
    'You are {need} short of the study minimum. There is just time, if you begin now.',
    'For your studies: {need} still owed before midnight. Sit down now, {name}.',
    '{need} more at the desk and the study streak lives another day.'
  ],
  'hiruzen.study.shield': [
    'If today was truly hard, tap "Protect my streak" before midnight.',
    'Your weekly shield is unused: if today was truly hard, tap "Protect my streak" before midnight.',
    'Should today have been truly hard, you may tap "Protect my streak" before midnight.',
    'The shield is still yours this week. "Protect my streak" before midnight, only if today was truly hard.',
    'No shame in a truly hard day: "Protect my streak" is there until midnight, once a week.',
    'If the day was truly too much, tap "Protect my streak" before midnight. Be honest with yourself.'
  ],

  /* ---------- Third Hokage · exam week, promotion, weekly report ---------- */
  'hiruzen.exam': [
    'Day {day} of exam week, {name}. Your streaks are safe with me. Go calmly and do your best.',
    'Exam week, day {day}. Breathe, read each question twice, and trust your preparation. Good luck.',
    'This is day {day} of your exams. The village asks nothing else of you this week. Good luck, {name}.',
    'Day {day} of {days}. You have done the work; now let it show. I am guarding your streaks.',
    'Good luck on day {day} of exam week, {name}. A rested mind remembers more than a worried one.',
    'Exam week continues: day {day}. Eat well, sleep well, and walk in with a quiet heart.'
  ],
  'hiruzen.promo': [
    '{rank} is only {xp} XP away. One good day could carry you there.',
    'You stand {xp} XP from {rank}, {name}. Finish today well.',
    'Only {xp} XP remain before {rank}. The gate is in sight.',
    '{rank} is within reach: {xp} XP to go. Steady steps now.',
    'A promotion is near, {name}. {xp} XP separate you from {rank}.',
    'Just {xp} XP to {rank}. I have your new headband ready.'
  ],
  'hiruzen.weekly': [
    'Weekly report: {reps}. Missions {done} done, {missed} missed. Study {hours}. {xp} XP, {prs}.',
    'Last week: {reps}; {done} missions done, {missed} missed; {hours} of study; {xp} XP; {prs}.',
    'Your week, {name}: {reps}, missions {done} done and {missed} missed, {hours} studied, {xp} XP, {prs}.',
    'The week\'s ledger: {reps}. Missions: {done} done, {missed} missed. Books: {hours}. {xp} XP, {prs}.',
    'Report for last week: {done} missions done, {missed} missed, {reps}, {hours} of study, {xp} XP, {prs}.',
    'Looking back: {reps}; missions {done} done, {missed} missed; study {hours}; {xp} XP; {prs}.'
  ]
};

export function fill(t, v){ return t.replace(/\{(\w+)\}/g, (m, k) => v[k] != null ? String(v[k]) : m); }
