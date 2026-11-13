/* The Leaf Village · what the senseis say, and when.
   decide() is a pure function: give it the synced documents, the time and the slot, and it returns
   the one notification to send (or nothing). The rules are the ones from docs/fable-session-1.md. */
import { computeAll, planFor, examFor, dow, addDays, weekStart, dayMs, exName, XP, CHALLENGES, hourAt } from './engine.js';
import { LINES, SENSEI_NAMES, fill } from './lines.js';

export const SLOT_BY_HOUR = {5:'MORNING', 11:'MIDDAY', 17:'EVENING', 22:'LASTCALL'};
export const slotAt = nowMs => SLOT_BY_HOUR[hourAt(nowMs)] || null;
export const TITLES = {MORNING:'Morning briefing', MIDDAY:'Midday check', EVENING:'Evening check', LASTCALL:'Last call'};
export const NOTIFY_DEFAULT = {enabled:true, briefing:true, streak:true, test:true, promotion:true, weekly:true, study:true};
export const MAX_CHARS = 320;

const fmtH = m => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };
const fmtN = n => String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtN(n);
const hash = str => { let h = 2166136261; for(let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export function senseiFor(s, date){
  const p = planFor(s, date);
  if(dow(date) === 0 && p.type !== 'test' && p.type !== 'rest') return 'hiruzen';
  if(p.type === 'test') return 'guy';
  if(p.type === 'rest') return 'jiraiya';
  return 'kakashi';
}

/* each situation walks through its pool one line at a time, so no line repeats on consecutive days */
function choose(key, picks, today){
  const pool = LINES[key], last = picks[key];
  let i;
  if(last && last.d === today) i = last.i % pool.length;
  else if(last) i = (last.i + 1) % pool.length;
  else i = hash(key + '|' + today) % pool.length;
  picks[key] = {i, d:today};
  return pool[i];
}

/* resume: an optional engine checkpoint (see engine.js) so only recent days are recomputed */
export function decide({data, nowMs, slot, picks, resume}){
  const out = {send:false, slot, title:TITLES[slot] || 'The Leaf Village', body:'', lines:[], pieces:[], picks:Object.assign({}, picks || {}), today:null};
  const s = data && data.settings;
  if(!s || !s.startDate || !TITLES[slot]) return out;
  const n = Object.assign({}, NOTIFY_DEFAULT, s.notify || {});
  if(!n.enabled) return out;
  const C = computeAll(data, nowMs, resume ? {resume} : null), today = C.today;
  out.today = today;
  if(s.startDate > today) return out;
  const name = s.name || 'ninja';
  const say = (sensei, key, vars) => { const prev = out.picks[key]; const text = fill(choose(key, out.picks, today), Object.assign({name}, vars)); out.pieces.push({sensei, key, prev, text:text.charAt(0).toUpperCase() + text.slice(1)}); };
  const lower = id => exName(s, id).toLowerCase();

  /* exam week: no nags at all; one calm line in the morning */
  const exam = examFor(s, today);
  if(exam){
    if(slot === 'MORNING') say('hiruzen', 'hiruzen.exam', {day:Math.round((dayMs(today) - dayMs(exam.start)) / 86400000) + 1, days:Math.round((dayMs(exam.end) - dayMs(exam.start)) / 86400000) + 1});
    return finish(out);
  }

  const t = C.todayRec, plan = t ? t.plan : planFor(s, today), sensei = senseiFor(s, today);
  const testOk = plan.type !== 'test' || n.test;
  const rec = C.study.start ? C.study.days[today] : null;
  /* a study target exists (not Thursday), no shield is covering today, and the minimum isn't reached yet */
  const studyOpen = !!(n.study && rec && rec.tgt && !rec.tgt.off && rec.status !== 'shield' && rec.mins < rec.tgt.min);

  if(slot === 'MORNING'){
    if(n.weekly && dow(today) === 0){
      const wk = addDays(weekStart(today), -7), W = C.weeks[wk], SW = C.study.weeks[wk];
      if(W){
        const reps = C.exIds.filter(id => (W.reps[id] || 0) > 0).map(id => `${fmtN(W.reps[id])} ${lower(id)}`).join(', ') || 'no reps logged';
        const k = W.prs.length;
        say('hiruzen', 'hiruzen.weekly', {reps, done:W.done, missed:W.missed, hours:fmtH(SW ? SW.mins : 0), xp:signed(W.xp), prs:k === 0 ? 'no new max' : k === 1 ? '1 new max' : `${k} new maxes`});
      }
    }
    if(n.briefing && testOk && t && t.status !== 'done'){
      const i = t.info;
      if(plan.type === 'gtg') say(sensei, `${sensei}.brief.gtg`, {need:i.need, goal:i.goal, target:i.target, ex:lower(i.ex)});
      else if(plan.type === 'combo') say(sensei, `${sensei}.brief.combo`, {combo:i.parts.map(p => `${p.need} × ${p.target} ${lower(p.ex)}`).join(' and ')});
      else if(plan.type === 'test'){ if(i.per.length) say('guy', 'guy.brief.test', {maxes:i.per.map(p => `${p.prev} ${lower(p.ex)}`).join(' and '), sets:i.sets}); }
      else say('jiraiya', 'jiraiya.brief.rest', {});
    }
    if(n.briefing && studyOpen) say('hiruzen', 'hiruzen.study.target', {min:fmtH(rec.tgt.min), full:fmtH(rec.tgt.full)});
    return finish(out);
  }

  /* MIDDAY, EVENING, LASTCALL: the mission, with real progress */
  if(n.streak && testOk && t && plan.type !== 'rest' && t.status !== 'done'){
    const i = t.info; let progress;
    if(plan.type === 'gtg') progress = `${i.q}/${i.need} sets of ${i.target} ${lower(i.ex)}`;
    else if(plan.type === 'combo') progress = i.parts.map(p => `${lower(p.ex)} ${Math.min(p.q, p.need)}/${p.need}`).join(', ');
    else progress = i.per.map(p => `${lower(p.ex)} ${p.sets.length}/${i.sets}`).join(', ');
    const penalty = plan.type === 'test' ? XP.missTest : XP.missGtg;
    const stake = C.streak >= 2 ? `${penalty} XP and your ${C.streak}-day streak` : `${penalty} XP`;
    if(progress) say(sensei, `${sensei}.${slot.toLowerCase()}`, {progress, stake, penalty, streak:C.streak});
  }
  /* rest-day evening: Jiraiya's weigh-in challenge */
  if(slot === 'EVENING' && plan.type === 'rest' && n.briefing && (C.weekNow.weigh || 0) < CHALLENGES.jiraiya.goal && !C.bodyDates.has(today)){
    say('jiraiya', 'jiraiya.weigh', {have:C.weekNow.weigh || 0, goal:CHALLENGES.jiraiya.goal});
  }
  /* study */
  if(studyOpen){
    const need = fmtH(Math.max(1, Math.ceil(rec.tgt.min - rec.mins))), done = fmtH(Math.floor(rec.mins)), min = fmtH(rec.tgt.min);
    if(slot === 'MIDDAY'){ if(rec.mins < 1) say('hiruzen', 'hiruzen.study.midday', {min}); }
    else if(slot === 'EVENING') say('hiruzen', rec.mins < 1 ? 'hiruzen.study.evening0' : 'hiruzen.study.evening', {done, need, min});
    else {
      say('hiruzen', 'hiruzen.study.lastcall', {done, need, min});
      const ws = weekStart(today), used = C.study.list.some(r => r.date >= ws && r.status === 'shield');
      if(!used && !rec.shield) say('hiruzen', 'hiruzen.study.shield', {});
    }
  }
  /* a promotion is close */
  if(slot === 'EVENING' && n.promotion && C.xpToNext != null && C.xpToNext > 0 && C.xpToNext <= 300){
    say('hiruzen', 'hiruzen.promo', {xp:fmtN(C.xpToNext), rank:C.nextRank});
  }
  return finish(out);
}

/* one line per sensei, each starting with the sensei's name and a colon; at most 3 lines, under 320 characters */
function compose(pieces){
  const order = [], by = {};
  pieces.forEach(p => { if(!by[p.sensei]){ by[p.sensei] = []; order.push(p.sensei); } by[p.sensei].push(p.text); });
  return order.slice(0, 3).map(id => ({sensei:id, text:`${SENSEI_NAMES[id]}: ${by[id].join(' ')}`}));
}
function finish(out){
  let lines = compose(out.pieces), body = lines.map(l => l.text).join('\n');
  while(body.length >= MAX_CHARS && out.pieces.length > 1){
    const gone = out.pieces.pop(); if(gone.prev) out.picks[gone.key] = gone.prev; else delete out.picks[gone.key];
    lines = compose(out.pieces); body = lines.map(l => l.text).join('\n');
  }
  if(body.length >= MAX_CHARS) body = body.slice(0, MAX_CHARS - 2).replace(/\s+\S*$/, '') + '…';
  out.lines = lines; out.body = body; out.send = out.pieces.length > 0;
  return out;
}
