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
  let h = HIST.get(list);
  if(!h){ h = list.slice().sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0); HIST.set(list, h); }
  return h;
}
export function entryFor(s, date){ const h = sortedHistory(s); let e = h[0]; for(const x of h){ if(x.from <= date) e = x; } return e; }
export function planFor(s, date){
  const e = entryFor(s, date) || {plan:DEFAULT_PLAN, gtg:{sets:6,minSets:5,pct:50}, test:{sets:2,ex:['pullups','dips']}};
  const p = (e.plan && e.plan[dow(date)]) || {type:'rest'};
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
export const isExam = (s, d) => !!examFor(s, d);

function splitByDay(a, b){
  const out = []; let st = a;
  while(st < b){ const d = dateAt(st); const e = Math.min(b, dayStartMs(addDays(d, 1))); out.push({date:d, start:st, end:e}); st = e; }
  return out;
}
/* a running study timer counts up to now (or up to its "still studying?" check) */
export function provisionalPieces(timer, nowMs){
  const T = timer || {state:'idle'}; if(T.state !== 'running' || !T.segStart) return [];
  const end = Math.min(nowMs, T.checkAt || Infinity); if(end <= T.segStart) return [];
  return splitByDay(T.segStart, end).map(p => ({date:p.date, start:p.start, end:p.end, min:(p.end - p.start) / 60000, src:'live'}));
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
    else if(doc.shield && W.shields < 1){ status = 'shield'; W.shields++; }
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
function comboMatches(hours, sets){
  const ts = sets.map(x => +new Date(x.t)).filter(n => !isNaN(n)).sort((a, b) => a - b), used = new Set(); let n = 0;
  hours.forEach(h => { const i = ts.findIndex((t, k) => !used.has(k) && t >= h && t <= h + STUDY.comboWindow); if(i >= 0){ used.add(i); n++; } });
  return {n};
}

/* ---------- the engine ---------- */
/* opts.resume: a checkpoint (the `state` an earlier run returned) to continue from instead of starting at day one.
   opts.until: the last day to process (default: today). A checkpoint must fall on a Saturday, so that weekly
   counters start clean, and far enough back that every day up to it is final. */
export function computeAll(data, nowMs, opts){
  const s = data.settings || {}, today = dateAt(nowMs), o = opts || {}, from = o.resume || null, until = o.until || today;
  const dayDocs = data.days || {};
  const exIds = Object.keys(s.exercises || {});
  const maxes = {}, best = {}, totalReps = {};
  exIds.forEach(id => { const b = (s.baseline || {})[id] || {max:0, date:s.startDate}; maxes[id] = b.max; best[id] = b.max; totalReps[id] = 0; });
  if(from){ Object.assign(maxes, from.maxes); Object.assign(best, from.best); Object.assign(totalReps, from.totalReps); }
  const days = [], prs = [], weeks = {}, awards = [];
  const bodyList = Object.values(data.body || {}).filter(b => b && typeof b.weight === 'number').sort((a, b) => a.date < b.date ? -1 : 1);
  const bodyDates = new Set(bodyList.map(b => b.date));
  let total = 0, peak = 0, streak = 0, bestStreak = 0, doneCount = 0, missedCount = 0, last = from ? from.date : null;
  if(from){ total = from.total; peak = from.peak; streak = from.streak; bestStreak = from.bestStreak; doneCount = from.doneCount; missedCount = from.missedCount; }
  const study = computeStudy(data, today, nowMs, o);
  if(s.startDate && s.startDate <= today){
    let guard = 0;
    for(let d = from ? addDays(from.date, 1) : s.startDate; d <= until && guard < 4000; d = addDays(d, 1), guard++){
      last = d;
      const plan = planFor(s, d);
      const sets = ((dayDocs[d] || {}).sets) || [];
      const wk = weekStart(d);
      const W = weeks[wk] || (weeks[wk] = {start:wk, reps:{}, missed:0, days:0, done:0, qual:0, weigh:0, prDone:false, open:false, xp:0, prs:[]});
      sets.forEach(x => { totalReps[x.ex] = (totalReps[x.ex] || 0) + x.reps; W.reps[x.ex] = (W.reps[x.ex] || 0) + x.reps; });
      let base = 0, complete = false, info = {};
      if(plan.type === 'gtg'){
        const ex = plan.ex, g = plan.gtg, target = gtgTarget(maxes[ex], g.pct);
        const exSets = sets.filter(x => x.ex === ex).slice(0, Math.max(10, g.sets));
        let q = 0;
        exSets.forEach(x => { if(x.reps >= target){ q++; base += XP.gtgSet + x.reps; } else base += x.reps; });
        complete = q >= g.minSets;
        if(complete) base += XP.gtgComplete;
        if(q >= g.sets) base += XP.gtgFull;
        info = {ex, target, q, need:g.minSets, goal:g.sets, logged:exSets.length};
      } else if(plan.type === 'combo'){
        const g = plan.gtg, per = plan.combo.sets;
        const parts = plan.exs.map(ex => {
          const target = gtgTarget(maxes[ex], g.pct), exSets = sets.filter(x => x.ex === ex).slice(0, Math.max(10, per));
          let q = 0;
          exSets.forEach(x => { if(x.reps >= target){ q++; base += XP.gtgSet + x.reps; } else base += x.reps; });
          return {ex, target, q, need:per, logged:exSets.length};
        });
        complete = parts.every(pt => pt.q >= per);
        if(complete) base += XP.gtgComplete + XP.gtgFull;
        info = {parts, q:parts.reduce((m, pt) => m + Math.min(pt.q, per), 0), qAll:parts.reduce((m, pt) => m + pt.q, 0), need:per * parts.length, goal:per * parts.length};
      } else if(plan.type === 'test'){
        const t = plan.test;
        const tex = (t.ex || []).filter(id => (s.exercises || {})[id]);
        const per = tex.map(id => { const xs = sets.filter(x => x.ex === id).slice(0, t.sets); return {ex:id, sets:xs, top:xs.reduce((m, x) => Math.max(m, x.reps), 0), prev:maxes[id], prBefore:best[id], pr:false}; });
        per.forEach(p => p.sets.forEach(x => { base += XP.testRep * x.reps; }));
        complete = per.length > 0 && per.every(p => p.sets.length >= t.sets);
        if(complete) base += XP.testComplete;
        per.forEach(p => { if(p.sets.length && p.top > best[p.ex]){ p.pr = true; base += XP.pr; const rec = {date:d, ex:p.ex, v:p.top}; prs.push(rec); W.prs.push(rec); best[p.ex] = p.top; } });
        info = {per, sets:t.sets};
      }
      let status;
      if(plan.type === 'rest'){ status = 'rest'; base = XP.rest; }
      else if(complete) status = 'done';
      else status = d < today ? 'missed' : 'open';
      if(isExam(s, d) && status !== 'done'){ status = 'exam'; if(plan.type === 'rest') base = 0; }
      let xp;
      if(status === 'done' || status === 'rest'){ streak++; bestStreak = Math.max(bestStreak, streak); xp = Math.round(base * mult(streak)); if(status === 'done'){ doneCount++; W.done++; } }
      else if(status === 'missed'){ streak = 0; xp = base - (plan.type === 'test' ? XP.missTest : XP.missGtg); missedCount++; W.missed++; }
      else xp = base;
      W.days++;
      if(plan.type === 'test' && (status === 'done' || status === 'missed')){
        info.per.forEach(p => { if(p.sets.length){ maxes[p.ex] = p.top; } });
      }
      const bonus = [];
      if(plan.type === 'gtg' || plan.type === 'combo'){ const before = W.qual; W.qual += (plan.type === 'combo' ? info.qAll : info.q) || 0; if(before < CHALLENGES.kakashi.goal && W.qual >= CHALLENGES.kakashi.goal) bonus.push('kakashi'); }
      if(plan.type === 'test' && !W.prDone && info.per && info.per.some(p => p.pr)){ W.prDone = true; bonus.push('guy'); }
      if(bodyDates.has(d)){ W.weigh++; if(W.weigh === CHALLENGES.jiraiya.goal) bonus.push('jiraiya'); }
      W.open = status === 'open';
      if(status === 'exam') W.exam = (W.exam || 0) + 1;
      if(dow(d) === 6 && W.days === 7 && W.missed === 0 && status !== 'open') bonus.push('hiruzen');
      bonus.forEach(id => { xp += CHALLENGES[id].xp; awards.push({key:id, sensei:id, date:d, week:wk, xp:CHALLENGES[id].xp, title:CHALLENGES[id].title}); });
      const srec = study.days[d];
      const cm = comboMatches(srec ? srec.hours : [], sets); info.combo = cm.n; xp += cm.n * STUDY.combo;
      const before = total;
      if(srec){ total = Math.max(0, total + srec.xp); if(srec.award) awards.push(study.awards.find(a => a.date === d)); }
      total = Math.max(0, total + xp);
      W.xp += total - before;
      peak = Math.max(peak, rankFor(total));
      days.push({date:d, plan, sets, status, xp, base, info, streak, bonus});
    }
  }
  const todayRec = days.length && days[days.length - 1].date === today ? days[days.length - 1] : null;
  const weekNow = weeks[weekStart(today)] || {qual:0, weigh:0, prDone:false, days:0, missed:0};
  const r = RANKS[peak], nx = RANKS[peak + 1];
  /* everything needed to carry on from the last processed day */
  const state = last ? {date:last, total, peak, streak, bestStreak, doneCount, missedCount, maxes:Object.assign({}, maxes), best:Object.assign({}, best), totalReps:Object.assign({}, totalReps), study:{streak:study.streak, best:study.best}} : null;
  return { today, settings:s, study, awards, weekNow, weeks, todayRec, days, state, total, peak, rankNow:rankFor(total), streak, bestStreak, doneCount, missedCount,
    maxes, best, prs, totalReps, exIds, body:bodyList, bodyDates,
    rank:r.name, nextRank:nx ? nx.name : null, xpToNext:nx ? Math.max(0, nx.xp - total) : null };
}

/* turn a flat {path: data} map (what the database holds) into the snapshot the engine reads */
export function snapshotFromDocs(map){
  const out = {settings:null, days:{}, study:{}, body:{}, timer:null, summary:null};
  Object.keys(map).forEach(path => {
    const v = map[path]; if(!v || typeof v !== 'object') return;
    if(path === 'leaf/main') out.settings = v;
    else if(path === 'leaf/timer') out.timer = v;
    else if(path === 'leaf/summary') out.summary = v;
    else if(path.startsWith('leaf/main/days/')) out.days[path.slice(15)] = v;
    else if(path.startsWith('leaf/main/study/')) out.study[path.slice(16)] = v;
    else if(path.startsWith('leaf/main/body/')) out.body[path.slice(15)] = v;
  });
  return out;
}

/* ---------- checkpoints: keep the Worker's work small however long the history grows ---------- */
/* the Saturday at least `back` days before today: everything up to it is settled history */
export function checkpointTarget(today, back){ const d = addDays(today, -(back || 15)); return addDays(d, -((dow(d) + 1) % 7)); }
/* a fingerprint of the settings that shape history; if it changes, old checkpoints no longer apply */
export function historyKey(s){
  const t = JSON.stringify([s.startDate || null, s.studyStart || null, s.exercises || null, s.baseline || null, s.scheduleHistory || null, s.examWeeks || null]);
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
