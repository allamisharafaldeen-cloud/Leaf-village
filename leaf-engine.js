/* The Leaf Village · the game engine.
   Everything the app shows (XP, ranks, streaks, study statuses, weekly challenges) is worked out here from
   the logs, as pure functions over a snapshot {settings, days, study, body, timer} and the current time.
   Nothing here touches the page or storage, so the same code runs in the app and in the tests (tests/unit).
   The sync Worker keeps its own copy of the core rules (worker/src/engine.js); tests/unit/engine.test.mjs
   checks the two agree day by day. Dates are 'YYYY-MM-DD' strings in the device's own time zone. */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.LeafEngine = factory();
})(typeof self !== 'undefined' ? self : this, function(){
'use strict';

/* ---------- rules ---------- */
const RANKS = [
  {id:'academy', name:'Academy Student', xp:0}, {id:'genin', name:'Genin', xp:1500}, {id:'chunin', name:'Chunin', xp:5000},
  {id:'special-jonin', name:'Special Jonin', xp:10000}, {id:'jonin', name:'Jonin', xp:16000}, {id:'anbu', name:'ANBU', xp:22500},
  {id:'akatsuki', name:'Akatsuki', xp:29500}, {id:'sannin', name:'Sannin', xp:37000}, {id:'sage', name:'Sage Mode', xp:45000},
  {id:'susanoo', name:'Susanoo', xp:53000}, {id:'tailed-beast', name:'Tailed Beast Mode', xp:61000},
  {id:'eight-gates', name:'Eight Gates', xp:68500}, {id:'kage', name:'Kage', xp:73500}, {id:'hokage', name:'Hokage', xp:77500}
];
const XP = { gtgSet:10, gtgComplete:50, gtgFull:20, testRep:2, testComplete:100, pr:75, rest:10, missGtg:100, missTest:150 };
const TIERS = [[0,1],[7,1.1],[14,1.2],[30,1.3],[60,1.5]];
const mult = st => { let m = 1; for(const [n, v] of TIERS) if(st >= n) m = v; return m; };
const nextTier = st => TIERS.find(([n]) => n > st) || null;
const DEFAULT_PLAN = [
  {type:'gtg',ex:'pullups'},{type:'gtg',ex:'dips'},{type:'gtg',ex:'pullups'},{type:'gtg',ex:'dips'},
  {type:'rest'},{type:'test'},{type:'rest'}
];
const DEFAULT_GTG = {sets:6, minSets:5, pct:50}, DEFAULT_TEST = {sets:2, ex:['pullups','dips']};
const CHALLENGES = {
  kakashi:{title:'Precision drill', desc:'Log 15 groove sets at target reps or more this week', goal:15, xp:60},
  guy:{title:'Burning youth', desc:'Beat one of your maxes on test day this week', goal:1, xp:100},
  jiraiya:{title:'Field research', desc:'Log your weight twice this week', goal:2, xp:40},
  hiruzen:{title:'Village duty', desc:'Finish a full Sunday-to-Saturday week with no missed mission', goal:7, xp:120}
};
const STUDY = {halfXp:20, minBonus:50, fullBonus:30, combo:10, comboWindow:60*60000, weekGoal:1800, weekXp:400, capMs:3*3600000, offFull:480};
const STUDY_DEFAULT = {week:{min:240, full:360}, end:{min:360, full:480}};
/* the shadow clone: each finished week races the same week four weeks earlier on XP, reps and study minutes.
   Winning two of the three earns a small bonus, credited to that Saturday once the week is over.
   Only weeks from the Sunday this rule arrived count, so no XP appears in the past. */
const RIVAL = {from:'2026-11-15', xp:50, back:28};
function raceResult(me, clone){
  if(!me || !clone || me.days !== 7 || clone.days !== 7 || me.ex || clone.ex || me.start < RIVAL.from) return null;
  let wins = 0, losses = 0;
  ['xp', 'repsAll', 'mins'].forEach(k => { const a = me[k] || 0, b = clone[k] || 0; if(a > b) wins++; else if(a < b) losses++; });
  return {win:wins >= 2, wins, losses};
}
/* only the first sets of a groove day count for XP, but never fewer than the plan asks for */
const SET_CAP = 10;

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m-1, d); };
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parse(s)) === s;
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate()+n); return ymd(d); };
const dowOf = s => parse(s).getDay();
const dnum = s => Math.round(parse(s).getTime()/86400000);
const daysBetween = (a, b) => dnum(b) - dnum(a);
const weekStart = s => addDays(s, -dowOf(s));
const dateAt = ms => ymd(new Date(ms));
const dayStartMs = d => parse(d).getTime();
const rankFor = xp => { let i = 0; RANKS.forEach((r, k) => { if(xp >= r.xp) i = k; }); return i; };
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const posNum = (v, def) => (typeof v === 'number' && isFinite(v) && v > 0) ? v : def;

/* ---------- schedule ---------- */
const HIST = new WeakMap(), NORM = new WeakMap();
function sortedHistory(s){
  const list = (s && Array.isArray(s.scheduleHistory)) ? s.scheduleHistory : null;
  if(!list) return [];
  let c = HIST.get(list);
  if(!c || c.n !== list.length){ c = {n:list.length, h:list.filter(isObj).sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0)}; HIST.set(list, c); }
  return c.h;
}
function entryFor(s, date){ const h = sortedHistory(s); let e = h[0]; for(const x of h){ if(x.from <= date) e = x; } return e; }
/* a schedule entry with every number filled in, so a half-written entry (a damaged backup) cannot break a day */
function normEntry(e){
  if(!e) return {plan:DEFAULT_PLAN, gtg:DEFAULT_GTG, test:DEFAULT_TEST, combo:{sets:3}};
  let n = NORM.get(e);
  if(!n){
    const g = isObj(e.gtg) ? e.gtg : {}, t = isObj(e.test) ? e.test : {}, c = isObj(e.combo) ? e.combo : {};
    const sets = posNum(g.sets, DEFAULT_GTG.sets);
    n = { plan:Array.isArray(e.plan) ? e.plan : DEFAULT_PLAN,
      gtg:{sets, minSets:Math.min(posNum(g.minSets, Math.min(DEFAULT_GTG.minSets, sets)), sets), pct:posNum(g.pct, DEFAULT_GTG.pct)},
      test:{sets:posNum(t.sets, DEFAULT_TEST.sets), ex:Array.isArray(t.ex) ? t.ex.filter(x => typeof x === 'string') : DEFAULT_TEST.ex},
      combo:{sets:posNum(c.sets, 3)} };
    NORM.set(e, n);
  }
  return n;
}
/* a one-time swap: two days trade their workout missions for that week only (the weekly plan stays as it is) */
const swapList = s => (s && Array.isArray(s.swaps)) ? s.swaps.filter(x => isObj(x) && isDate(x.a) && isDate(x.b) && x.a !== x.b) : [];
const swapOf = (s, d) => { for(const x of swapList(s)){ if(x.a === d) return x.b; if(x.b === d) return x.a; } return null; };
function planFor(s, date){
  const e = normEntry(entryFor(s, date)), ex = (s && s.exercises) || {}, src = swapOf(s, date) || date;
  const p = e.plan[dowOf(src)], rest = () => ({type:'rest', gtg:e.gtg, test:e.test, combo:e.combo});
  if(!isObj(p)) return rest();
  const plan = Object.assign({}, p, {gtg:e.gtg, test:e.test, combo:e.combo});
  if(plan.type === 'gtg') return ex[plan.ex] ? plan : rest();
  if(plan.type === 'combo'){ const exs = (Array.isArray(plan.exs) ? plan.exs : []).filter(id => ex[id]); if(!exs.length) return rest(); plan.exs = exs; return plan; }
  /* a test day with nothing to test could never be completed: it is a rest day */
  if(plan.type === 'test') return e.test.ex.some(id => ex[id]) ? plan : rest();
  return rest();
}
const gtgTarget = (max, pct) => Math.max(1, Math.round((max || 1) * pct / 100));

/* ---------- study ---------- */
const studyPlanOf = e => { const st = (e && isObj(e.study)) ? e.study : {}; return {week:Object.assign({}, STUDY_DEFAULT.week, st.week), end:Object.assign({}, STUDY_DEFAULT.end, st.end)}; };
const studyTarget = (s, d) => { const w = dowOf(d); if(w === 4) return null; const sp = studyPlanOf(entryFor(s || {}, d)); const t = (w === 5 || w === 6) ? sp.end : sp.week; return {min:t.min, full:t.full}; };
const examList = s => (s && Array.isArray(s.examWeeks)) ? s.examWeeks : [];
const examFor = (s, d) => examList(s).find(e => e && e.start <= d && d <= e.end) || null;
/* an on-call day (marked on the day itself, at most 2 a week) counts like an exam day: what you manage still earns,
   nothing missed costs XP or breaks a streak */
const onCallDay = (s, d) => !!(s && Array.isArray(s.oncall) && s.oncall.includes(d));
const isExam = (s, d) => !!examFor(s, d) || onCallDay(s, d);

/* split a time span into per-day pieces (local midnight boundaries) */
function splitByDay(a, b){
  const out = []; let st = a;
  while(st < b && out.length < 400){ const d = dateAt(st); const e = Math.min(b, dayStartMs(addDays(d, 1))); out.push({date:d, start:st, end:e}); st = e; }
  return out;
}
/* focus cycles: 50 minutes of work, then a 10-minute break, repeating from the moment the timer started.
   Only the work stretches count as study. */
const FOCUS = {work:50*60000, rest:10*60000};
function focusSpans(a, b){
  const out = [], cycle = FOCUS.work + FOCUS.rest;
  for(let st = a, n = 0; st < b && n < 300; st += cycle, n++) out.push([st, Math.min(b, st + FOCUS.work)]);
  return out;
}
/* the stretches of a running timer that count as study, up to `end` */
const timerSpans = (T, end) => !(end > T.segStart) ? [] : T.focus ? focusSpans(T.segStart, end) : [[T.segStart, end]];
/* a running study timer counts up to now, or up to its "still studying?" check if that came first */
function provisionalPieces(timer, now){
  const T = timer || {state:'idle'};
  if(T.state !== 'running' || !(typeof T.segStart === 'number' && T.segStart > 0)) return [];
  const end = Math.min(now, T.checkAt || Infinity), out = [];
  timerSpans(T, end).forEach(([a, b]) => splitByDay(a, b).forEach(p => out.push({date:p.date, start:p.start, end:p.end, min:(p.end - p.start)/60000, src:'live'})));
  return out;
}
/* times at which each full study hour of the day was completed */
function hourTimes(segs){
  const out = []; let cum = 0, next = 1;
  segs.slice().sort((a, b) => a.end - b.end).forEach(g => {
    if(g.src === 'manual'){ cum += g.min; while(cum >= next*60 - 1e-9){ out.push(g.end); next++; } return; }
    while(cum + g.min >= next*60 - 1e-9){ out.push(g.start + (next*60 - cum)*60000); next++; }
    cum += g.min;
  });
  return out;
}
function computeStudy(data, today, now){
  const s = data.settings || {}, docs = data.study || {};
  const res = {days:{}, list:[], streak:0, best:0, weeks:{}, awards:[], start:isDate(s.studyStart) ? s.studyStart : null};
  if(!res.start || res.start > today) return res;
  const live = {}; provisionalPieces(data.timer, now).forEach(p => { (live[p.date] = live[p.date] || []).push(p); });
  for(let d = res.start, g = 0; d <= today && g < 4000; d = addDays(d, 1), g++){
    const doc = isObj(docs[d]) ? docs[d] : {}, raw = Array.isArray(doc.entries) ? doc.entries.filter(isObj) : [];
    const entries = raw.map(e => ({start:+new Date(e.start || e.end), end:+new Date(e.end), min:Math.max(0, +e.min || 0), src:e.src || 'manual'}));
    const segs = entries.concat(live[d] || []);
    const mins = segs.reduce((m, x) => m + x.min, 0), committed = entries.reduce((m, x) => m + x.min, 0);
    const base = studyTarget(s, d), off = !base && dowOf(d) === 4 && (doc.offday || mins > 0);
    const tgt = off ? {min:0, full:STUDY.offFull, off:true} : base, exam = isExam(s, d), wk = weekStart(d);
    const W = res.weeks[wk] || (res.weeks[wk] = {start:wk, mins:0, shields:0, won:false});
    let xp = Math.floor(mins/30)*STUDY.halfXp, status;
    if(tgt){ if(mins >= tgt.min && !tgt.off) xp += STUDY.minBonus; if(mins >= tgt.full) xp += STUDY.fullBonus; }
    if(!tgt) status = 'rest';
    else if(tgt.off) status = mins > 0 ? 'done' : 'rest';
    else if(mins >= tgt.min) status = 'done';
    else if(exam) status = 'exam';
    else if(d < SCROLL_FROM && doc.shield && W.shields < 1){ status = 'shield'; W.shields++; }
    else if(d < today && scrollUsed(s, 'study', d)) status = 'scroll';
    else status = d < today ? 'missed' : 'open';
    const before = res.streak;
    if(status === 'done'){ res.streak++; res.best = Math.max(res.best, res.streak); }
    else if(status === 'missed') res.streak = 0;
    const prevWk = W.mins; W.mins += mins;
    let award = 0;
    if(!W.won && prevWk < STUDY.weekGoal && W.mins >= STUDY.weekGoal){ W.won = true; award = STUDY.weekXp; res.awards.push({key:'study', sensei:'hiruzen', date:d, week:wk, xp:STUDY.weekXp, title:'Scholar\'s week'}); }
    const rec = {date:d, mins, committed, tgt, exam, status, xp:xp + award, award, hours:hourTimes(segs), shield:!!doc.shield, broke:status === 'missed' && before > 0, streak:res.streak, entries:raw};
    res.days[d] = rec; res.list.push(rec);
  }
  return res;
}
/* ---------- sleep ----------
   Each night is logged on the morning you wake up: minutes slept and a 0-100 score (both copied from a sleep app),
   plus the times you fell asleep and woke up. A good night meets all three goals: long enough, asleep by the
   bedtime, up by the wake time (earlier is always fine). Goals live in the schedule entry, so a change starts
   tomorrow like every other plan change. Missing a night never costs XP; it only resets the sleep streak.
   An on-call night (hospital shift) is neutral: no XP, and the streak is kept. */
const SLEEP = {goodXp:20, scoreXp:10, scoreMin:80, aura:.1};
const SLEEP_DEFAULT = {mins:450, bedBy:1200, wakeBy:240};
const clockMin = v => { const m = typeof v === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(v) : null; if(!m) return null; const h = +m[1], mi = +m[2]; return (h < 24 && mi < 60) ? h*60 + mi : null; };
const inRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const sleepPlanOf = e => { const p = (e && isObj(e.sleep)) ? e.sleep : {};
  return {mins:inRange(p.mins, 240, 720) ? p.mins : SLEEP_DEFAULT.mins, bedBy:inRange(p.bedBy, 0, 1439) ? p.bedBy : SLEEP_DEFAULT.bedBy, wakeBy:inRange(p.wakeBy, 0, 1439) ? p.wakeBy : SLEEP_DEFAULT.wakeBy}; };
const sleepGoal = (s, d) => sleepPlanOf(entryFor(s || {}, d));
/* ---------- protection scrolls ----------
   From SCROLL_FROM on, a missed day in an area (workout, study, sleep) can be covered by a scroll. The app decides
   which days are covered (it keeps the scroll inventory) and writes the decision into settings.scrolls.used as
   'area|date' -> 'common' | 'rare' | 'forbidden'. A covered day keeps the streak, costs no XP and earns no bonus. */
const SCROLL_FROM = '2026-11-24';
const scrollUsed = (s, area, d) => !!(d >= SCROLL_FROM && s && s.scrolls && typeof s.scrolls === 'object' && s.scrolls.used && typeof s.scrolls.used === 'object' && s.scrolls.used[area + '|' + d]);

/* bedtimes compare on a noon-to-noon clock (so 00:30 is later than 20:00), wake times on a 6 pm-to-6 pm clock */
const eveClock = m => m < 720 ? m + 1440 : m, mornClock = m => m >= 1080 ? m - 1440 : m;
const bedOk = (bed, by) => bed != null && eveClock(bed) <= eveClock(by);
const wakeOk = (w, by) => w != null && mornClock(w) <= mornClock(by);
function sleepNight(doc){
  if(!isObj(doc)) return null;
  const oncall = !!doc.oncall, mins = (typeof doc.mins === 'number' && isFinite(doc.mins) && doc.mins > 0) ? Math.min(Math.round(doc.mins), 1440) : 0;
  const score = (typeof doc.score === 'number' && isFinite(doc.score)) ? Math.max(0, Math.min(100, Math.round(doc.score))) : null;
  return {oncall, mins, score, bed:clockMin(doc.bed), wake:clockMin(doc.wake), logged:!oncall && mins > 0};
}
function computeSleep(data, today){
  const s = data.settings || {}, docs = isObj(data.sleep) ? data.sleep : {};
  const res = {days:{}, list:[], streak:0, best:0, start:null};
  const dates = Object.keys(docs).filter(k => isDate(k) && k <= today && sleepNight(docs[k])).sort();
  if(!dates.length) return res;
  res.start = dates[0];
  for(let d = res.start, g = 0; d <= today && g < 4000; d = addDays(d, 1), g++){
    const n = sleepNight(docs[d]), goal = sleepGoal(s, d), exam = isExam(s, d);
    const checks = n && n.logged ? {hours:n.mins >= goal.mins, bed:bedOk(n.bed, goal.bedBy), wake:wakeOk(n.wake, goal.wakeBy)} : null;
    let status;
    if(n && n.oncall) status = 'oncall';
    else if(checks && checks.hours && checks.bed && checks.wake) status = 'good';
    else if(exam) status = 'exam';
    else if(checks) status = 'short';
    else status = d < today ? 'missed' : 'open';
    if((status === 'short' || status === 'missed') && d < today && scrollUsed(s, 'sleep', d)) status = 'scroll';
    let xp = status === 'good' ? SLEEP.goodXp : 0;
    if(checks && n.score != null && n.score >= SLEEP.scoreMin) xp += SLEEP.scoreXp;
    const before = res.streak;
    if(status === 'good'){ res.streak++; res.best = Math.max(res.best, res.streak); }
    else if(status === 'short' || status === 'missed') res.streak = 0;
    const rec = {date:d, mins:n ? n.mins : 0, score:n ? n.score : null, bed:n ? n.bed : null, wake:n ? n.wake : null, oncall:!!(n && n.oncall), logged:!!(n && n.logged), goal, checks, exam, status, xp, streak:res.streak, broke:(status === 'short' || status === 'missed') && before > 0};
    res.days[d] = rec; res.list.push(rec);
  }
  return res;
}

/* match each completed study hour to one workout set logged within the next 60 minutes */
function comboMatches(hours, sets){
  const ts = sets.map(x => +new Date(x.t)).filter(n => !isNaN(n)).sort((a, b) => a - b), used = new Set(); let n = 0; const free = [];
  hours.forEach(h => { const i = ts.findIndex((t, k) => !used.has(k) && t >= h && t <= h + STUDY.comboWindow); if(i >= 0){ used.add(i); n++; } else free.push(h); });
  return {n, free};
}

/* ---------- the engine: everything is derived from the logs ---------- */
const okSet = x => isObj(x) && typeof x.ex === 'string' && typeof x.reps === 'number' && isFinite(x.reps);
function setsOf(doc){
  const list = (isObj(doc) && Array.isArray(doc.sets)) ? doc.sets : null;
  if(!list) return [];
  if(list.every(okSet)) return list;
  return list.filter(x => isObj(x) && typeof x.ex === 'string' && isFinite(+x.reps)).map(x => Object.assign({}, x, {reps:+x.reps}));
}
const bodyList = data => Object.values(data.body || {}).filter(b => b && typeof b.weight === 'number' && isDate(b.date)).sort((a, b) => a.date < b.date ? -1 : 1);


/* ---------- weighted sets ----------
   A set can carry added weight (x.kg, a belt or a backpack). Old sets have none and count as bodyweight.
   Maxes are kept per weight, so a weighted set is never compared with a bodyweight one. The weight you train
   with (the "working weight") is the weight of your latest test; the bodyweight test on the first Friday of a
   month does not change it. Weighted reps earn XP in proportion to the total load: reps x (body + added) / body. */
const LOAD = {bw:69, cap:200, step:2.5, upAt:12, e1Reps:12};
const kgOf = x => (x && Number.isFinite(+x.kg) && +x.kg > 0) ? Math.min(LOAD.cap, Math.round(+x.kg * 4) / 4) : 0;
const bwAt = (list, d) => { let w = null; for(const b of list){ if(b.date <= d) w = b.weight; else break; } return w || (list[0] && list[0].weight) || LOAD.bw; };
const e1rm = (bw, kg, reps) => (bw + kg) * (1 + reps / 30);
const loadXp = (bw, kg, reps) => kg > 0 ? Math.round(reps * (bw + kg) / bw) : reps;
const monthBwTest = d => +d.slice(8, 10) <= 7;
/* does a set at weight kg count as a groove set when the target is `target` reps at the working weight? */
const meets = (bw, x, load, target) => { const kg = kgOf(x); return kg === load ? x.reps >= target : e1rm(bw, kg, x.reps) >= e1rm(bw, load, target) - 1e-9; };
function compute(data, nowMs){
  const now = nowMs == null ? Date.now() : nowMs, today = dateAt(now);
  const s = data.settings || {}, dayDocs = data.days || {}, exs = isObj(s.exercises) ? s.exercises : {};
  const exIds = Object.keys(exs);
  const maxes = {}, best = {}, maxHist = {}, totalReps = {};
  exIds.forEach(id => { const b0 = (s.baseline || {})[id], b = {max:posNum(b0 && b0.max, 0), date:(b0 && isDate(b0.date)) ? b0.date : s.startDate}; maxes[id] = b.max; best[id] = b.max; maxHist[id] = [{date:b.date, v:b.max, start:true}]; totalReps[id] = 0; });
  const load = {}, wmax = {}, wbest = {}, strength = {};
  exIds.forEach(id => { load[id] = 0; wmax[id] = {}; wbest[id] = {}; strength[id] = []; });
  const days = [], prs = [], weeks = {}, awards = [];
  const body = bodyList(data), bodyDates = new Set(body.map(b => b.date));
  let total = 0, peak = 0, streak = 0, bestStreak = 0, doneCount = 0, missedCount = 0;
  const study = computeStudy(data, today, now), sleep = computeSleep(data, today); let readyUntil = 0;
  if(isDate(s.startDate) && s.startDate <= today){
    let guard = 0;
    for(let d = s.startDate; d <= today && guard < 4000; d = addDays(d, 1), guard++){
      const plan = planFor(s, d);
      const sets = setsOf(dayDocs[d]);
      const bw = bwAt(body, d), lx = x => loadXp(bw, kgOf(x), x.reps);
      const wk = weekStart(d);
      const W = weeks[wk] || (weeks[wk] = {start:wk, reps:{}, missed:0, days:0, done:0, qual:0, weigh:0, prDone:false, open:false, xp:0, repsAll:0, mins:0});
      sets.forEach(x => { totalReps[x.ex] = (totalReps[x.ex] || 0) + x.reps; W.reps[x.ex] = (W.reps[x.ex] || 0) + lx(x); W.repsAll += lx(x); });
      let base = 0, complete = false, info = {};
      if(plan.type === 'gtg'){
        const ex = plan.ex, g = plan.gtg, kg = load[ex] || 0, target = gtgTarget(kg ? wmax[ex][kg] : maxes[ex], g.pct);
        const exSets = sets.filter(x => x.ex === ex).slice(0, Math.max(SET_CAP, g.sets));
        let q = 0;
        exSets.forEach(x => { if(meets(bw, x, kg, target)){ q++; base += XP.gtgSet + lx(x); } else base += lx(x); });
        complete = q >= g.minSets;
        if(complete) base += XP.gtgComplete;
        if(q >= g.sets) base += XP.gtgFull;
        info = {ex, target, kg, q, need:g.minSets, goal:g.sets, logged:exSets.length, exSets};
      } else if(plan.type === 'combo'){
        const g = plan.gtg, per = plan.combo.sets;
        const parts = plan.exs.map(ex => {
          const kg = load[ex] || 0, target = gtgTarget(kg ? wmax[ex][kg] : maxes[ex], g.pct), exSets = sets.filter(x => x.ex === ex).slice(0, Math.max(SET_CAP, per));
          let q = 0;
          exSets.forEach(x => { if(meets(bw, x, kg, target)){ q++; base += XP.gtgSet + lx(x); } else base += lx(x); });
          return {ex, target, kg, q, need:per, logged:exSets.length, exSets};
        });
        complete = parts.every(pt => pt.q >= per);
        if(complete) base += XP.gtgComplete + XP.gtgFull;
        info = {parts, q:parts.reduce((m, pt) => m + Math.min(pt.q, per), 0), qAll:parts.reduce((m, pt) => m + pt.q, 0), need:per*parts.length, goal:per*parts.length};
      } else if(plan.type === 'test'){
        const t = plan.test;
        const tex = t.ex.filter(id => exs[id]);
        const per = tex.map(id => { const xs = sets.filter(x => x.ex === id).slice(0, t.sets), kg = xs.reduce((m, x) => Math.max(m, kgOf(x)), 0), at = xs.filter(x => kgOf(x) === kg), top = at.reduce((m, x) => Math.max(m, x.reps), 0);
          /* the other weights tried that day (a bodyweight check next to a weighted set) keep their own records */
          const others = {}; xs.forEach(x => { const k = kgOf(x); if(k !== kg) others[k] = Math.max(others[k] || 0, x.reps); });
          return {ex:id, sets:xs, kg, top, others, prev:kg ? (wmax[id][kg] != null ? wmax[id][kg] : null) : maxes[id], prBefore:kg ? (wbest[id][kg] || 0) : best[id], pr:false, load:load[id] || 0}; });
        per.forEach(p => p.sets.forEach(x => { base += XP.testRep * lx(x); }));
        complete = per.length > 0 && per.every(p => p.sets.length >= t.sets);
        if(complete) base += XP.testComplete;
        per.forEach(p => {
          if(!p.sets.length) return;
          const mark = (kg, v) => { const b = kg ? (wbest[p.ex][kg] || 0) : best[p.ex]; if(v > b){ prs.push(kg ? {date:d, ex:p.ex, v, kg, from:b} : {date:d, ex:p.ex, v, from:b}); if(kg) wbest[p.ex][kg] = v; else best[p.ex] = v; return true; } return false; };
          if(mark(p.kg, p.top)){ p.pr = true; base += XP.pr; }
          Object.keys(p.others).forEach(k => mark(+k, p.others[k]));
        });
        info = {per, sets:t.sets};
      }
      let status;
      if(plan.type === 'rest'){ status = 'rest'; base = XP.rest; }
      else if(complete) status = 'done';
      else status = d < today ? 'missed' : 'open';
      if(isExam(s, d) && status !== 'done'){ status = 'exam'; if(plan.type === 'rest') base = 0; }
      if(status === 'missed' && scrollUsed(s, 'workout', d)) status = 'scroll';
      let xp;
      if(status === 'done' || status === 'rest'){ streak++; bestStreak = Math.max(bestStreak, streak); xp = Math.round(base*mult(streak)); if(status === 'done'){ doneCount++; W.done++; } }
      else if(status === 'scroll') xp = 0;
      else if(status === 'missed'){ streak = 0; xp = base - (plan.type === 'test' ? XP.missTest : XP.missGtg); missedCount++; W.missed++; }
      else xp = base;
      W.days++;
      if(plan.type === 'test' && (status === 'done' || status === 'missed')){
        info.per.forEach(p => { if(!p.sets.length) return;
          const put = (kg, v) => { if(kg) wmax[p.ex][kg] = v; else { maxes[p.ex] = v; maxHist[p.ex].push({date:d, v}); } };
          put(p.kg, p.top); Object.keys(p.others).forEach(k => put(+k, p.others[k]));
          if(p.kg > 0) load[p.ex] = p.kg; else if(!(load[p.ex] > 0 && monthBwTest(d))) load[p.ex] = 0;
          /* strength score: the estimated one-rep max of the day's best set of 12 reps or fewer */
          const e = p.sets.filter(x => x.reps > 0 && x.reps <= LOAD.e1Reps).reduce((m, x) => Math.max(m, e1rm(bw, kgOf(x), x.reps)), 0);
          if(e) strength[p.ex].push({date:d, v:Math.round(e * 10) / 10, kg:p.kg, reps:p.top}); });
      }
      const bonus = [];
      if(plan.type === 'gtg' || plan.type === 'combo'){ const before = W.qual; W.qual += (plan.type === 'combo' ? info.qAll : info.q) || 0; if(before < CHALLENGES.kakashi.goal && W.qual >= CHALLENGES.kakashi.goal) bonus.push('kakashi'); }
      if(plan.type === 'test' && !W.prDone && info.per && info.per.some(p => p.pr)){ W.prDone = true; bonus.push('guy'); }
      if(bodyDates.has(d)){ W.weigh++; if(W.weigh === CHALLENGES.jiraiya.goal) bonus.push('jiraiya'); }
      W.open = status === 'open';
      if(status === 'exam') W.exam = (W.exam || 0) + 1;
      if(isExam(s, d)) W.ex = (W.ex || 0) + 1;                     // any day of an exam-week pass: that week does not race
      if(dowOf(d) === 6 && W.days === 7 && W.missed === 0 && status !== 'open') bonus.push('hiruzen');
      bonus.forEach(id => { xp += CHALLENGES[id].xp; awards.push({key:id, sensei:id, date:d, week:wk, xp:CHALLENGES[id].xp, title:CHALLENGES[id].title}); });
      const srec = study.days[d];
      const cm = comboMatches(srec ? srec.hours : [], sets); info.combo = cm.n; xp += cm.n*STUDY.combo;
      if(d === today && plan.type !== 'rest'){ cm.free.forEach(h => { if(now >= h && now <= h + STUDY.comboWindow) readyUntil = Math.max(readyUntil, h + STUDY.comboWindow); }); }
      const beforeTotal = total;
      if(srec){ total = Math.max(0, total + srec.xp); if(srec.award) awards.push(study.awards.find(a => a.date === d)); }
      total = Math.max(0, total + xp);
      /* sleep XP is added after, and kept out of the week's race total (the shadow clone's older weeks had none) */
      const slr = sleep.days[d], slxp = slr ? slr.xp : 0;
      W.xp += total - beforeTotal; if(srec) W.mins += srec.mins;
      total += slxp;
      let rival = 0;
      if(dowOf(d) === 6 && d < today){ W.rival = raceResult(W, weeks[addDays(wk, -RIVAL.back)]); if(W.rival && W.rival.win){ rival = RIVAL.xp; xp += rival; total += rival; } }
      peak = Math.max(peak, rankFor(total));
      days.push({date:d, plan, sets, status, xp, base, info, streak, bonus, rival, sxp:srec ? srec.xp : 0, slxp, gain:total - beforeTotal, total, peak, maxes:plan.type === 'test' ? Object.assign({}, maxes) : null});
    }
  }
  const todayRec = days.length && days[days.length-1].date === today ? days[days.length-1] : null;
  const weekList = Object.values(weeks).sort((a, b) => a.start < b.start ? -1 : 1);
  const cleanWeeks = weekList.filter(w => w.days === 7 && w.missed === 0 && w.done > 0 && addDays(w.start, 6) < today).length;
  const weight = body.length ? body[body.length-1].weight : null;
  const power = weight ? Math.round(((maxes.pullups || 0)*3 + (maxes.dips || 0))*weight/10) : null;
  const weekNow = weeks[weekStart(today)] || {qual:0, weigh:0, prDone:false, days:0, missed:0};
  const startedMidWeek = weekStart(s.startDate || today) === weekStart(today) && dowOf(s.startDate || today) !== 0;
  return { settings:s, now, study, sleep, readyUntil, awards, weekNow, weeks, startedMidWeek, today, todayRec, days, total, peak, rankNow:rankFor(total), streak, bestStreak, doneCount, missedCount, maxes, best, maxHist, prs, totalReps, weekList, cleanWeeks, body, weight, power, exIds, load, wmax, wbest, strength };
}

/* the weight the app puts on the next set: the working weight on groove days; on a test day the working weight,
   2.5 kg more once its max reached 12, bodyweight on the first test of a month, and a first weight for an
   exercise whose bodyweight max has outgrown it */
const LOAD_START = {dips:{at:25, kg:10}, pullups:{at:14, kg:5}};
function suggestKg(C, ex){
  const t = C.todayRec, load = (C.load && C.load[ex]) || 0;
  if(!t || t.plan.type !== 'test') return load;
  const p = (t.info.per || []).find(x => x.ex === ex);
  if(p && p.sets.length) return p.kg;
  if(load > 0){
    const bwThisMonth = C.days.some(d => d.date < C.today && d.date.slice(0, 7) === C.today.slice(0, 7) && d.plan.type === 'test' && d.info.per && d.info.per.some(q => q.ex === ex && q.sets.length && q.kg === 0));
    if(monthBwTest(C.today) && !bwThisMonth) return 0;
    const m = C.wmax[ex][load];
    return m != null && m >= LOAD.upAt ? load + LOAD.step : load;
  }
  const st = LOAD_START[ex];
  return st && (C.maxes[ex] || 0) >= st.at ? st.kg : 0;
}
/* ---------- side quests: three small optional challenges a week, paid in Ryō ---------- */
const QUESTS = [
  {id:'morning', name:'Morning ninja', text:'Log 3 sets before noon on 2 days', goal:2, ryo:100},
  {id:'bed', name:'Early to bed', text:'4 good nights', goal:4, ryo:120},
  {id:'weekend', name:'Weekend scholar', text:'Study 2 hours on a Friday or Saturday', goal:120, ryo:120},
  {id:'row', name:'Three in a row', text:'Complete 3 workout days in a row', goal:3, ryo:100},
  {id:'books', name:'Five days of books', text:'Meet your study target on 5 days', goal:5, ryo:150},
  {id:'extra', name:'The extra mile', text:'Log every planned groove set (not just the minimum) on 2 days', goal:2, ryo:100},
  {id:'scale', name:'Check the scale', text:'Log a weigh-in', goal:1, ryo:60},
  {id:'record', name:'Break a record', text:'Set a new max, at any weight', goal:1, ryo:150}
];
const QUEST_FROM = '2026-11-22';
function questWeek(C, start){
  let h = 0; for(const ch of start) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pool = QUESTS.slice(), pick = [];
  while(pick.length < 3){ h = (h * 1103515245 + 12345) >>> 0; pick.push(pool.splice(h % pool.length, 1)[0]); }
  const dates = []; for(let i = 0; i < 7; i++){ const d = addDays(start, i); if(d <= C.today) dates.push(d); }
  const wd = {}; C.days.forEach(d => { wd[d.date] = d; });
  const prog = q => {
    if(q.id === 'morning') return dates.filter(d => wd[d] && (wd[d].sets || []).filter(x => new Date(x.t).getHours() < 12).length >= 3).length;
    if(q.id === 'bed') return dates.filter(d => C.sleep && C.sleep.days[d] && C.sleep.days[d].status === 'good').length;
    if(q.id === 'weekend') return dates.filter(d => dowOf(d) === 5 || dowOf(d) === 6).reduce((m, d) => Math.max(m, (C.study.days[d] || {}).mins || 0), 0);
    if(q.id === 'row'){ let run = 0, best = 0; dates.forEach(d => { const r = wd[d]; if(r && r.status === 'done' && r.plan.type !== 'rest'){ run++; best = Math.max(best, run); } else if(!(r && (r.status === 'rest' || r.status === 'open'))) run = 0; }); return best; }
    if(q.id === 'books') return dates.filter(d => C.study.days[d] && C.study.days[d].status === 'done').length;
    if(q.id === 'extra') return dates.filter(d => { const r = wd[d]; return r && r.info && r.plan.type === 'gtg' && r.info.goal && r.info.logged >= r.info.goal; }).length;
    if(q.id === 'scale') return dates.filter(d => (C.body || []).some(b => b.date === d)).length;
    if(q.id === 'record') return C.prs.filter(p => dates.includes(p.date)).length;
    return 0;
  };
  return {start, quests:pick.map(q => { const n = prog(q); return Object.assign({}, q, {n:Math.min(n, q.goal), done:n >= q.goal}); })};
}
function sideQuests(C){
  if(C._quests) return C._quests;
  const weeks = []; let ryo = 0;
  for(let w = weekStart(QUEST_FROM), g = 0; w <= C.today && g < 600; w = addDays(w, 7), g++){ const q = questWeek(C, w); weeks.push(q); q.quests.forEach(x => { if(x.done) ryo += x.ryo; }); }
  const out = {weeks, ryo, now:weeks[weeks.length - 1] || null};
  Object.defineProperty(C, '_quests', {value:out, enumerable:false});
  return out;
}

/* the latest strength score of each exercise and its history */
const strengthNow = (C, ex) => { const h = (C.strength || {})[ex] || []; return h.length ? h[h.length - 1] : null; };

/* when a streak broke, and when a broken streak was rebuilt to 7 */
function streakStory(C){
  const out = {broke:null, comeback:null, ever:false, first:null};
  const scan = (list, kind, isBreak) => {
    let pending = null;
    list.forEach((rec, i) => {
      if(isBreak(rec, i)){ pending = rec.date; if(!out.broke || rec.date >= out.broke.date) out.broke = {date:rec.date, kind}; }
      if(pending && rec.streak >= 7){ out.ever = true; if(!out.first || rec.date < out.first) out.first = rec.date; if(!out.comeback || rec.date >= out.comeback.date) out.comeback = {date:rec.date, kind, since:pending}; pending = null; }
    });
  };
  scan(C.days, 'workout', (rec, i) => rec.status === 'missed' && i > 0 && (C.days[i-1].streak || 0) > 0);
  scan(C.study.list, 'study', rec => rec.broke);
  return out;
}

/* ---------- checking a backup file before it replaces anything ----------
   A good backup comes through exactly as it is. A damaged one is either refused (nothing sensible to open) or
   repaired by leaving out the entries that cannot be read; `fixed` counts what was left out or reset. */
function cleanBackup(d, nowMs){
  if(!isObj(d) || d.app !== 'The Leaf Village' || !isObj(d.settings)) return {ok:false, why:'not'};
  let s; try{ s = JSON.parse(JSON.stringify(d.settings)); }catch(e){ return {ok:false, why:'not'}; }
  let fixed = 0;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const okTime = v => typeof v === 'string' && !isNaN(Date.parse(v));
  if(!isDate(s.startDate)) return {ok:false, why:'start'};
  if(!isObj(s.exercises)){ s.exercises = {}; fixed++; }
  Object.keys(s.exercises).forEach(id => { const e = s.exercises[id]; if(!isObj(e)){ delete s.exercises[id]; fixed++; } else if(typeof e.name !== 'string' || !e.name){ e.name = id; fixed++; } });
  if(!Object.keys(s.exercises).length) return {ok:false, why:'exercises'};
  if(!isObj(s.baseline)){ s.baseline = {}; fixed++; }
  Object.keys(s.exercises).forEach(id => {
    const b = s.baseline[id];
    if(!isObj(b) || !(typeof b.max === 'number' && isFinite(b.max) && b.max >= 0)){ s.baseline[id] = {max:posNum(b && +b.max, 1), date:(b && isDate(b.date)) ? b.date : s.startDate}; fixed++; }
    else if(!isDate(b.date)){ b.date = s.startDate; fixed++; }
  });
  const rawHist = Array.isArray(s.scheduleHistory) ? s.scheduleHistory : [];
  const planDay = p => {
    if(isObj(p)){
      if(p.type === 'rest' || p.type === 'test') return p;
      if(p.type === 'gtg' && typeof p.ex === 'string') return p;
      if(p.type === 'combo' && Array.isArray(p.exs) && p.exs.length && p.exs.every(x => typeof x === 'string')) return p;
    }
    return {type:'rest'};
  };
  const hist = [];
  rawHist.forEach(e => {
    if(!isObj(e) || !isDate(e.from)){ fixed++; return; }
    const n = normEntry(e), out = Object.assign({}, e);
    const plan = Array.from({length:7}, (_, k) => planDay(Array.isArray(e.plan) ? e.plan[k] : DEFAULT_PLAN[k]));
    if(!same(plan, e.plan)){ out.plan = plan; fixed++; }
    if(!same(n.gtg, e.gtg)){ out.gtg = n.gtg; fixed++; }
    if(!same(n.test, e.test)){ out.test = n.test; fixed++; }
    if(e.combo !== undefined && !same(n.combo, e.combo)){ out.combo = n.combo; fixed++; }
    if(e.study !== undefined){
      const sp = studyPlanOf(e), okT = t => posNum(t.min, 0) && posNum(t.full, 0) && t.min <= t.full;
      const st = {week:okT(sp.week) ? sp.week : STUDY_DEFAULT.week, end:okT(sp.end) ? sp.end : STUDY_DEFAULT.end};
      if(!same(st, e.study)){ out.study = st; fixed++; }
    }
    if(e.sleep !== undefined){ const sl = sleepPlanOf(e); if(!same(sl, e.sleep)){ out.sleep = sl; fixed++; } }
    hist.push(out);
  });
  if(!hist.length){ hist.push({from:s.startDate, plan:JSON.parse(JSON.stringify(DEFAULT_PLAN)), gtg:Object.assign({}, DEFAULT_GTG), test:{sets:2, ex:Object.keys(s.exercises).slice(0, 2)}}); fixed++; }
  if(!same(hist, s.scheduleHistory)) s.scheduleHistory = hist;
  if(s.studyStart !== undefined && s.studyStart !== null && !isDate(s.studyStart)){ delete s.studyStart; fixed++; }
  const studyStart = d.studyStart;
  if(s.examWeeks !== undefined){
    const ex = (Array.isArray(s.examWeeks) ? s.examWeeks : []).filter(e => isObj(e) && isDate(e.start) && isDate(e.end) && e.start <= e.end);
    if(!Array.isArray(s.examWeeks) || ex.length !== s.examWeeks.length){ s.examWeeks = ex; fixed++; }
  }
  if(s.shop !== undefined){
    const ok = isObj(s.shop) && isObj(s.shop.owned) && Object.keys(s.shop.owned).every(id => SHOP_IDS[id] && isObj(s.shop.owned[id]) && isDate(s.shop.owned[id].date) && Number.isFinite(s.shop.owned[id].price) && s.shop.owned[id].price >= 0);
    if(!ok){
      const owned = {};
      if(isObj(s.shop) && isObj(s.shop.owned)) Object.keys(s.shop.owned).forEach(id => { const o = s.shop.owned[id]; if(SHOP_IDS[id] && isObj(o) && isDate(o.date) && Number.isFinite(o.price) && o.price >= 0) owned[id] = {date:o.date, price:Math.round(o.price)}; });
      s.shop = Object.assign({}, isObj(s.shop) && Array.isArray(s.shop.buys) ? {buys:s.shop.buys} : {}, {owned}); fixed++;
    }
  }
  if(isObj(s.shop) && s.shop.buys !== undefined){
    const ok = buysOf(s);
    if(!Array.isArray(s.shop.buys) || ok.length !== s.shop.buys.length){ s.shop.buys = ok.map(b => ({id:b.id, date:b.date, price:Math.round(b.price)})); fixed++; }
  }
  if(s.scrolls !== undefined){
    const u = (isObj(s.scrolls) && isObj(s.scrolls.used)) ? s.scrolls.used : null, keep = {};
    if(u) Object.keys(u).forEach(k => { const m = /^(workout|study|sleep)\|(\d{4}-\d{2}-\d{2})$/.exec(k); if(m && isDate(m[2]) && ['common','rare','forbidden'].includes(u[k])) keep[k] = u[k]; });
    if(!u || Object.keys(keep).length !== Object.keys(u).length){ s.scrolls = {used:keep}; fixed++; }
  }
  if(s.oncall !== undefined){
    const oc = Array.isArray(s.oncall) ? [...new Set(s.oncall.filter(isDate))].sort() : [];
    if(!Array.isArray(s.oncall) || oc.length !== s.oncall.length){ s.oncall = oc; fixed++; }
  }
  if(s.swaps !== undefined){
    const sw = swapList(s);
    if(!Array.isArray(s.swaps) || sw.length !== s.swaps.length){ s.swaps = sw; fixed++; }
  }
  if(s.celebrated !== undefined && !(typeof s.celebrated === 'number' && isFinite(s.celebrated) && s.celebrated >= 0)){ s.celebrated = 0; delete s.celebratedId; fixed++; }
  if(s.themeRank !== undefined && !(Number.isInteger(s.themeRank) && s.themeRank >= 0 && s.themeRank < RANKS.length)){ delete s.themeRank; delete s.themeRankId; fixed++; }
  if(typeof s.name !== 'string'){ s.name = 'Ninja'; fixed++; }
  if(s.notify !== undefined && !isObj(s.notify)){ delete s.notify; fixed++; }

  const coll = (src, fn) => { const out = {}; if(!isObj(src)){ if(src != null) fixed++; return out; } Object.keys(src).forEach(k => { if(!isDate(k) || !isObj(src[k])){ fixed++; return; } const v = fn(k, src[k]); if(v) out[k] = v; else fixed++; }); return out; };
  const days = coll(d.days, (k, doc) => {
    const list = Array.isArray(doc.sets) ? doc.sets : [];
    const okS = x => okSet(x) && x.reps >= 0 && x.reps <= 999 && okTime(x.t) && (x.kg === undefined || (typeof x.kg === 'number' && isFinite(x.kg) && x.kg >= 0 && x.kg <= LOAD.cap));
    const good = list.filter(okS);
    if(Array.isArray(doc.sets) && good.length === list.length && doc.date === k) return doc;
    fixed += list.length - good.length;
    return Object.assign({}, doc, {date:k, sets:good});
  });
  const study = coll(d.study, (k, doc) => {
    const list = Array.isArray(doc.entries) ? doc.entries : [];
    const okE = e => isObj(e) && typeof e.min === 'number' && isFinite(e.min) && e.min >= 0 && e.min <= 1440 && okTime(e.end) && (e.start == null || okTime(e.start));
    const good = list.filter(okE);
    if(Array.isArray(doc.entries) && good.length === list.length && doc.date === k) return doc;
    fixed += list.length - good.length;
    return Object.assign({}, doc, {date:k, entries:good});
  });
  const sleep = coll(d.sleep, (k, doc) => {
    const n = sleepNight(doc); if(!n || (!n.oncall && !n.logged)) return null;
    const out = {date:k, mins:n.mins, score:n.score, bed:n.bed == null ? null : doc.bed, wake:n.wake == null ? null : doc.wake, oncall:n.oncall};
    if(typeof doc.t === 'string') out.t = doc.t;
    if(out.mins !== doc.mins || out.score !== (doc.score === undefined ? null : doc.score) || (doc.bed != null && n.bed == null) || (doc.wake != null && n.wake == null)) fixed++;
    return out;
  });
  const body = coll(d.body, (k, doc) => (typeof doc.weight === 'number' && isFinite(doc.weight) && doc.weight >= 20 && doc.weight <= 500) ? (doc.date === k ? doc : Object.assign({}, doc, {date:k})) : null);
  let timer = d.timer;
  if(timer != null){
    const now = nowMs == null ? Date.now() : nowMs;
    const okRun = isObj(timer) && timer.state === 'running' && typeof timer.segStart === 'number' && timer.segStart <= now + 60000 && timer.segStart > now - 2*86400000 && (timer.checkAt == null || typeof timer.checkAt === 'number');
    const okIdle = isObj(timer) && (timer.state === 'idle' || (timer.state === 'paused' && (timer.sessionMs == null || (typeof timer.sessionMs === 'number' && timer.sessionMs >= 0))));
    if(!okRun && !okIdle){ timer = {state:'idle'}; if(!(isObj(d.timer) && d.timer.state === 'running')) fixed++; }
  }
  const out = Object.assign({}, d, {settings:s, days, study, body, timer});
  if(d.sleep !== undefined) out.sleep = sleep;
  if(!isObj(d.prefs)) delete out.prefs;
  if(!isObj(d.media)) delete out.media;
  if(studyStart != null && !isDate(studyStart)) delete out.studyStart;
  if(d.examWeeks !== undefined && !Array.isArray(d.examWeeks)) delete out.examWeeks;
  return {ok:true, data:out, fixed};
}

/* ---------- achievements: each one knows the day it was earned ---------- */
const ACHIEVEMENTS = [
  {id:'first',    cat:'Missions', name:'First Mission',      need:'Complete your first mission'},
  {id:'clean',    cat:'Missions', name:'Clean Week',         need:'Finish a full week with no missed mission'},
  {id:'month',    cat:'Missions', name:'The Unbroken Month', need:'A whole calendar month with no missed mission and no missed study day'},
  {id:'tp1k',     cat:'Missions', name:'Thousand Pulls',     need:'1,000 total pull-ups logged'},
  {id:'td2k',     cat:'Missions', name:'River of Dips',      need:'2,500 total dips logged'},
  {id:'scale',    cat:'Missions', name:'Scale Keeper',       need:'Log your weight 4 times'},
  {id:'genin',    cat:'Missions', name:'Graduation',         need:'Reach the rank of Genin'},
  {id:'pr',       cat:'Strength', name:'Record Breaker',     need:'Set a new max on a test day'},
  {id:'prp',      cat:'Strength', name:'Higher Bar',         need:'Your first new pull-up max'},
  {id:'prd',      cat:'Strength', name:'Deeper Press',       need:'Your first new dip max'},
  {id:'p10',      cat:'Strength', name:'Double Digits',      need:'10 strict pull-ups in one set'},
  {id:'p15',      cat:'Strength', name:'Iron Grip',          need:'15 strict pull-ups in one set'},
  {id:'p20',      cat:'Strength', name:'Sky Climber',        need:'20 strict pull-ups in one set'},
  {id:'d25',      cat:'Strength', name:'Steel Frame',        need:'25 strict dips in one set'},
  {id:'d30',      cat:'Strength', name:'Stone Pillar',       need:'30 strict dips in one set'},
  {id:'d40',      cat:'Strength', name:'Mountain Press',     need:'40 strict dips in one set'},
  {id:'sh100',    cat:'Study',    name:'Hundred Hours',      need:'100 hours of study logged'},
  {id:'sh500',    cat:'Study',    name:'The Long Library',   need:'500 hours of study logged'},
  {id:'sh1000',   cat:'Study',    name:'Thousand-Hour Sage', need:'1,000 hours of study logged'},
  {id:'scholar',  cat:'Study',    name:'Scholar\'s Week',    need:'Study 30 hours in one week'},
  {id:'fullweek', cat:'Study',    name:'Every Column Filled', need:'Fill the study scroll on every study day of a week'},
  {id:'s7',       cat:'Streaks',  name:'Seven Suns',         need:'Hold a 7-day workout streak'},
  {id:'s30',      cat:'Streaks',  name:'Moon Cycle',         need:'Hold a 30-day workout streak'},
  {id:'s100',     cat:'Streaks',  name:'Hundred-Day Vow',    need:'Hold a 100-day workout streak'},
  {id:'ss7',      cat:'Streaks',  name:'Seven Scrolls',      need:'Hold a 7-day study streak'},
  {id:'ss30',     cat:'Streaks',  name:'Thirty Lamps',       need:'Hold a 30-day study streak'},
  {id:'sl7',      cat:'Streaks',  name:'Seven Quiet Nights', need:'Seven good nights of sleep in a row'},
  {id:'sl30',     cat:'Streaks',  name:'The Rested Mind',    need:'Thirty good nights of sleep in a row'},
  {id:'comeback', cat:'Streaks',  name:'Back from the Dead', need:'Rebuild a broken streak to 7 days'},
  {id:'dawn',     cat:'Secret',   name:'Dawn Patrol',        need:'Log a set between 4 and 6 in the morning', hidden:true},
  {id:'offday8',  cat:'Secret',   name:'Thursday Scholar',   need:'Fill the scroll on an off-day Thursday (8 hours)', hidden:true},
  {id:'four',     cat:'Secret',   name:'Four Teachers',      need:'Win all four sensei challenges in the same week', hidden:true},
  {id:'underfire', cat:'Secret',  name:'Under Fire',         need:'Complete a mission during an exam week', hidden:true},
  {id:'combo25',  cat:'Secret',   name:'Mind and Muscle',    need:'Earn 25 study combos', hidden:true},
  {id:'hokage',   cat:'Secret',   name:'The Hat',            need:'Reach the rank of Hokage', hidden:true}
];
const monthEnd = ym => { const [y, m] = ym.split('-').map(Number); return ymd(new Date(y, m, 0)); };
const monthOf = d => d.slice(0, 7);
const nextMonth = ym => { const [y, m] = ym.split('-').map(Number); return ymd(new Date(y, m, 1)).slice(0, 7); };
/* calendar months that are over and were lived in full, with what went wrong in each */
function monthsOf(C){
  const out = {}, s = C.settings;
  const M = ym => out[ym] || (out[ym] = {ym, days:0, done:0, missed:0, smissed:0, exam:0});
  C.days.forEach(d => { const m = M(monthOf(d.date)); m.days++; if(d.status === 'done') m.done++; if(d.status === 'missed') m.missed++; if(d.status === 'exam') m.exam++; });
  C.study.list.forEach(r => { if(r.status === 'missed') M(monthOf(r.date)).smissed++; });
  Object.values(out).forEach(m => { const end = monthEnd(m.ym); m.end = end; m.complete = end < C.today; m.whole = m.complete && isDate(s.startDate) && s.startDate <= m.ym + '-01'; m.perfect = m.whole && m.missed === 0 && m.smissed === 0 && m.done > 0; });
  return out;
}
function achievements(C){
  if(C._ach) return C._ach;
  const got = {}, s = C.settings, set = (id, date) => { if(date && (!got[id] || date < got[id])) got[id] = date; };
  const PULL = [[10,'p10'],[15,'p15'],[20,'p20']], DIP = [[25,'d25'],[30,'d30'],[40,'d40']];
  const base = (ex, list) => { const b = (s.baseline || {})[ex]; if(b) list.forEach(([n, id]) => { if(b.max >= n) set(id, isDate(b.date) ? b.date : s.startDate); }); };
  base('pullups', PULL); base('dips', DIP);
  C.prs.forEach(p => {
    set('pr', p.date);
    if(p.ex === 'pullups'){ set('prp', p.date); PULL.forEach(([n, id]) => { if(p.v >= n) set(id, p.date); }); }
    if(p.ex === 'dips'){ set('prd', p.date); DIP.forEach(([n, id]) => { if(p.v >= n) set(id, p.date); }); }
  });
  const reps = {}; let combos = 0;
  C.days.forEach(d => {
    if(d.status === 'done'){ set('first', d.date); if(isExam(s, d.date)) set('underfire', d.date); }
    if(d.streak >= 7) set('s7', d.date); if(d.streak >= 30) set('s30', d.date); if(d.streak >= 100) set('s100', d.date);
    d.sets.forEach(x => { reps[x.ex] = (reps[x.ex] || 0) + x.reps; const h = new Date(x.t).getHours(); if(h >= 4 && h < 6) set('dawn', d.date); });
    if((reps.pullups || 0) >= 1000) set('tp1k', d.date); if((reps.dips || 0) >= 2500) set('td2k', d.date);
    if(d.peak >= 1) set('genin', d.date); if(d.peak >= RANKS.length - 1) set('hokage', d.date);
    combos += d.info.combo || 0; if(combos >= 25) set('combo25', d.date);
  });
  C.weekList.forEach(w => { if(w.days === 7 && w.missed === 0 && w.done > 0 && addDays(w.start, 6) < C.today) set('clean', addDays(w.start, 6)); });
  const byWeek = {};
  C.awards.forEach(a => { if(!a) return; if(a.key === 'study') set('scholar', a.date); else { const m = byWeek[a.week] || (byWeek[a.week] = {n:0, last:a.date}); m.n++; if(a.date > m.last) m.last = a.date; } });
  Object.values(byWeek).forEach(m => { if(m.n >= 4) set('four', m.last); });
  if(C.body.length >= 4) set('scale', C.body[3].date);
  let mins = 0; const sw = {};
  C.study.list.forEach(r => {
    mins += r.mins;
    if(mins >= 6000) set('sh100', r.date); if(mins >= 30000) set('sh500', r.date); if(mins >= 60000) set('sh1000', r.date);
    if(r.streak >= 7) set('ss7', r.date); if(r.streak >= 30) set('ss30', r.date);
    if(r.tgt && r.tgt.off && r.mins >= r.tgt.full) set('offday8', r.date);
    const wk = weekStart(r.date), W = sw[wk] || (sw[wk] = {days:0, need:0, full:0});
    W.days++; if(r.tgt && !r.tgt.off){ W.need++; if(r.mins >= r.tgt.full) W.full++; }
  });
  (C.sleep ? C.sleep.list : []).forEach(r => { if(r.streak >= 7) set('sl7', r.date); if(r.streak >= 30) set('sl30', r.date); });
  Object.keys(sw).forEach(wk => { const W = sw[wk]; if(W.days === 7 && W.need >= 6 && W.full === W.need && addDays(wk, 6) <= C.today) set('fullweek', addDays(wk, 6)); });
  Object.values(monthsOf(C)).forEach(m => { if(m.perfect) set('month', m.end); });
  const st = streakStory(C); if(st.first) set('comeback', st.first);
  const list = ACHIEVEMENTS.map(a => Object.assign({}, a, {date:got[a.id] || null}));
  Object.defineProperty(C, '_ach', {value:list, enumerable:false});
  return list;
}

/* ---------- the monthly mission report ---------- */
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const monthLabel = ym => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
const hoursText = m => { m = Math.max(0, Math.round(m)); const h = Math.floor(m/60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };
function monthReport(C, ym){
  const s = C.settings, first = ym + '-01', end = monthEnd(ym);
  const days = C.days.filter(d => d.date >= first && d.date <= end), st = C.study.list.filter(r => r.date >= first && r.date <= end);
  if(!days.length && !st.length) return null;
  const from = days.length ? days[0].date : st[0].date, to = days.length ? days[days.length-1].date : st[st.length-1].date;
  const reps = {}; C.exIds.forEach(id => { reps[id] = 0; });
  const missions = {done:0, missed:0, rest:0, exam:0, open:0};
  let xp = 0, bestStreak = 0;
  days.forEach(d => { d.sets.forEach(x => { reps[x.ex] = (reps[x.ex] || 0) + x.reps; }); missions[d.status] = (missions[d.status] || 0) + 1; xp += d.gain; bestStreak = Math.max(bestStreak, d.streak); });
  if(!days.length) st.forEach(r => { xp += r.xp; });
  const study = {mins:0, best:null, daysMin:0, daysFull:0, missed:0, shields:0, days:0, bestStreak:0};
  st.forEach(r => {
    study.mins += r.mins; if(r.mins > 0 && (!study.best || r.mins > study.best.mins)) study.best = {date:r.date, mins:r.mins};
    if(r.tgt && r.status !== 'exam'){ study.days++; if(r.status === 'done') study.daysMin++; }
    if(r.tgt && r.mins >= r.tgt.full) study.daysFull++;
    if(r.status === 'missed') study.missed++; if(r.status === 'shield') study.shields++;
    study.bestStreak = Math.max(study.bestStreak, r.streak);
  });
  /* each max as it stood before the month and at its end */
  const maxes = C.exIds.map(id => {
    const h = C.maxHist[id] || []; let a = null, b = null;
    h.forEach(p => { if(p.start || p.date < first) a = p.v; if(p.start || p.date <= end) b = p.v; });
    return {ex:id, from:a, to:b};
  }).filter(m => m.to != null);
  const before = C.days.filter(d => d.date < first), prev = before.length ? before[before.length-1] : null, lastDay = days.length ? days[days.length-1] : prev;
  const rankFrom = prev ? prev.peak : 0, rankTo = lastDay ? lastDay.peak : 0;
  const prs = C.prs.filter(p => p.date >= first && p.date <= end);
  const awards = C.awards.filter(a => a && a.date >= first && a.date <= end);
  const earned = achievements(C).filter(a => a.date && a.date >= first && a.date <= end);
  const body = C.body.filter(b => b.date >= first && b.date <= end);
  const story = streakStory(C), comeback = !!(story.comeback && story.comeback.date >= first && story.comeback.date <= end);
  const exam = examList(s).some(e => e && e.start <= end && e.end >= first);
  const sl = (C.sleep ? C.sleep.list : []).filter(r => r.date >= first && r.date <= end), slLog = sl.filter(r => r.logged), slScore = slLog.filter(r => r.score != null);
  const sleepR = sl.length ? {nights:slLog.length, good:sl.filter(r => r.status === 'good').length, oncall:sl.filter(r => r.status === 'oncall').length,
    avgMins:slLog.length ? slLog.reduce((m, r) => m + r.mins, 0)/slLog.length : 0, avgScore:slScore.length ? Math.round(slScore.reduce((m, r) => m + r.score, 0)/slScore.length) : null,
    bestStreak:sl.reduce((m, r) => Math.max(m, r.streak), 0)} : null;
  const R = {ym, label:monthLabel(ym), from, to, complete:end < C.today, name:s.name || 'Ninja', study, reps, maxes, prs, missions, xp, bestStreak, rankFrom, rankTo, promoted:rankTo > rankFrom,
    awards:awards.length, earned, comeback, exam, sleep:sleepR, weight:body.length ? {from:body[0].weight, to:body[body.length-1].weight, n:body.length} : null, totalAfter:lastDay ? lastDay.total : 0};
  R.title = chapterTitle(R);
  R.summary = hokageSummary(R);
  return R;
}
/* a chapter title from what happened in the month */
function chapterTitle(R){
  const m = R.missions;
  if(R.promoted) return RANKS[R.rankTo].id === 'hokage' ? 'The Village Has a Hokage' : `Rise of the ${RANKS[R.rankTo].name}`;
  if(R.comeback) return 'Back from the Brink';
  if(R.complete && m.missed === 0 && R.study.missed === 0 && m.done > 0) return 'The Unbroken Month';
  if(R.prs.length >= 2) return 'Breaking Limits';
  if(R.exam) return 'Trial by Exams';
  if(R.prs.length === 1) return 'A New Record';
  if(R.study.mins >= 120*60) return 'The Scholar\'s Vigil';
  if(m.missed + R.study.missed >= 6) return 'Storm Season';
  if(m.missed + R.study.missed > 0) return 'Stumble and Rise';
  if(m.done === 0 && R.study.mins === 0) return 'The Quiet Month';
  return 'Steady Steps';
}
/* the Third Hokage's few lines about the month, built from the numbers */
function hokageSummary(R){
  const m = R.missions, st = R.study, out = [], tried = m.done + m.missed, rate = tried ? m.done/tried : 1, srate = st.days ? st.daysMin/st.days : 1;
  const name = R.name;
  if(tried + st.days === 0) out.push(`A quiet month, ${name}. Nothing was asked of you and nothing was owed.`);
  else if(m.missed === 0 && st.missed === 0) out.push(`Not one mission missed and not one study day lost, ${name}. A month like this is rare, and it was earned one day at a time.`);
  else if(rate >= .85 && srate >= .8) out.push(`A strong month, ${name}. ${m.done} missions done, and the few that slipped did not stop you.`);
  else if(rate >= .6) out.push(`An honest month, ${name}: ${m.done} missions done and ${m.missed} missed. The record shows both, and both teach.`);
  else out.push(`A hard month, ${name}. ${m.missed} missions were missed. You are still here reading this, and that is where every recovery begins.`);
  if(R.promoted) out.push(`You began it as ${RANKS[R.rankFrom].name} and you end it as ${RANKS[R.rankTo].name}. Wear the new rank well.`);
  if(R.prs.length) out.push(R.prs.length === 1 ? 'One of your maxes moved this month. Strength that is measured is strength that is real.' : `${R.prs.length} new maxes. Your body is answering the work.`);
  if(st.days){
    if(st.mins >= 100*60) out.push(`${hoursText(st.mins)} at the desk. That is the quiet kind of training nobody sees, and it counts the most.`);
    else if(st.missed > st.daysMin) out.push(`The books were opened less than they were owed: ${hoursText(st.mins)} in the month. Start each day with the first hour and the rest follows.`);
    else out.push(`${hoursText(st.mins)} of study, with the minimum reached on ${st.daysMin} ${st.daysMin === 1 ? 'day' : 'days'}.`);
  }
  if(R.comeback) out.push('A streak fell and you rebuilt it. Remember how that felt the next time one breaks.');
  out.push(!R.complete ? 'The month is not over. There is still time to change this page.' : (rate >= .85 && srate >= .8) ? 'Carry it into the next month. Do not chase more; repeat this.' : 'Next month, protect the small days. They are the ones that decide it.');
  return out;
}
/* every month so far as a chapter of the story */
function chapters(C){
  if(C._chapters) return C._chapters;
  const list = [], s = C.settings;
  const start = [s.startDate, s.studyStart].filter(isDate).sort()[0];
  if(start && start <= C.today){
    for(let ym = monthOf(start), n = 1; ym <= monthOf(C.today) && n < 400; ym = nextMonth(ym)){
      const R = monthReport(C, ym); if(!R) continue;
      list.push({n, ym, label:R.label, title:R.title, complete:R.complete, report:R}); n++;
    }
  }
  Object.defineProperty(C, '_chapters', {value:list, enumerable:false});
  return list;
}

/* ---------- auto-progression: after a finished test, what next week's groove settings should be ---------- */
function progression(C){
  const s = C.settings;
  let ti = -1; for(let i = C.days.length - 1; i >= 0; i--){ const d = C.days[i]; if(d.plan.type === 'test' && d.status === 'done'){ ti = i; break; } }
  if(ti < 0) return null;
  const T = C.days[ti];
  if(daysBetween(T.date, C.today) > 6) return null;                       // by then the next test is due
  let pi = -1; for(let i = ti - 1; i >= 0; i--){ if(C.days[i].plan.type === 'test'){ pi = i; break; } }
  const judged = C.days.slice(Math.max(pi + 1, ti - 13), ti).filter(d => (d.plan.type === 'gtg' || d.plan.type === 'combo') && (d.status === 'done' || d.status === 'missed'));
  const done = judged.filter(d => d.status === 'done').length, full = judged.filter(d => d.status === 'done' && d.info.q >= d.info.goal).length;
  const rate = judged.length ? done/judged.length : null, fullRate = judged.length ? full/judged.length : null;
  const from = addDays(C.today, 1), cur = normEntry(entryFor(s, from)).gtg, gap = Math.max(0, cur.sets - cur.minSets);
  const up = T.info.per.filter(p => p.top > p.prev).length, down = T.info.per.filter(p => p.sets.length && p.top < p.prev).length;
  const g = {sets:cur.sets, minSets:cur.minSets, pct:cur.pct}; let why;
  if(rate == null) why = 'none';
  else if(rate < .6){ why = 'ease'; if(g.sets > 4) g.sets--; else if(g.pct > 40) g.pct -= 5; }
  else if(down && !up){ why = 'down'; if(g.pct > 40) g.pct -= 5; }
  else if(rate === 1 && fullRate >= .75 && !up){ why = 'push'; if(g.pct < 60) g.pct += 5; else if(g.sets < 8) g.sets++; }
  else if(rate === 1 && fullRate >= .75) why = 'rise';
  else why = 'hold';
  g.minSets = Math.max(1, Math.min(g.sets, g.sets - gap));
  const changed = g.sets !== cur.sets || g.minSets !== cur.minSets || g.pct !== cur.pct;
  /* the exercises that have groove days in the coming week, with the reps per set before and after */
  const used = new Set();
  for(let k = 1; k <= 7; k++){ const p = planFor(s, addDays(C.today, k)); if(p.type === 'gtg') used.add(p.ex); else if(p.type === 'combo') p.exs.forEach(x => used.add(x)); }
  const prev = {}; T.info.per.forEach(p => { prev[p.ex] = p.prev; });
  const targets = C.exIds.filter(id => used.has(id)).map(id => ({ex:id, before:gtgTarget(prev[id] != null ? prev[id] : C.maxes[id], cur.pct), after:gtgTarget(C.maxes[id], g.pct)}));
  const a = isObj(s.progression) && s.progression.test === T.date ? s.progression.choice : null;
  return {test:T.date, from, cur, next:g, changed, why, rate, fullRate, done, judged:judged.length, up, down, targets, answered:a || null};
}

/* ---------- exam countdown (separate from the exam-week pass) ---------- */
function examCountdown(C){
  const s = C.settings, x = s.exam;
  if(!isObj(x) || !isDate(x.date)) return null;
  const since = isDate(x.since) ? x.since : C.today, days = daysBetween(C.today, x.date);
  let banked = 0, n = 0;
  C.study.list.forEach(r => { if(r.date >= since && r.date <= x.date){ banked += r.mins; n++; } });
  const weeks = examList(s).filter(e => e && isDate(e.start) && isDate(e.end));
  const covered = weeks.some(e => e.end >= C.today && e.start <= x.date);
  const passUsed = weeks.some(e => e.start.slice(0, 7) === C.today.slice(0, 7));
  return {name:(typeof x.name === 'string' && x.name.trim()) ? x.name.trim() : 'Exam', date:x.date, since, days, passed:days < 0, final:days >= 0 && days <= 14,
    banked, daysCounted:n, suggestPass:days >= 0 && days <= 7 && !covered && !passUsed};
}

/* ---------- shadow clone rival: this week so far against the same weekdays four weeks ago ---------- */
function rival(C){
  const ws = weekStart(C.today), cs = addDays(ws, -RIVAL.back), k = dowOf(C.today);
  const byDate = {}; C.days.forEach(d => { byDate[d.date] = d; });
  const sum = (start, n) => { const t = {xp:0, repsAll:0, mins:0, days:0, exam:0};
    for(let i = 0; i < n; i++){ const d = addDays(start, i), r = byDate[d]; if(!r) continue; t.days++; t.xp += r.gain - (r.rival || 0) - (r.slxp || 0); r.sets.forEach(x => { t.repsAll += x.reps; }); if(isExam(C.settings, d)) t.exam++; const sr = C.study.days[d]; if(sr) t.mins += sr.mins; }
    return t; };
  const lastWk = addDays(ws, -7), L = C.weeks[lastWk], last = (L && L.rival) ? Object.assign({week:lastWk, xp:L.rival.win ? RIVAL.xp : 0}, L.rival) : null;
  const themWeek = sum(cs, 7), me = sum(ws, k + 1), them = sum(cs, k + 1), meWeek = sum(ws, 7);
  let on = ws >= RIVAL.from && themWeek.days === 7 && me.days === k + 1 && byDate[ws] !== undefined, why = null;
  if(on && (themWeek.exam || meWeek.exam)){ on = false; why = 'exam'; }
  else if(!on) why = ws < RIVAL.from ? 'soon' : 'young';
  return {on, why, week:ws, clone:cs, day:k, me, them, themWeek, last, bonus:RIVAL.xp};
}

/* ---------- jutsu: harder variations that become available at a rank ----------
   Reaching the rank only unlocks one. It becomes an exercise when its own baseline is tested and saved,
   and it joins the plan only when it is picked for a day in the Plan tab. */
/* ---------- the skill tree: harder moves unlock as your bodyweight max grows ----------
   Two branches. A move unlocks when your best bodyweight max of its branch reaches the number. Unlocking gives the
   badge; a move enters your training only after its own baseline test and only if you add it to a day in the Plan
   tab. The two weighted moves need no baseline: you learn them by putting weight on with the weight picker. */
const JUTSU = [
  {id:'chest-to-bar-pullups', branch:'pull', of:'pullups', need:10, glyph:'突', nick:'Dynamic Entry',   name:'Chest-to-bar pull-ups', how:'Pull until the bar touches your chest. Same strict form, a longer path.'},
  {id:'archer-pullups',       branch:'pull', of:'pullups', need:12, glyph:'写', nick:'Sharingan Copy',  name:'Archer pull-ups',       how:'One arm pulls while the other stays long on the bar. Alternate sides.'},
  {id:'weighted-pullups',     branch:'pull', of:'pullups', need:14, glyph:'重', nick:"Lee's Weights",   name:'Weighted pull-ups',     how:'Pull-ups with a backpack or a dip belt. Set the weight with the picker above the reps.', load:true},
  {id:'muscle-ups',           branch:'pull', of:'pullups', need:16, glyph:'雷', nick:'Chidori',         name:'Muscle-ups',            how:'From a dead hang to straight arms above the bar in one explosive movement.'},
  {id:'lsit-pullups',         branch:'pull', of:'pullups', need:18, glyph:'影', nick:'Shadow Possession', name:'L-sit pull-ups',      how:'Legs held straight out in front for the whole set.'},
  {id:'typewriter-pullups',   branch:'pull', of:'pullups', need:20, glyph:'渦', nick:'Whirlpool',       name:'Typewriter pull-ups',   how:'Pull up, then travel from hand to hand with your chin above the bar.'},
  {id:'one-arm-negatives',    branch:'pull', of:'pullups', need:25, glyph:'門', nick:'Eight Gates',     name:'One-arm negatives',     how:'Lower yourself slowly on one arm. Each slow descent is one rep.'},
  {id:'weighted-dips',        branch:'push', of:'dips',    need:25, glyph:'岩', nick:'Boulder Body',    name:'Weighted dips',         how:'Dips with a backpack or a dip belt. Set the weight with the picker above the reps.', load:true},
  {id:'pike-pushups',         branch:'push', of:'dips',    need:30, glyph:'龍', nick:'Rising Dragon',   name:'Pike push-ups',         how:'Hips high, hands on the floor, lower the top of your head between your hands and press back up.'},
  {id:'wall-hspu',            branch:'push', of:'dips',    need:35, glyph:'螺', nick:'Rasengan',        name:'Wall handstand push-ups', how:'Kick up to a handstand against the wall, lower your head to the floor with control, press back up.'},
  {id:'ring-dips',            branch:'push', of:'dips',    need:40, glyph:'輪', nick:'Water Prison',    name:'Ring dips',             how:'Dips on rings. The rings move, so every rep has to be controlled.'},
  {id:'korean-dips',          branch:'push', of:'dips',    need:45, glyph:'逆', nick:'Reverse Summoning', name:'Korean dips',         how:'Dips with the bar behind your back. Go only as deep as your shoulders allow.'}
];
function jutsu(C){
  const ex = isObj(C.settings.exercises) ? C.settings.exercises : {}, base = C.settings.baseline || {};
  /* the day a bodyweight max first reached each number */
  const reached = (of, n) => { const b = base[of]; if(b && b.max >= n) return b.date || C.settings.startDate; const p = C.prs.find(r => r.ex === of && !r.kg && r.v >= n); return p ? p.date : null; };
  return JUTSU.map(j => { const best = C.best[j.of] || 0, unlocked = best >= j.need;
    const learned = j.load ? !!((C.load && C.load[j.of] > 0) || (C.wbest && Object.keys(C.wbest[j.of] || {}).length)) : !!ex[j.id];
    return Object.assign({}, j, {best, unlocked, date:unlocked ? reached(j.of, j.need) : null, learned, baseline:!j.load && learned && base[j.id] ? base[j.id] : null, max:!j.load && learned ? C.maxes[j.id] : null}); });
}

/* ---------- transformation jutsu: hidden forms from other worlds ----------
   Each form unlocks through its own hidden mission, worked out from the logs like an achievement,
   so it knows the day it was earned. Wearing one only changes the picture; the rank stays the rank. */
const TRANSFORMS = [
  {id:'ayanokoji', name:'Kiyotaka Ayanokoji', world:'Classroom of the Elite', color:'#9b7bff', mission:'The Perfect Week', hint:'Seven days. Every scroll. No shield.', need:'A Sunday-to-Saturday week where every workout, study and sleep scroll is complete, with no shield and no exam pass', goal:7, unit:'days this week'},
  {id:'gon', name:'Gon Freecss', world:'Hunter x Hunter', color:'#5fe07a', mission:'Jajanken', hint:'Rock. One day, everything you have.', need:'100 reps or more in a single day', goal:100, unit:'reps on your best day'},
  {id:'kaneki', name:'Ken Kaneki', world:'Tokyo Ghoul', color:'#ff3b4a', mission:'1000 − 7', hint:'1000 − 7 = ?', need:'993 lifetime reps', goal:993, unit:'lifetime reps'},
  {id:'eren', name:'Eren Yeager', world:'Attack on Titan', color:'#ffb347', mission:'Tatakae', hint:'Keep moving forward. Three times past your limit.', need:'Set a new max on 3 different test days', goal:3, unit:'test days with a new max'},
  {id:'tanjiro', name:'Tanjiro Kamado', world:'Demon Slayer', color:'#ff7a2f', mission:'Total Concentration: Constant', hint:'Breathe, even in your sleep. Fourteen nights.', need:'A sleep streak of 14 good nights', goal:14, unit:'night sleep streak'},
  {id:'kirito', name:'Kirito', world:'Sword Art Online', color:'#5fb8ff', mission:'Dual Wielder', hint:'Two blades. Fourteen days.', need:'14 days in a row with both the Workout Scroll and the Study Scroll complete', goal:14, unit:'days in a row'},
  {id:'lelouch', name:'Lelouch vi Britannia', world:'Code Geass', color:'#e0457b', mission:'Checkmate', hint:'Follow the plan. Every move, for a week.', need:'A Sunday-to-Saturday week with no missed mission and the full study goal reached on every study day', goal:7, unit:'days this week'},
  {id:'isagi', name:'Yoichi Isagi', world:'Blue Lock', color:'#3f8cff', mission:'Ego', hint:'Devour your shadow. Four weeks running.', need:'Beat your shadow clone 4 weeks in a row', goal:4, unit:'weeks in a row'},
  {id:'gojo', name:'Satoru Gojo', world:'Jujutsu Kaisen', color:'#6fd3ff', mission:'Limitless', hint:'The strongest studies the most. One month.', need:'150 hours of study in one calendar month', goal:150, unit:'hours in your best month'},
  {id:'tobi', name:'Tobi', world:'Naruto Shippuden', color:'#a98bd6', mission:'Back From the Dead', hint:'Nobody is watching.', need:'After a streak breaks, rebuild it to 21 days', goal:21, unit:'days rebuilt'},
  {id:'jinwoo', name:'Sung Jinwoo', world:'Solo Leveling', color:'#8a5cff', mission:'The Daily Quest', hint:'Daily Quest. Do not fail. Thirty days.', need:'30 days in a row with every scroll complete: workout, study and sleep', goal:30, unit:'days in a row'}
];
function transforms(C){
  if(C._tf) return C._tf;
  const got = {}, prog = {}, set = (id, date) => { if(date && (!got[id] || date < got[id])) got[id] = date; };
  const wd = {}; C.days.forEach(d => { wd[d.date] = d; });
  const sd = C.study.days || {}, ld = (C.sleep && C.sleep.days) || {};
  /* one scroll on one day: ok, neutral (exam pass, shield, on-call: skipped), bad (breaks a run) or open (today, not decided) */
  const W = d => { const r = wd[d]; if(!r) return 'bad'; return (r.status === 'done' || r.status === 'rest') ? 'ok' : (r.status === 'exam' || r.status === 'scroll') ? 'neutral' : r.status === 'open' ? 'open' : 'bad'; };
  const Sx = d => { const r = sd[d]; if(!r) return 'bad'; return (r.status === 'done' || r.status === 'rest') ? 'ok' : (r.status === 'exam' || r.status === 'shield' || r.status === 'scroll') ? 'neutral' : r.status === 'open' ? 'open' : 'bad'; };
  const L = d => { const r = ld[d]; if(!r) return d === C.today ? 'open' : 'bad'; return r.status === 'good' ? 'ok' : (r.status === 'oncall' || r.status === 'exam' || r.status === 'scroll') ? 'neutral' : r.status === 'open' ? 'open' : 'bad'; };
  const join = list => list.includes('bad') ? 'bad' : list.includes('open') ? 'open' : list.includes('neutral') ? 'neutral' : 'ok';
  const starts = [C.settings.startDate, C.study.start, C.sleep && C.sleep.start].filter(isDate).sort();
  const runs = {kirito:0, jinwoo:0}; prog.kirito = 0; prog.jinwoo = 0;
  let reps = 0, bestDay = 0;
  const prDays = new Set(C.prs.map(p => p.date));
  if(starts.length) for(let d = starts[0], g = 0; d <= C.today && g < 4000; d = addDays(d, 1), g++){
    [['kirito', join([W(d), Sx(d)]), 14], ['jinwoo', join([W(d), Sx(d), L(d)]), 30]].forEach(([id, st, n]) => {
      if(st === 'ok') runs[id]++; else if(st === 'bad') runs[id] = 0;
      prog[id] = runs[id]; if(runs[id] >= n) set(id, d);
    });
    const r = wd[d];
    if(r){ const dayReps = r.sets.reduce((m, x) => m + x.reps, 0); reps += dayReps; bestDay = Math.max(bestDay, dayReps); if(dayReps >= 100) set('gon', d); if(reps >= 993) set('kaneki', d); }
  }
  prog.gon = bestDay; prog.kaneki = reps;
  let prn = 0; [...prDays].sort().forEach(d => { prn++; if(prn >= 3) set('eren', d); }); prog.eren = prn;
  (C.sleep ? C.sleep.list : []).forEach(r => { if(r.streak >= 14) set('tanjiro', r.date); });
  prog.tanjiro = C.sleep ? C.sleep.streak : 0;
  /* the two week missions: Ayanokoji (all three scrolls, no shield, no exam) and Lelouch (the plan to the letter) */
  const ayaDay = d => { const a = [W(d), Sx(d), L(d)]; return a.includes('neutral') ? 'bad' : join(a); };
  const lelDay = d => { const w = W(d); if(w !== 'ok') return w === 'open' ? 'open' : 'bad'; const r = sd[d]; if(!r) return 'bad';
    if(!r.tgt || r.tgt.off) return 'ok'; if(r.status === 'exam') return 'bad'; return r.mins >= r.tgt.full ? 'ok' : d === C.today ? 'open' : 'bad'; };
  if(starts.length) for(let ws = weekStart(starts[0]), g = 0; ws <= C.today && g < 600; ws = addDays(ws, 7), g++){
    [['ayanokoji', ayaDay], ['lelouch', lelDay]].forEach(([id, fn]) => {
      let ok = 0, bad = false;
      for(let k = 0; k < 7; k++){ const d = addDays(ws, k); if(d > C.today) break; const st = fn(d); if(st === 'ok') ok++; else if(st === 'bad') bad = true; }
      if(!bad && ok === 7) set(id, addDays(ws, 6));
      if(ws === weekStart(C.today)) prog[id] = bad ? 0 : ok;
    });
  }
  let iso = 0; prog.isagi = 0;
  C.weekList.forEach(w => { if(!w.rival) return; if(w.rival.win){ iso++; if(iso >= 4) set('isagi', addDays(w.start, 6)); } else iso = 0; prog.isagi = iso; });
  const months = {}; let bestM = 0;
  C.study.list.forEach(r => { const m = monthOf(r.date); months[m] = (months[m] || 0) + r.mins; bestM = Math.max(bestM, months[m]); if(months[m] >= 150*60) set('gojo', r.date); });
  prog.gojo = Math.floor(bestM/60);
  /* Tobi: a streak that broke (workout, study or sleep) and was rebuilt to 21 */
  let tobi = 0;
  const scan = (list, isBreak) => { let pending = false; list.forEach((rec, i) => { if(isBreak(rec, i)) pending = true; if(pending){ if(rec.streak >= 21){ set('tobi', rec.date); pending = false; } } }); if(pending) tobi = Math.max(tobi, list.length ? list[list.length-1].streak : 0); };
  scan(C.days, (rec, i) => rec.status === 'missed' && i > 0 && (C.days[i-1].streak || 0) > 0);
  scan(C.study.list, rec => rec.broke);
  if(C.sleep) scan(C.sleep.list, rec => rec.broke);
  prog.tobi = tobi;
  const out = TRANSFORMS.map(t => Object.assign({}, t, {date:got[t.id] || null, n:got[t.id] ? t.goal : Math.min(t.goal, prog[t.id] || 0)}));
  Object.defineProperty(C, '_tf', {value:out, enumerable:false});
  return out;
}

/* ---------- Tsunade's shop: Ryō ----------
   Every 5 XP earns 1 Ryō (back-paid from the first day). Hidden missions that are completed from the shop's
   opening day on pay a Ryō bounty; forms already earned through a mission before the shop opened stay owned.
   The balance is worked out from the logs every time, so it can never drift: earned + bounties - spent. */
const SHOP_FROM = '2026-11-23';
const RYO_PER_XP = 5;
const RARITY = {
  common:   {label:'Common',    price:400,  bounty:150,  color:'#9aa3ad'},
  uncommon: {label:'Uncommon',  price:800,  bounty:300,  color:'#4fb35a'},
  rare:     {label:'Rare',      price:1500, bounty:500,  color:'#3f8ce6'},
  epic:     {label:'Epic',      price:2500, bounty:800,  color:'#a35ee8'},
  legendary:{label:'Legendary', price:4000, bounty:1200, color:'#f08a2c'}
};
const RARITY_OF = {ayanokoji:'common', isagi:'common', gon:'uncommon', tanjiro:'uncommon', kirito:'rare', eren:'rare', kaneki:'rare', lelouch:'epic', gojo:'epic', tobi:'legendary', jinwoo:'legendary'};
const SHOP_IDS = Object.assign({}, ...Object.keys(RARITY_OF).map(id => ({[id]:1})));
/* one form a week is 20% off: "Tsunade's pick", chosen in turn from the forms not owned yet */
function shopPick(C, owned){
  const left = TRANSFORMS.filter(t => !owned[t.id]); if(!left.length) return null;
  const wk = Math.floor((parse(weekStart(C.today)) - parse('2026-11-22')) / (7*86400000));
  return left[((wk % left.length) + left.length) % left.length].id;
}
/* everything else on Tsunade's shelves; cosmetics are bought once and worn from prefs, the ramen and the
   Forbidden Scroll are used up */
const SHOP_ITEMS = [
  {id:'forbidden', kind:'scroll', name:'Forbidden Scroll: Reanimation', price:3000, rarity:'legendary', note:'Covers one missed day in any area. One a month.'},
  {id:'ramen', kind:'treat', name:'Ichiraku Ramen', price:100, rarity:'common', note:'Double Ryō for everything you earn today. One bowl a day.'},
  {id:'card-akatsuki', kind:'card', name:'Akatsuki clouds', price:300, rarity:'epic'},
  {id:'card-anbu', kind:'card', name:'ANBU', price:300, rarity:'rare'},
  {id:'card-uchiha', kind:'card', name:'Uchiha crest', price:300, rarity:'rare'},
  {id:'card-hokage', kind:'card', name:'Hokage robe', price:300, rarity:'legendary'},
  {id:'title-copy', kind:'title', name:'The Copy Ninja', price:150, rarity:'uncommon'},
  {id:'title-beast', kind:'title', name:'Beast of the Hidden Leaf', price:150, rarity:'uncommon'},
  {id:'title-toad', kind:'title', name:"The Toad Sage's Student", price:150, rarity:'uncommon'},
  {id:'title-healer', kind:'title', name:'Healer of the Leaf', price:150, rarity:'uncommon'},
  {id:'title-flash', kind:'title', name:'The Yellow Flash', price:150, rarity:'rare'},
  {id:'title-shadow', kind:'title', name:'Shadow of the Leaf', price:150, rarity:'uncommon'},
  {id:'title-will', kind:'title', name:'Will of Fire', price:150, rarity:'common'},
  {id:'title-sage', kind:'title', name:'Sage of the Six Paths', price:150, rarity:'epic'},
  {id:'fx-chidori', kind:'fx', name:'Chidori blue', price:300, rarity:'rare'},
  {id:'fx-amaterasu', kind:'fx', name:'Amaterasu black flame', price:300, rarity:'epic'},
  {id:'fx-rasengan', kind:'fx', name:'Rasengan swirl', price:300, rarity:'rare'},
  {id:'fx-sage', kind:'fx', name:'Sage orange', price:300, rarity:'uncommon'}
];
const ITEM_OF = Object.assign({}, ...SHOP_ITEMS.map(x => ({[x.id]:x})));
const buysOf = s => (isObj(s.shop) && Array.isArray(s.shop.buys)) ? s.shop.buys.filter(b => isObj(b) && ITEM_OF[b.id] && isDate(b.date) && Number.isFinite(b.price) && b.price >= 0) : [];
function shop(C){
  if(C._shop) return C._shop;
  const s = C.settings || {}, bought = (isObj(s.shop) && isObj(s.shop.owned)) ? s.shop.owned : {}, buys = buysOf(s);
  /* Ryō come only from XP gained: a missed day costs XP, never coins already earned. A bowl of ramen doubles a day. */
  const ramen = new Set(buys.filter(b => b.id === 'ramen').map(b => b.date));
  const earned = Math.floor(C.days.reduce((m, d) => m + Math.max(0, d.gain || 0) * (ramen.has(d.date) ? 2 : 1), 0) / RYO_PER_XP);
  let bounty = 0, spent = buys.reduce((m, b) => m + Math.round(b.price), 0);
  const owned = {};
  const forms = transforms(C).map(t => {
    const r = RARITY[RARITY_OF[t.id] || 'common'], o = bought[t.id];
    let own = null, paid = null;
    if(t.date && t.date < SHOP_FROM) own = {how:'mission', date:t.date};
    else if(t.date){ paid = t.date; bounty += r.bounty; }
    if(!own && isObj(o) && isDate(o.date)){ own = {how:'bought', date:o.date, price:o.price}; spent += Math.max(0, Math.round(o.price) || 0); }
    if(own) owned[t.id] = own;
    return Object.assign({}, t, {rarity:RARITY_OF[t.id] || 'common', rar:r, price:r.price, bountyRyo:r.bounty, bountyPaid:paid, own});
  });
  const pick = shopPick(C, owned);
  forms.forEach(f => { f.pick = f.id === pick; f.cost = f.pick ? Math.round(f.price * 0.8 / 10) * 10 : f.price; });
  const has = {}; buys.forEach(b => { if(ITEM_OF[b.id].kind !== 'treat' && ITEM_OF[b.id].kind !== 'scroll') has[b.id] = b.date; });
  const items = SHOP_ITEMS.map(it => Object.assign({}, it, {rar:RARITY[it.rarity], owned:has[it.id] || null}));
  const ramenToday = ramen.has(C.today), forbiddenMonth = buys.some(b => b.id === 'forbidden' && monthOf(b.date) === monthOf(C.today));
  const quests = sideQuests(C).ryo;
  const out = {earned, bounty, quests, spent, balance:earned + bounty + quests - spent, forms, owned, pick, items, buys, ramenToday, forbiddenMonth};
  Object.defineProperty(C, '_shop', {value:out, enumerable:false});
  return out;
}

/* ---------- protection scrolls: the inventory ----------
   Counted from SCROLL_FROM. In each area, 7 days in a row without a break earns a Common scroll for that area,
   30 a Rare scroll (any area), 60 a Forbidden Scroll (any area); a bought Forbidden Scroll arrives on its day.
   A missed day takes the area's scroll first, then a Rare, then a Forbidden; using one restarts that area's count.
   'pending' lists the covers the app still has to write into settings.scrolls.used. */
const SCROLL = {common:7, rare:30, forbidden:60, capCommon:2, capRare:2, capForbidden:1};
const SCROLL_AREAS = ['workout', 'study', 'sleep'];
function scrollBook(C){
  if(C._scrolls) return C._scrolls;
  const s = C.settings || {}, used = (isObj(s.scrolls) && isObj(s.scrolls.used)) ? s.scrolls.used : {};
  const wd = {}; C.days.forEach(d => { wd[d.date] = d; });
  const cls = (area, d) => {
    const r = area === 'workout' ? wd[d] : area === 'study' ? C.study.days[d] : (C.sleep && C.sleep.days[d]);
    if(!r) return 'skip';
    const st = r.status;
    if(st === 'scroll') return 'used';
    if(st === 'open') return 'skip';
    if(area === 'sleep') return st === 'good' ? 'good' : (st === 'short' || st === 'missed') ? 'bad' : 'neutral';
    return (st === 'done' || st === 'rest') ? 'good' : st === 'missed' ? 'bad' : 'neutral';
  };
  const inv = {workout:0, study:0, sleep:0, rare:0, forbidden:0}, count = {workout:0, study:0, sleep:0}, pending = [], log = [];
  const boughtOn = {}; buysOf(s).filter(b => b.id === 'forbidden').forEach(b => { boughtOn[b.date] = (boughtOn[b.date] || 0) + 1; });
  const take = area => { if(inv[area] > 0){ inv[area]--; return 'common'; } if(inv.rare > 0){ inv.rare--; return 'rare'; } if(inv.forbidden > 0){ inv.forbidden--; return 'forbidden'; } return null; };
  Object.keys(boughtOn).filter(d => d < SCROLL_FROM && d <= C.today).forEach(d => { inv.forbidden = Math.min(SCROLL.capForbidden, inv.forbidden + boughtOn[d]); });
  if(C.today >= SCROLL_FROM) for(let d = SCROLL_FROM, g = 0; d <= C.today && g < 4000; d = addDays(d, 1), g++){
    if(boughtOn[d]) inv.forbidden = Math.min(SCROLL.capForbidden, inv.forbidden + boughtOn[d]);
    SCROLL_AREAS.forEach(area => {
      const c = cls(area, d);
      if(c === 'used'){
        const want = used[area + '|' + d];
        if(want === 'rare' && inv.rare > 0) inv.rare--; else if(want === 'forbidden' && inv.forbidden > 0) inv.forbidden--; else if(inv[area] > 0) inv[area]--;
        count[area] = 0; log.push({date:d, area, kind:'used', type:want});
      } else if(c === 'bad' && d < C.today){
        const t = take(area);
        if(t){ pending.push({key:area + '|' + d, area, date:d, type:t}); log.push({date:d, area, kind:'used', type:t}); }
        count[area] = 0;
      } else if(c === 'good'){
        const n = ++count[area];
        if(n % SCROLL.common === 0 && inv[area] < SCROLL.capCommon){ inv[area]++; log.push({date:d, area, kind:'earned', type:'common'}); }
        if(n % SCROLL.rare === 0 && inv.rare < SCROLL.capRare){ inv.rare++; log.push({date:d, area, kind:'earned', type:'rare'}); }
        if(n % SCROLL.forbidden === 0 && inv.forbidden < SCROLL.capForbidden){ inv.forbidden++; log.push({date:d, area, kind:'earned', type:'forbidden'}); }
      }
    });
  }
  const out = {inv, count, pending, log, from:SCROLL_FROM};
  Object.defineProperty(C, '_scrolls', {value:out, enumerable:false});
  return out;
}

/* ---------- the Hokage Book: one chapter per rank, written from the logs ----------
   A chapter runs from the day a rank was reached to the day before the next one (or today). Ranks not reached
   yet are sealed. The finale opens on the day Hokage is reached and covers the whole journey. */
function hokageBook(C){
  if(C._book) return C._book;
  const s = C.settings || {}, days = C.days, reachedOn = [];
  RANKS.forEach((r, i) => { if(i === 0){ reachedOn.push(days.length ? days[0].date : (s.startDate || C.today)); return; } const d = days.find(x => x.peak >= i); reachedOn.push(d ? d.date : null); });
  const ach = achievements(C), sh = shop(C);
  const baseMax = id => { const b = (s.baseline || {})[id]; return posNum(b && b.max, 0); };
  const maxAt = (id, upto) => C.prs.filter(p => p.ex === id && p.date <= upto).reduce((m, p) => Math.max(m, p.v), baseMax(id));
  const range = (from, to) => {
    const ds = days.filter(x => x.date >= from && x.date <= to), reps = {};
    ds.forEach(x => x.sets.forEach(z => { reps[z.ex] = (reps[z.ex] || 0) + z.reps; }));
    const st = C.study.list.filter(r => r.date >= from && r.date <= to), sl = (C.sleep ? C.sleep.list : []).filter(r => r.date >= from && r.date <= to);
    return {
      days:Math.max(1, daysBetween(from, to) + 1),
      reps, repsAll:Object.keys(reps).reduce((m, k) => m + reps[k], 0),
      done:ds.filter(x => x.status === 'done').length, missed:ds.filter(x => x.status === 'missed').length,
      bestStreak:ds.reduce((m, x) => Math.max(m, x.streak || 0), 0),
      studyMins:st.reduce((m, r) => m + (r.mins || 0), 0), studyDays:st.filter(r => r.status === 'done').length,
      goodNights:sl.filter(r => r.status === 'good').length,
      prs:C.prs.filter(p => p.date >= from && p.date <= to),
      maxes:Object.assign({}, ...C.exIds.map(id => ({[id]:maxAt(id, to)}))),
      ach:ach.filter(a => a.date && a.date >= from && a.date <= to).map(a => a.name),
      forms:sh.forms.filter(f => f.own && f.own.date >= from && f.own.date <= to).map(f => f.name),
      xp:ds.length ? ds[ds.length - 1].total - (ds[0].total - ds[0].gain) : 0
    };
  };
  const chapters = RANKS.map((r, i) => {
    const from = reachedOn[i];
    if(!from || from > C.today) return {i, id:r.id, name:r.name, sealed:true, xpNeeded:r.xp};
    const nextOn = reachedOn[i + 1], to = nextOn && nextOn <= C.today ? addDays(nextOn, -1) : C.today;
    const tookFrom = i === 0 ? from : reachedOn[i - 1];
    return Object.assign({i, id:r.id, name:r.name, sealed:false, from, to, open:!(nextOn && nextOn <= C.today), took:i === 0 ? 0 : daysBetween(tookFrom, from)}, range(from, to));
  });
  const top = RANKS.length - 1, start = reachedOn[0];
  const finale = chapters[top].sealed ? null : Object.assign({from:start, to:C.today, journey:daysBetween(start, reachedOn[top]),
    firstMaxes:Object.assign({}, ...C.exIds.map(id => ({[id]:baseMax(id)}))), owned:sh.forms.filter(f => f.own).length, achCount:ach.filter(a => a.date).length}, range(start, C.today));
  const out = {chapters, finale, reached:chapters.filter(c => !c.sealed).length};
  Object.defineProperty(C, '_book', {value:out, enumerable:false});
  return out;
}

return {
  QUESTS, sideQuests, onCallDay, LOAD, kgOf, e1rm, bwAt, suggestKg, strengthNow, monthBwTest,
  hokageBook, SCROLL_FROM, scrollUsed, SCROLL, scrollBook, SHOP_ITEMS,
  TRANSFORMS, transforms, swapOf, RARITY, SHOP_FROM, RYO_PER_XP, shop,
  RANKS, XP, TIERS, mult, nextTier, DEFAULT_PLAN, DEFAULT_GTG, DEFAULT_TEST, CHALLENGES, STUDY, STUDY_DEFAULT, SET_CAP,
  pad, ymd, parse, isDate, addDays, dowOf, dnum, daysBetween, weekStart, dateAt, dayStartMs, rankFor,
  sortedHistory, entryFor, normEntry, planFor, gtgTarget, studyPlanOf, studyTarget, examFor, isExam,
  splitByDay, provisionalPieces, hourTimes, computeStudy, comboMatches, compute, streakStory, cleanBackup,
  SLEEP, SLEEP_DEFAULT, sleepPlanOf, sleepGoal, clockMin, bedOk, wakeOk, sleepNight, computeSleep,
  ACHIEVEMENTS, achievements, monthsOf, monthEnd, monthLabel, monthReport, chapterTitle, hokageSummary, chapters, hoursText, progression, examCountdown, RIVAL, raceResult, rival, FOCUS, focusSpans, timerSpans, JUTSU, jutsu
};
});
