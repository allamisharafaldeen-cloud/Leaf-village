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
  let h = HIST.get(list);
  if(!h){ h = list.filter(isObj).sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0); HIST.set(list, h); }
  return h;
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
function planFor(s, date){
  const e = normEntry(entryFor(s, date)), ex = (s && s.exercises) || {};
  const p = e.plan[dowOf(date)], rest = () => ({type:'rest', gtg:e.gtg, test:e.test, combo:e.combo});
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
const isExam = (s, d) => !!examFor(s, d);

/* split a time span into per-day pieces (local midnight boundaries) */
function splitByDay(a, b){
  const out = []; let st = a;
  while(st < b && out.length < 400){ const d = dateAt(st); const e = Math.min(b, dayStartMs(addDays(d, 1))); out.push({date:d, start:st, end:e}); st = e; }
  return out;
}
/* a running study timer counts up to now, or up to its "still studying?" check if that came first */
function provisionalPieces(timer, now){
  const T = timer || {state:'idle'};
  if(T.state !== 'running' || !(typeof T.segStart === 'number' && T.segStart > 0)) return [];
  const end = Math.min(now, T.checkAt || Infinity); if(!(end > T.segStart)) return [];
  return splitByDay(T.segStart, end).map(p => ({date:p.date, start:p.start, end:p.end, min:(p.end - p.start)/60000, src:'live'}));
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
    else if(doc.shield && W.shields < 1){ status = 'shield'; W.shields++; }
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

function compute(data, nowMs){
  const now = nowMs == null ? Date.now() : nowMs, today = dateAt(now);
  const s = data.settings || {}, dayDocs = data.days || {}, exs = isObj(s.exercises) ? s.exercises : {};
  const exIds = Object.keys(exs);
  const maxes = {}, best = {}, maxHist = {}, totalReps = {};
  exIds.forEach(id => { const b0 = (s.baseline || {})[id], b = {max:posNum(b0 && b0.max, 0), date:(b0 && isDate(b0.date)) ? b0.date : s.startDate}; maxes[id] = b.max; best[id] = b.max; maxHist[id] = [{date:b.date, v:b.max, start:true}]; totalReps[id] = 0; });
  const days = [], prs = [], weeks = {}, awards = [];
  const body = bodyList(data), bodyDates = new Set(body.map(b => b.date));
  let total = 0, peak = 0, streak = 0, bestStreak = 0, doneCount = 0, missedCount = 0;
  const study = computeStudy(data, today, now); let readyUntil = 0;
  if(isDate(s.startDate) && s.startDate <= today){
    let guard = 0;
    for(let d = s.startDate; d <= today && guard < 4000; d = addDays(d, 1), guard++){
      const plan = planFor(s, d);
      const sets = setsOf(dayDocs[d]);
      const wk = weekStart(d);
      const W = weeks[wk] || (weeks[wk] = {start:wk, reps:{}, missed:0, days:0, done:0, qual:0, weigh:0, prDone:false, open:false});
      sets.forEach(x => { totalReps[x.ex] = (totalReps[x.ex] || 0) + x.reps; W.reps[x.ex] = (W.reps[x.ex] || 0) + x.reps; });
      let base = 0, complete = false, info = {};
      if(plan.type === 'gtg'){
        const ex = plan.ex, g = plan.gtg, target = gtgTarget(maxes[ex], g.pct);
        const exSets = sets.filter(x => x.ex === ex).slice(0, Math.max(SET_CAP, g.sets));
        let q = 0;
        exSets.forEach(x => { if(x.reps >= target){ q++; base += XP.gtgSet + x.reps; } else base += x.reps; });
        complete = q >= g.minSets;
        if(complete) base += XP.gtgComplete;
        if(q >= g.sets) base += XP.gtgFull;
        info = {ex, target, q, need:g.minSets, goal:g.sets, logged:exSets.length, exSets};
      } else if(plan.type === 'combo'){
        const g = plan.gtg, per = plan.combo.sets;
        const parts = plan.exs.map(ex => {
          const target = gtgTarget(maxes[ex], g.pct), exSets = sets.filter(x => x.ex === ex).slice(0, Math.max(SET_CAP, per));
          let q = 0;
          exSets.forEach(x => { if(x.reps >= target){ q++; base += XP.gtgSet + x.reps; } else base += x.reps; });
          return {ex, target, q, need:per, logged:exSets.length, exSets};
        });
        complete = parts.every(pt => pt.q >= per);
        if(complete) base += XP.gtgComplete + XP.gtgFull;
        info = {parts, q:parts.reduce((m, pt) => m + Math.min(pt.q, per), 0), qAll:parts.reduce((m, pt) => m + pt.q, 0), need:per*parts.length, goal:per*parts.length};
      } else if(plan.type === 'test'){
        const t = plan.test;
        const tex = t.ex.filter(id => exs[id]);
        const per = tex.map(id => { const xs = sets.filter(x => x.ex === id).slice(0, t.sets); return {ex:id, sets:xs, top:xs.reduce((m, x) => Math.max(m, x.reps), 0), prev:maxes[id], prBefore:best[id], pr:false}; });
        per.forEach(p => p.sets.forEach(x => { base += XP.testRep*x.reps; }));
        complete = per.length > 0 && per.every(p => p.sets.length >= t.sets);
        if(complete) base += XP.testComplete;
        per.forEach(p => { if(p.sets.length && p.top > best[p.ex]){ p.pr = true; base += XP.pr; prs.push({date:d, ex:p.ex, v:p.top, from:best[p.ex]}); best[p.ex] = p.top; } });
        info = {per, sets:t.sets};
      }
      let status;
      if(plan.type === 'rest'){ status = 'rest'; base = XP.rest; }
      else if(complete) status = 'done';
      else status = d < today ? 'missed' : 'open';
      if(isExam(s, d) && status !== 'done'){ status = 'exam'; if(plan.type === 'rest') base = 0; }
      let xp;
      if(status === 'done' || status === 'rest'){ streak++; bestStreak = Math.max(bestStreak, streak); xp = Math.round(base*mult(streak)); if(status === 'done'){ doneCount++; W.done++; } }
      else if(status === 'missed'){ streak = 0; xp = base - (plan.type === 'test' ? XP.missTest : XP.missGtg); missedCount++; W.missed++; }
      else xp = base;
      W.days++;
      if(plan.type === 'test' && (status === 'done' || status === 'missed')){
        info.per.forEach(p => { if(p.sets.length){ maxes[p.ex] = p.top; maxHist[p.ex].push({date:d, v:p.top}); } });
      }
      const bonus = [];
      if(plan.type === 'gtg' || plan.type === 'combo'){ const before = W.qual; W.qual += (plan.type === 'combo' ? info.qAll : info.q) || 0; if(before < CHALLENGES.kakashi.goal && W.qual >= CHALLENGES.kakashi.goal) bonus.push('kakashi'); }
      if(plan.type === 'test' && !W.prDone && info.per && info.per.some(p => p.pr)){ W.prDone = true; bonus.push('guy'); }
      if(bodyDates.has(d)){ W.weigh++; if(W.weigh === CHALLENGES.jiraiya.goal) bonus.push('jiraiya'); }
      W.open = status === 'open';
      if(status === 'exam') W.exam = (W.exam || 0) + 1;
      if(dowOf(d) === 6 && W.days === 7 && W.missed === 0 && status !== 'open') bonus.push('hiruzen');
      bonus.forEach(id => { xp += CHALLENGES[id].xp; awards.push({key:id, sensei:id, date:d, week:wk, xp:CHALLENGES[id].xp, title:CHALLENGES[id].title}); });
      const srec = study.days[d];
      const cm = comboMatches(srec ? srec.hours : [], sets); info.combo = cm.n; xp += cm.n*STUDY.combo;
      if(d === today && plan.type !== 'rest'){ cm.free.forEach(h => { if(now >= h && now <= h + STUDY.comboWindow) readyUntil = Math.max(readyUntil, h + STUDY.comboWindow); }); }
      const beforeTotal = total;
      if(srec){ total = Math.max(0, total + srec.xp); if(srec.award) awards.push(study.awards.find(a => a.date === d)); }
      total = Math.max(0, total + xp);
      peak = Math.max(peak, rankFor(total));
      days.push({date:d, plan, sets, status, xp, base, info, streak, bonus, sxp:srec ? srec.xp : 0, gain:total - beforeTotal, total, peak, maxes:plan.type === 'test' ? Object.assign({}, maxes) : null});
    }
  }
  const todayRec = days.length && days[days.length-1].date === today ? days[days.length-1] : null;
  const weekList = Object.values(weeks).sort((a, b) => a.start < b.start ? -1 : 1);
  const cleanWeeks = weekList.filter(w => w.days === 7 && w.missed === 0 && w.done > 0 && addDays(w.start, 6) < today).length;
  const weight = body.length ? body[body.length-1].weight : null;
  const power = weight ? Math.round(((maxes.pullups || 0)*3 + (maxes.dips || 0))*weight/10) : null;
  const weekNow = weeks[weekStart(today)] || {qual:0, weigh:0, prDone:false, days:0, missed:0};
  const startedMidWeek = weekStart(s.startDate || today) === weekStart(today) && dowOf(s.startDate || today) !== 0;
  return { settings:s, now, study, readyUntil, awards, weekNow, weeks, startedMidWeek, today, todayRec, days, total, peak, rankNow:rankFor(total), streak, bestStreak, doneCount, missedCount, maxes, best, maxHist, prs, totalReps, weekList, cleanWeeks, body, weight, power, exIds };
}

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
  if(s.celebrated !== undefined && !(typeof s.celebrated === 'number' && isFinite(s.celebrated) && s.celebrated >= 0)){ s.celebrated = 0; delete s.celebratedId; fixed++; }
  if(s.themeRank !== undefined && !(Number.isInteger(s.themeRank) && s.themeRank >= 0 && s.themeRank < RANKS.length)){ delete s.themeRank; delete s.themeRankId; fixed++; }
  if(typeof s.name !== 'string'){ s.name = 'Ninja'; fixed++; }
  if(s.notify !== undefined && !isObj(s.notify)){ delete s.notify; fixed++; }

  const coll = (src, fn) => { const out = {}; if(!isObj(src)){ if(src != null) fixed++; return out; } Object.keys(src).forEach(k => { if(!isDate(k) || !isObj(src[k])){ fixed++; return; } const v = fn(k, src[k]); if(v) out[k] = v; else fixed++; }); return out; };
  const days = coll(d.days, (k, doc) => {
    const list = Array.isArray(doc.sets) ? doc.sets : [];
    const okS = x => okSet(x) && x.reps >= 0 && x.reps <= 999 && okTime(x.t);
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
  const body = coll(d.body, (k, doc) => (typeof doc.weight === 'number' && isFinite(doc.weight) && doc.weight >= 20 && doc.weight <= 500) ? (doc.date === k ? doc : Object.assign({}, doc, {date:k})) : null);
  let timer = d.timer;
  if(timer != null){
    const now = nowMs == null ? Date.now() : nowMs;
    const okRun = isObj(timer) && timer.state === 'running' && typeof timer.segStart === 'number' && timer.segStart <= now + 60000 && timer.segStart > now - 2*86400000 && (timer.checkAt == null || typeof timer.checkAt === 'number');
    const okIdle = isObj(timer) && (timer.state === 'idle' || (timer.state === 'paused' && (timer.sessionMs == null || (typeof timer.sessionMs === 'number' && timer.sessionMs >= 0))));
    if(!okRun && !okIdle){ timer = {state:'idle'}; if(!(isObj(d.timer) && d.timer.state === 'running')) fixed++; }
  }
  const out = Object.assign({}, d, {settings:s, days, study, body, timer});
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
  const R = {ym, label:monthLabel(ym), from, to, complete:end < C.today, name:s.name || 'Ninja', study, reps, maxes, prs, missions, xp, bestStreak, rankFrom, rankTo, promoted:rankTo > rankFrom,
    awards:awards.length, earned, comeback, exam, weight:body.length ? {from:body[0].weight, to:body[body.length-1].weight, n:body.length} : null, totalAfter:lastDay ? lastDay.total : 0};
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

return {
  RANKS, XP, TIERS, mult, nextTier, DEFAULT_PLAN, DEFAULT_GTG, DEFAULT_TEST, CHALLENGES, STUDY, STUDY_DEFAULT, SET_CAP,
  pad, ymd, parse, isDate, addDays, dowOf, dnum, daysBetween, weekStart, dateAt, dayStartMs, rankFor,
  sortedHistory, entryFor, normEntry, planFor, gtgTarget, studyPlanOf, studyTarget, examFor, isExam,
  splitByDay, provisionalPieces, hourTimes, computeStudy, comboMatches, compute, streakStory, cleanBackup,
  ACHIEVEMENTS, achievements, monthsOf, monthEnd, monthLabel, monthReport, chapterTitle, hokageSummary, chapters, hoursText
};
});
