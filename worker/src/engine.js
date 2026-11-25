/* The Leaf Village · game engine, as the Worker runs it.
   This is a port of compute(), computeStudy(), planFor() and friends from the app's leaf-engine.js,
   working in village time whatever clock the server uses, and able to resume from a checkpoint.
   The rules live in the app; if leaf-engine.js changes, change this file the same way
   (tests/unit/engine.test.mjs compares the two day by day).

   Dates are plain 'YYYY-MM-DD' strings in village time (Asia/Baghdad, UTC+3, no daylight saving). */

export const TZ_MS = 3 * 3600000;
export const RANKS = [
  {id:'academy', name:'Academy Student', xp:0}, {id:'genin', name:'Genin', xp:1500}, {id:'chunin', name:'Chunin', xp:5000},
  {id:'special-jonin', name:'Special Jonin', xp:10000}, {id:'jonin', name:'Jonin', xp:16000}, {id:'anbu', name:'ANBU', xp:22500},
  {id:'akatsuki', name:'Akatsuki', xp:29500}, {id:'sannin', name:'Sannin', xp:37000}, {id:'sage', name:'Sage Mode', xp:45000},
  {id:'susanoo', name:'Susanoo', xp:53000}, {id:'tailed-beast', name:'Tailed Beast Mode', xp:61000},
  {id:'eight-gates', name:'Eight Gates', xp:68500}, {id:'kage', name:'Kage', xp:73500}, {id:'hokage', name:'Hokage', xp:77500}
];
export const XP = { gtgSet:10, gtgComplete:50, gtgFull:20, testRep:2, testComplete:100, pr:75, rest:10, missGtg:100, missTest:150 };
const TIERS = [[0,1],[7,1.1],[14,1.2],[30,1.3],[60,1.5]];
const mult = st => { let m = 1; for(const [n, v] of TIERS) if(st >= n) m = v; return m; };
const DEFAULT_PLAN = [
  {type:'gtg',ex:'pullups'},{type:'gtg',ex:'dips'},{type:'gtg',ex:'pullups'},{type:'gtg',ex:'dips'},
  {type:'rest'},{type:'test'},{type:'rest'}
];
export const CHALLENGES = {
  kakashi:{goal:15, xp:60, title:'Precision drill'}, guy:{goal:1, xp:100, title:'Burning youth'},
  jiraiya:{goal:2, xp:40, title:'Field research'}, hiruzen:{goal:7, xp:120, title:'Village duty'}
};
export const STUDY = {halfXp:20, minBonus:50, fullBonus:30, combo:10, comboWindow:60*60000, weekGoal:1800, weekXp:400, capMs:3*3600000, offFull:480};
const STUDY_DEFAULT = {week:{min:240, full:360}, end:{min:360, full:480}};
/* the shadow clone: a finished week races the same week four weeks earlier on XP, reps and study minutes;
   two wins out of three earn the bonus on that Saturday (same rule and start date as leaf-engine.js) */
export const RIVAL = {from:'2026-11-15', xp:50, back:28};
function raceResult(me, clone){
  if(!me || !clone || me.days !== 7 || clone.days !== 7 || me.ex || clone.ex || me.start < RIVAL.from) return null;
  let wins = 0, losses = 0;
  ['xp', 'repsAll', 'mins'].forEach(k => { const a = me[k] || 0, b = clone[k] || 0; if(a > b) wins++; else if(a < b) losses++; });
  return {win:wins >= 2, wins, losses};
}

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
/* the engine asks for the same few thousand dates over and over, so the conversions are remembered */
const MS = new Map(), YMD = new Map();
export const dayMs = s => { let v = MS.get(s); if(v === undefined){ v = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); if(MS.size > 20000) MS.clear(); MS.set(s, v); } return v; };
export const ymd = msUtc => { let v = YMD.get(msUtc); if(v === undefined){ const d = new Date(msUtc); v = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; if(YMD.size > 20000) YMD.clear(); YMD.set(msUtc, v); } return v; };
export const addDays = (s, n) => ymd(dayMs(s) + n * 86400000);
export const dow = s => (((dayMs(s) / 86400000) % 7) + 11) % 7;      // 1 Jan 1970 was a Thursday
export const weekStart = s => addDays(s, -dow(s));
/* the village date at a real instant, and the real instant a village day starts */
export const dateAt = nowMs => ymd(nowMs + TZ_MS);
export const dayStartMs = s => dayMs(s) - TZ_MS;
export const hourAt = nowMs => new Date(nowMs + TZ_MS).getUTCHours();
export const rankFor = xp => { let i = 0; RANKS.forEach((r, k) => { if(xp >= r.xp) i = k; }); return i; };

/* ---------- schedule ---------- */
const HIST = new WeakMap();
export function sortedHistory(s){
  const list = (s && s.scheduleHistory) || [];
  let c = HIST.get(list);
  if(!c || c.n !== list.length){ c = {n:list.length, h:list.slice().sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0)}; HIST.set(list, c); }
  return c.h;
}
export function entryFor(s, date){ const h = sortedHistory(s); let e = h[0]; for(const x of h){ if(x.from <= date) e = x; } return e; }
/* a one-time swap: two days trade their workout missions for that week only (the weekly plan stays as it is) */
const isYmd = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const swapOf = (s, d) => { for(const x of ((s && Array.isArray(s.swaps)) ? s.swaps : [])){ if(!x || !isYmd(x.a) || !isYmd(x.b) || x.a === x.b) continue; if(x.a === d) return x.b; if(x.b === d) return x.a; } return null; };
export function planFor(s, date){
  const e = entryFor(s, date) || {plan:DEFAULT_PLAN, gtg:{sets:6,minSets:5,pct:50}, test:{sets:2,ex:['pullups','dips']}};
  const p = (e.plan && e.plan[dow(swapOf(s, date) || date)]) || {type:'rest'};
  const plan = Object.assign({}, p, {gtg:e.gtg, test:e.test, combo:Object.assign({sets:3}, e.combo || {})});
  if(plan.type === 'gtg' && !(s.exercises || {})[plan.ex]) return Object.assign(plan, {type:'rest'});
  if(plan.type === 'combo'){ const exs = (plan.exs || []).filter(id => (s.exercises || {})[id]); if(!exs.length) return Object.assign(plan, {type:'rest'}); plan.exs = exs; }
  /* a test day with nothing to test could never be completed: it is a rest day */
  if(plan.type === 'test' && !((e.test && e.test.ex) || []).some(id => (s.exercises || {})[id])) return Object.assign(plan, {type:'rest'});
  return plan;
}
export const gtgTarget = (max, pct) => Math.max(1, Math.round((max || 1) * pct / 100));
export const exName = (s, id) => { const e = ((s && s.exercises) || {})[id]; return e ? e.name : id; };

/* ---------- study ---------- */
const studyPlanOf = e => { const st = (e && e.study) || {}; return {week:Object.assign({}, STUDY_DEFAULT.week, st.week), end:Object.assign({}, STUDY_DEFAULT.end, st.end)}; };
export const studyTarget = (s, d) => { const w = dow(d); if(w === 4) return null; const sp = studyPlanOf(entryFor(s || {}, d)); const t = (w === 5 || w === 6) ? sp.end : sp.week; return {min:t.min, full:t.full}; };
export const examFor = (s, d) => ((s || {}).examWeeks || []).find(e => e && e.start <= d && d <= e.end) || null;
/* an on-call day (marked on the day itself, at most 2 a week) counts like an exam day: what you manage still earns,
   nothing missed costs XP or breaks a streak */
export const onCallDay = (s, d) => !!(s && Array.isArray(s.oncall) && s.oncall.includes(d));
export const isExam = (s, d) => !!examFor(s, d) || onCallDay(s, d);

function splitByDay(a, b){
  const out = []; let st = a;
  while(st < b){ const d = dateAt(st); const e = Math.min(b, dayStartMs(addDays(d, 1))); out.push({date:d, start:st, end:e}); st = e; }
  return out;
}
/* a running study timer counts up to now (or up to its "still studying?" check) */
export function provisionalPieces(timer, nowMs){
  const T = timer || {state:'idle'}; if(T.state !== 'running' || !T.segStart) return [];
  const end = Math.min(nowMs, T.checkAt || Infinity); if(end <= T.segStart) return [];
  /* focus cycles: 50 minutes of work then a 10-minute break, repeating; only the work counts */
  const spans = [];
  if(T.focus){ for(let st = T.segStart, n = 0; st < end && n < 300; st += 3600000, n++) spans.push([st, Math.min(end, st + 3000000)]); }
  else spans.push([T.segStart, end]);
  const out = [];
  spans.forEach(([a, b]) => splitByDay(a, b).forEach(p => out.push({date:p.date, start:p.start, end:p.end, min:(p.end - p.start) / 60000, src:'live'})));
  return out;
}
function hourTimes(segs){
  const out = []; let cum = 0, next = 1;
  segs.slice().sort((a, b) => a.end - b.end).forEach(g => {
    if(g.src === 'manual'){ cum += g.min; while(cum >= next * 60 - 1e-9){ out.push(g.end); next++; } return; }
    while(cum + g.min >= next * 60 - 1e-9){ out.push(g.start + (next * 60 - cum) * 60000); next++; }
    cum += g.min;
  });
  return out;
}
/* ---------- protection scrolls ----------
   From SCROLL_FROM on, a missed day in an area (workout, study, sleep) can be covered by a scroll. The app decides
   which days are covered (it keeps the scroll inventory) and writes the decision into settings.scrolls.used as
   'area|date' -> 'common' | 'rare' | 'forbidden'. A covered day keeps the streak, costs no XP and earns no bonus. */
export const SCROLL_FROM = '2026-11-24';
export const scrollUsed = (s, area, d) => !!(d >= SCROLL_FROM && s && s.scrolls && typeof s.scrolls === 'object' && s.scrolls.used && typeof s.scrolls.used === 'object' && s.scrolls.used[area + '|' + d]);

export function computeStudy(data, today, nowMs, opts){
  const s = data.settings || {}, docs = data.study || {}, o = opts || {}, from = o.resume || null, until = o.until || today;
  const res = {days:{}, list:[], streak:from ? from.study.streak : 0, best:from ? from.study.best : 0, weeks:{}, awards:[], start:s.studyStart || null};
  if(!s.studyStart || s.studyStart > today) return res;
  const live = {}; provisionalPieces(data.timer, nowMs).forEach(p => { (live[p.date] = live[p.date] || []).push(p); });
  const first = from && addDays(from.date, 1) > s.studyStart ? addDays(from.date, 1) : s.studyStart;
  for(let d = first, g = 0; d <= until && g < 4000; d = addDays(d, 1), g++){
    const doc = docs[d] || {}, entries = (doc.entries || []).map(e => ({start:+new Date(e.start || e.end), end:+new Date(e.end), min:+e.min || 0, src:e.src || 'manual'}));
    const segs = entries.concat(live[d] || []);
    const mins = segs.reduce((m, x) => m + x.min, 0), committed = entries.reduce((m, x) => m + x.min, 0);
    const base = studyTarget(s, d), off = !base && dow(d) === 4 && (doc.offday || mins > 0);
    const tgt = off ? {min:0, full:STUDY.offFull, off:true} : base, exam = isExam(s, d), wk = weekStart(d);
    const W = res.weeks[wk] || (res.weeks[wk] = {start:wk, mins:0, shields:0, won:false});
    let xp = Math.floor(mins / 30) * STUDY.halfXp, status;
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
    const rec = {date:d, mins, committed, tgt, exam, status, xp:xp + award, award, hours:hourTimes(segs), shield:!!doc.shield, broke:status === 'missed' && before > 0};
    res.days[d] = rec; res.list.push(rec);
  }
  return res;
}
/* ---------- sleep (same rules as leaf-engine.js) ---------- */
export const SLEEP = {goodXp:20, scoreXp:10, scoreMin:80};
const SLEEP_DEFAULT = {mins:450, bedBy:1200, wakeBy:240};
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clockMin = v => { const m = typeof v === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(v) : null; if(!m) return null; const h = +m[1], mi = +m[2]; return (h < 24 && mi < 60) ? h * 60 + mi : null; };
const inRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
export const sleepGoal = (s, d) => { const e = entryFor(s || {}, d), p = (e && isObj(e.sleep)) ? e.sleep : {};
  return {mins:inRange(p.mins, 240, 720) ? p.mins : SLEEP_DEFAULT.mins, bedBy:inRange(p.bedBy, 0, 1439) ? p.bedBy : SLEEP_DEFAULT.bedBy, wakeBy:inRange(p.wakeBy, 0, 1439) ? p.wakeBy : SLEEP_DEFAULT.wakeBy}; };
const eveClock = m => m < 720 ? m + 1440 : m, mornClock = m => m >= 1080 ? m - 1440 : m;
function sleepNight(doc){
  if(!isObj(doc)) return null;
  const oncall = !!doc.oncall, mins = (typeof doc.mins === 'number' && isFinite(doc.mins) && doc.mins > 0) ? Math.min(Math.round(doc.mins), 1440) : 0;
  const score = (typeof doc.score === 'number' && isFinite(doc.score)) ? Math.max(0, Math.min(100, Math.round(doc.score))) : null;
  return {oncall, mins, score, bed:clockMin(doc.bed), wake:clockMin(doc.wake), logged:!oncall && mins > 0};
}
export function computeSleep(data, today, opts){
  const s = data.settings || {}, docs = isObj(data.sleep) ? data.sleep : {}, o = opts || {}, from = o.resume || null, until = o.until || today;
  const res = {days:{}, list:[], streak:from && from.sleep ? from.sleep.streak : 0, best:from && from.sleep ? from.sleep.best : 0, start:from && from.sleep ? from.sleep.start : null};
  const dates = Object.keys(docs).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && k <= today && sleepNight(docs[k])).sort();
  if(!res.start && dates.length) res.start = dates[0];
  if(!res.start) return res;
  const first = from && addDays(from.date, 1) > res.start ? addDays(from.date, 1) : res.start;
  for(let d = first, g = 0; d <= until && g < 4000; d = addDays(d, 1), g++){
    const n = sleepNight(docs[d]), goal = sleepGoal(s, d), exam = isExam(s, d);
    const checks = n && n.logged ? {hours:n.mins >= goal.mins, bed:n.bed != null && eveClock(n.bed) <= eveClock(goal.bedBy), wake:n.wake != null && mornClock(n.wake) <= mornClock(goal.wakeBy)} : null;
    let status;
    if(n && n.oncall) status = 'oncall';
    else if(checks && checks.hours && checks.bed && checks.wake) status = 'good';
    else if(exam) status = 'exam';
    else if(checks) status = 'short';
    else status = d < today ? 'missed' : 'open';
    if((status === 'short' || status === 'missed') && d < today && scrollUsed(s, 'sleep', d)) status = 'scroll';
    let xp = status === 'good' ? SLEEP.goodXp : 0;
    if(checks && n.score != null && n.score >= SLEEP.scoreMin) xp += SLEEP.scoreXp;
    if(status === 'good'){ res.streak++; res.best = Math.max(res.best, res.streak); }
    else if(status === 'short' || status === 'missed') res.streak = 0;
    const rec = {date:d, mins:n ? n.mins : 0, score:n ? n.score : null, oncall:!!(n && n.oncall), logged:!!(n && n.logged), goal, checks, status, xp, streak:res.streak};
    res.days[d] = rec; res.list.push(rec);
  }
  return res;
}

function comboMatches(hours, sets){
  const ts = sets.map(x => +new Date(x.t)).filter(n => !isNaN(n)).sort((a, b) => a - b), used = new Set(); let n = 0;
  hours.forEach(h => { const i = ts.findIndex((t, k) => !used.has(k) && t >= h && t <= h + STUDY.comboWindow); if(i >= 0){ used.add(i); n++; } });
  return {n};
}

/* ---------- the engine ---------- */
/* ---------- weighted sets ----------
   A set can carry added weight (x.kg, a belt or a backpack). Old sets have none and count as bodyweight.
   Maxes are kept per weight, so a weighted set is never compared with a bodyweight one. The weight you train
   with (the "working weight") is the weight of your latest test; the bodyweight test on the first Friday of a
   month does not change it. Weighted reps earn XP in proportion to the total load: reps x (body + added) / body. */
export const LOAD = {bw:69, cap:200, step:2.5, upAt:12, e1Reps:12};
export const kgOf = x => (x && Number.isFinite(+x.kg) && +x.kg > 0) ? Math.min(LOAD.cap, Math.round(+x.kg * 4) / 4) : 0;
export const bwAt = (list, d) => { let w = null; for(const b of list){ if(b.date <= d) w = b.weight; else break; } return w || (list[0] && list[0].weight) || LOAD.bw; };
export const e1rm = (bw, kg, reps) => (bw + kg) * (1 + reps / 30);
const loadXp = (bw, kg, reps) => kg > 0 ? Math.round(reps * (bw + kg) / bw) : reps;
const monthBwTest = d => +d.slice(8, 10) <= 7;
/* does a set at weight kg count as a groove set when the target is `target` reps at the working weight? */
export const meets = (bw, x, load, target) => { const kg = kgOf(x); return kg === load ? x.reps >= target : e1rm(bw, kg, x.reps) >= e1rm(bw, load, target) - 1e-9; };

/* opts.resume: a checkpoint (the `state` an earlier run returned) to continue from instead of starting at day one.
   opts.until: the last day to process (default: today). A checkpoint must fall on a Saturday, so that weekly
   counters start clean, and far enough back that every day up to it is final. */
export function computeAll(data, nowMs, opts){
  const s = data.settings || {}, today = dateAt(nowMs), o = opts || {}, from = o.resume || null, until = o.until || today;
  const dayDocs = data.days || {};
  const exIds = Object.keys(s.exercises || {});
  const maxes = {}, best = {}, totalReps = {};
  exIds.forEach(id => { const b = (s.baseline || {})[id] || {max:0, date:s.startDate}; maxes[id] = b.max; best[id] = b.max; totalReps[id] = 0; });
  const load = {}, wmax = {}, wbest = {};
  exIds.forEach(id => { load[id] = 0; wmax[id] = {}; wbest[id] = {}; });
  if(from){ Object.assign(maxes, from.maxes); Object.assign(best, from.best); Object.assign(totalReps, from.totalReps); if(from.load) Object.assign(load, from.load); if(from.wmax) Object.keys(from.wmax).forEach(k => { wmax[k] = Object.assign({}, from.wmax[k]); }); if(from.wbest) Object.keys(from.wbest).forEach(k => { wbest[k] = Object.assign({}, from.wbest[k]); }); }
  const days = [], prs = [], weeks = {}, awards = [];
  /* the four weeks before a checkpoint are carried along, so the shadow clone still has someone to race */
  if(from && Array.isArray(from.tail)) from.tail.forEach(w => { weeks[w.start] = {start:w.start, reps:{}, missed:0, days:w.days, done:0, qual:0, weigh:0, prDone:false, open:false, xp:w.xp, prs:[], repsAll:w.repsAll, mins:w.mins, ex:w.ex, past:true}; });
  const bodyList = Object.values(data.body || {}).filter(b => b && typeof b.weight === 'number').sort((a, b) => a.date < b.date ? -1 : 1);
  const bodyDates = new Set(bodyList.map(b => b.date));
  let total = 0, peak = 0, streak = 0, bestStreak = 0, doneCount = 0, missedCount = 0, last = from ? from.date : null;
  if(from){ total = from.total; peak = from.peak; streak = from.streak; bestStreak = from.bestStreak; doneCount = from.doneCount; missedCount = from.missedCount; }
  const study = computeStudy(data, today, nowMs, o), sleep = computeSleep(data, today, o);
  if(s.startDate && s.startDate <= today){
    let guard = 0;
    for(let d = from ? addDays(from.date, 1) : s.startDate; d <= until && guard < 4000; d = addDays(d, 1), guard++){
      last = d;
      const plan = planFor(s, d);
      const sets = ((dayDocs[d] || {}).sets) || [];
      const bw = bwAt(bodyList, d), lx = x => loadXp(bw, kgOf(x), x.reps);
      const wk = weekStart(d);
      const W = weeks[wk] || (weeks[wk] = {start:wk, reps:{}, missed:0, days:0, done:0, qual:0, weigh:0, prDone:false, open:false, xp:0, prs:[], repsAll:0, mins:0});
      sets.forEach(x => { totalReps[x.ex] = (totalReps[x.ex] || 0) + x.reps; W.reps[x.ex] = (W.reps[x.ex] || 0) + lx(x); W.repsAll += lx(x); });
      let base = 0, complete = false, info = {};
      if(plan.type === 'gtg'){
        const ex = plan.ex, g = plan.gtg, kg = load[ex] || 0, target = gtgTarget(kg ? wmax[ex][kg] : maxes[ex], g.pct);
        const exSets = sets.filter(x => x.ex === ex).slice(0, Math.max(10, g.sets));
        let q = 0;
        exSets.forEach(x => { if(meets(bw, x, kg, target)){ q++; base += XP.gtgSet + lx(x); } else base += lx(x); });
        complete = q >= g.minSets;
        if(complete) base += XP.gtgComplete;
        if(q >= g.sets) base += XP.gtgFull;
        info = {ex, target, kg, q, need:g.minSets, goal:g.sets, logged:exSets.length};
      } else if(plan.type === 'combo'){
        const g = plan.gtg, per = plan.combo.sets;
        const parts = plan.exs.map(ex => {
          const kg = load[ex] || 0, target = gtgTarget(kg ? wmax[ex][kg] : maxes[ex], g.pct), exSets = sets.filter(x => x.ex === ex).slice(0, Math.max(10, per));
          let q = 0;
          exSets.forEach(x => { if(meets(bw, x, kg, target)){ q++; base += XP.gtgSet + lx(x); } else base += lx(x); });
          return {ex, target, kg, q, need:per, logged:exSets.length};
        });
        complete = parts.every(pt => pt.q >= per);
        if(complete) base += XP.gtgComplete + XP.gtgFull;
        info = {parts, q:parts.reduce((m, pt) => m + Math.min(pt.q, per), 0), qAll:parts.reduce((m, pt) => m + pt.q, 0), need:per * parts.length, goal:per * parts.length};
      } else if(plan.type === 'test'){
        const t = plan.test;
        const tex = (t.ex || []).filter(id => (s.exercises || {})[id]);
        const per = tex.map(id => { const xs = sets.filter(x => x.ex === id).slice(0, t.sets), kg = xs.reduce((m, x) => Math.max(m, kgOf(x)), 0), at = xs.filter(x => kgOf(x) === kg), top = at.reduce((m, x) => Math.max(m, x.reps), 0);
          /* the other weights tried that day (a bodyweight check next to a weighted set) keep their own records */
          const others = {}; xs.forEach(x => { const k = kgOf(x); if(k !== kg) others[k] = Math.max(others[k] || 0, x.reps); });
          return {ex:id, sets:xs, kg, top, others, prev:kg ? (wmax[id][kg] != null ? wmax[id][kg] : null) : maxes[id], prBefore:kg ? (wbest[id][kg] || 0) : best[id], pr:false, load:load[id] || 0}; });
        per.forEach(p => p.sets.forEach(x => { base += XP.testRep * lx(x); }));
        complete = per.length > 0 && per.every(p => p.sets.length >= t.sets);
        if(complete) base += XP.testComplete;
        per.forEach(p => {
          if(!p.sets.length) return;
          const mark = (kg, v) => { const b = kg ? (wbest[p.ex][kg] || 0) : best[p.ex]; if(v > b){ const rec = kg ? {date:d, ex:p.ex, v, kg, from:b} : {date:d, ex:p.ex, v}; prs.push(rec); W.prs.push(rec); if(kg) wbest[p.ex][kg] = v; else best[p.ex] = v; return true; } return false; };
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
      if(status === 'done' || status === 'rest'){ streak++; bestStreak = Math.max(bestStreak, streak); xp = Math.round(base * mult(streak)); if(status === 'done'){ doneCount++; W.done++; } }
      else if(status === 'scroll') xp = 0;
      else if(status === 'missed'){ streak = 0; xp = base - (plan.type === 'test' ? XP.missTest : XP.missGtg); missedCount++; W.missed++; }
      else xp = base;
      W.days++;
      if(plan.type === 'test' && (status === 'done' || status === 'missed')){
        info.per.forEach(p => { if(!p.sets.length) return;
          const put = (kg, v) => { if(kg) wmax[p.ex][kg] = v; else maxes[p.ex] = v; };
          put(p.kg, p.top); Object.keys(p.others).forEach(k => put(+k, p.others[k]));
          if(p.kg > 0) load[p.ex] = p.kg; else if(!(load[p.ex] > 0 && monthBwTest(d))) load[p.ex] = 0; });
      }
      const bonus = [];
      if(plan.type === 'gtg' || plan.type === 'combo'){ const before = W.qual; W.qual += (plan.type === 'combo' ? info.qAll : info.q) || 0; if(before < CHALLENGES.kakashi.goal && W.qual >= CHALLENGES.kakashi.goal) bonus.push('kakashi'); }
      if(plan.type === 'test' && !W.prDone && info.per && info.per.some(p => p.pr)){ W.prDone = true; bonus.push('guy'); }
      if(bodyDates.has(d)){ W.weigh++; if(W.weigh === CHALLENGES.jiraiya.goal) bonus.push('jiraiya'); }
      W.open = status === 'open';
      if(status === 'exam') W.exam = (W.exam || 0) + 1;
      if(isExam(s, d)) W.ex = (W.ex || 0) + 1;
      if(dow(d) === 6 && W.days === 7 && W.missed === 0 && status !== 'open') bonus.push('hiruzen');
      bonus.forEach(id => { xp += CHALLENGES[id].xp; awards.push({key:id, sensei:id, date:d, week:wk, xp:CHALLENGES[id].xp, title:CHALLENGES[id].title}); });
      const srec = study.days[d];
      const cm = comboMatches(srec ? srec.hours : [], sets); info.combo = cm.n; xp += cm.n * STUDY.combo;
      const before = total;
      if(srec){ total = Math.max(0, total + srec.xp); if(srec.award) awards.push(study.awards.find(a => a.date === d)); }
      total = Math.max(0, total + xp);
      const slr = sleep.days[d];
      W.xp += total - before; if(srec) W.mins += srec.mins;
      if(slr) total += slr.xp;
      if(dow(d) === 6 && d < today){ W.rival = raceResult(W, weeks[addDays(wk, -RIVAL.back)]); if(W.rival && W.rival.win){ xp += RIVAL.xp; total += RIVAL.xp; } }
      peak = Math.max(peak, rankFor(total));
      days.push({date:d, plan, sets, status, xp, base, info, streak, bonus});
    }
  }
  const todayRec = days.length && days[days.length - 1].date === today ? days[days.length - 1] : null;
  const weekNow = weeks[weekStart(today)] || {qual:0, weigh:0, prDone:false, days:0, missed:0};
  const r = RANKS[peak], nx = RANKS[peak + 1];
  /* everything needed to carry on from the last processed day */
  const tail = last ? Object.keys(weeks).filter(k => k <= last).sort().slice(-4).map(k => { const w = weeks[k]; return {start:w.start, days:w.days, xp:w.xp, repsAll:w.repsAll, mins:w.mins, ex:w.ex || 0}; }) : [];
  const state = last ? {date:last, total, peak, streak, bestStreak, doneCount, missedCount, maxes:Object.assign({}, maxes), best:Object.assign({}, best), totalReps:Object.assign({}, totalReps), load:Object.assign({}, load), wmax:JSON.parse(JSON.stringify(wmax)), wbest:JSON.parse(JSON.stringify(wbest)), study:{streak:study.streak, best:study.best}, sleep:{streak:sleep.streak, best:sleep.best, start:sleep.start}, tail} : null;
  return { today, settings:s, study, sleep, awards, weekNow, weeks, todayRec, days, state, total, peak, rankNow:rankFor(total), streak, bestStreak, doneCount, missedCount,
    maxes, best, prs, totalReps, exIds, body:bodyList, bodyDates,
    rank:r.name, nextRank:nx ? nx.name : null, xpToNext:nx ? Math.max(0, nx.xp - total) : null };
}

/* turn a flat {path: data} map (what the database holds) into the snapshot the engine reads */
export function snapshotFromDocs(map){
  const out = {settings:null, days:{}, study:{}, body:{}, sleep:{}, timer:null, summary:null};
  Object.keys(map).forEach(path => {
    const v = map[path]; if(!v || typeof v !== 'object') return;
    if(path === 'leaf/main') out.settings = v;
    else if(path === 'leaf/timer') out.timer = v;
    else if(path === 'leaf/summary') out.summary = v;
    else if(path.startsWith('leaf/main/days/')) out.days[path.slice(15)] = v;
    else if(path.startsWith('leaf/main/study/')) out.study[path.slice(16)] = v;
    else if(path.startsWith('leaf/main/body/')) out.body[path.slice(15)] = v;
    else if(path.startsWith('leaf/main/sleep/')) out.sleep[path.slice(16)] = v;
  });
  return out;
}

/* ---------- checkpoints: keep the Worker's work small however long the history grows ---------- */
/* the Saturday at least `back` days before today: everything up to it is settled history */
export function checkpointTarget(today, back){ const d = addDays(today, -(back || 15)); return addDays(d, -((dow(d) + 1) % 7)); }
/* a fingerprint of the settings that shape history; if it changes, old checkpoints no longer apply */
export function historyKey(s){
  const t = JSON.stringify([s.startDate || null, s.studyStart || null, s.exercises || null, s.baseline || null, s.scheduleHistory || null, s.examWeeks || null, s.swaps || null, s.scrolls || null, s.oncall || null]);
  let h = 2166136261; for(let i = 0; i < t.length; i++){ h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${t.length}.${h >>> 0}`;
}
/* move a checkpoint forward to `to` (a Saturday), at most `maxDays` at a time; returns the new state, or null if there is nothing to do yet */
export function advanceCheckpoint(data, nowMs, resume, to, maxDays){
  const s = data.settings || {}; if(!s.startDate || s.startDate > to) return null;
  const start = resume ? addDays(resume.date, 1) : s.startDate; if(start > to) return resume;
  let until = to;
  if(maxDays && (dayMs(to) - dayMs(start)) / 86400000 >= maxDays){ const lim = addDays(start, maxDays - 1); until = addDays(lim, -((dow(lim) + 1) % 7)); if(until < start) until = addDays(until, 7); if(until > to) until = to; }
  return computeAll(data, nowMs, {resume, until}).state;
}
