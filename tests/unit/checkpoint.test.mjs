/* Checkpoints: replaying only recent days from a saved checkpoint must give exactly what replaying the whole
   history gives. The Worker relies on this to stay inside Cloudflare's free CPU allowance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAll, checkpointTarget, advanceCheckpoint, historyKey, dow, addDays, dateAt } from '../../worker/src/engine.js';
import { decide, TITLES } from '../../worker/src/reminders.js';
import { makeEnv, call, runSlot, stepCheckpoint } from '../lib-worker.mjs';
import { backup, dataOf, docsOf, asOf, slotTime, clone } from '../lib-data.mjs';

const BASE = dataOf(backup());
/* two more copies of the fixture's nine weeks laid end to end: about six months of history */
function longData(){
  const out = clone(BASE), shift = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString();
  out.settings.examWeeks = [{start:'2026-10-04', end:'2026-10-10'}, {start:'2027-02-07', end:'2027-02-13'}];
  for(let k = 1; k <= 2; k++){ const off = 63 * k;
    Object.keys(BASE.days).forEach(d => { if(d < '2026-11-08'){ const n = addDays(d, off); out.days[n] = {date:n, sets:BASE.days[d].sets.map(x => ({ex:x.ex, reps:x.reps, t:shift(x.t, off)}))}; } });
    Object.keys(BASE.study).forEach(d => { if(d < '2026-11-08'){ const n = addDays(d, off), src = BASE.study[d]; out.study[n] = Object.assign({}, src, {date:n, entries:src.entries.map(e => ({start:shift(e.start, off), end:shift(e.end, off), min:e.min, src:e.src}))}); } });
    Object.keys(BASE.body).forEach(d => { if(d < '2026-11-08'){ const n = addDays(d, off); out.body[n] = {date:n, weight:BASE.body[d].weight}; } });
  }
  return out;
}
const pickOut = C => ({total:C.total, peak:C.peak, rank:C.rank, xpToNext:C.xpToNext, streak:C.streak, bestStreak:C.bestStreak, maxes:C.maxes, best:C.best, totalReps:C.totalReps, doneCount:C.doneCount, missedCount:C.missedCount,
  studyStreak:C.study.streak, studyBest:C.study.best, weekNow:C.weekNow, today:C.todayRec && {status:C.todayRec.status, xp:C.todayRec.xp, info:C.todayRec.info}});

test('the checkpoint date is always a Saturday at least 15 days back', () => {
  for(let i = 0; i < 60; i++){
    const today = addDays('2026-11-01', i), t = checkpointTarget(today);
    assert.equal(dow(t), 6, `${t} is a Saturday`);
    assert.ok(t <= addDays(today, -15) && t > addDays(today, -22), `${today} → ${t}`);
  }
});

test('resuming from a checkpoint gives exactly the same totals as replaying everything', () => {
  const LONG = longData();
  for(let i = 0; i < 40; i += 3){
    const date = addDays('2027-02-20', i), now = slotTime(date, 'EVENING'), data = asOf(LONG, now);
    const full = computeAll(data, now);
    /* build the checkpoint in small steps, as the Worker does */
    let state = null, steps = 0;
    const target = checkpointTarget(dateAt(now));
    while((!state || state.date < target) && steps < 50){ const next = advanceCheckpoint(data, now, state, target, 30); assert.ok(next && (!state || next.date > state.date), 'each step moves forward'); assert.equal(dow(next.date), 6); state = next; steps++; }
    assert.equal(state.date, target); assert.ok(steps >= 4, `built in several steps (${steps})`);
    /* then give the engine only the days after it */
    const recent = clone(data);
    ['days', 'study', 'body'].forEach(k => Object.keys(recent[k]).forEach(d => { if(d <= state.date) delete recent[k][d]; }));
    const resumed = computeAll(recent, now, {resume:state});
    assert.deepEqual(pickOut(resumed), pickOut(full), `totals on ${date}`);
    Object.keys(TITLES).forEach(slot => {
      const t = slotTime(date, slot), a = decide({data:asOf(LONG, t), nowMs:t, slot, picks:{}});
      const r = asOf(LONG, t); ['days', 'study', 'body'].forEach(k => Object.keys(r[k]).forEach(d => { if(d <= state.date) delete r[k][d]; }));
      const b = decide({data:r, nowMs:t, slot, picks:{}, resume:state});
      assert.equal(b.body, a.body, `${date} ${slot}`);
    });
  }
});

test('the settings fingerprint changes only when history-shaping settings change', () => {
  const s = clone(BASE.settings), k = historyKey(s);
  assert.equal(historyKey(Object.assign({}, s, {notify:{weekly:false}, celebrated:9, themeRank:2, name:'Other'})), k, 'switches, theme and name do not matter');
  assert.notEqual(historyKey(Object.assign({}, s, {examWeeks:[]})), k);
  assert.notEqual(historyKey(Object.assign({}, s, {baseline:{pullups:{max:11, date:s.startDate}, dips:s.baseline.dips}})), k);
  assert.notEqual(historyKey(Object.assign({}, s, {scheduleHistory:s.scheduleHistory.slice(0, 1)})), k);
});

test('in the Worker: reminders with a checkpoint say the same as without, and the checkpoint is rebuilt when it must be', async () => {
  const env = makeEnv(), LONG = longData();
  const docs = docsOf({settings:LONG.settings, days:LONG.days, study:LONG.study, body:LONG.body, timer:{state:'idle'}}), paths = Object.keys(docs);
  /* the Worker reads the clock itself, so the test sets the clock while it calls it */
  const realNow = Date.now;
  const on = async (date, fn) => { Date.now = () => slotTime(date, 'MORNING'); try{ return await fn(); } finally { Date.now = realNow; } };
  await on('2027-03-10', async () => { for(let i = 0; i < paths.length; i += 20) assert.equal((await call(env, 'POST', '/sync', {since:0, docs:paths.slice(i, i + 20).map(p => ({path:p, data:docs[p], mtime:0}))})).status, 200); });
  const cpRow = () => env.DB.raw.prepare(`SELECT value FROM meta WHERE key = 'checkpoint'`).get();
  const cpNow = () => JSON.parse(cpRow().value);
  const target = checkpointTarget('2027-03-10');
  assert.equal(cpRow(), undefined, 'no checkpoint is built while the history is still being uploaded');
  /* afterwards every sync or reminder moves it forward by one bounded step until it has caught up */
  let steps = 0;
  while((!cpRow() || cpNow().state.date < target) && steps < 10){ await stepCheckpoint(env, slotTime('2027-03-10', 'MORNING')); steps++; }
  assert.equal(cpNow().state.date, target); assert.ok(steps >= 2 && steps <= 3, `caught up in ${steps} steps of at most 120 days`);
  const preview = async (slot, date) => (await call(env, 'GET', `/reminders/preview?slot=${slot}&at=${slotTime(date, slot)}`)).json;
  for(const slot of Object.keys(TITLES)){
    const withCp = await preview(slot, '2027-03-10');
    const plain = decide({data:LONG, nowMs:slotTime('2027-03-10', slot), slot, picks:{}});
    assert.equal(withCp.body, plain.body, slot); assert.equal(withCp.send, plain.send);
  }
  /* a week later the checkpoint moves on by itself */
  await preview('MORNING', '2027-03-17');
  assert.equal(cpNow().state.date, checkpointTarget('2027-03-17')); assert.ok(cpNow().state.date > target);
  /* flipping a reminder switch keeps it */
  const before = cpNow();
  await on('2027-03-17', () => call(env, 'POST', '/sync', {since:0, docs:[{path:'leaf/main', data:Object.assign({}, LONG.settings, {notify:{promotion:false}}), mtime:Date.now()}]}));
  await stepCheckpoint(env, slotTime('2027-03-17', 'MIDDAY'));
  assert.deepEqual(cpNow().state, before.state);
  /* an old log arriving late (a device that was offline for months) throws it away and rebuilds it correctly */
  const lateDay = '2026-12-01', extra = {ex:'pullups', reps:9, t:`${lateDay}T04:00:00.000Z`};
  await on('2027-03-17', () => call(env, 'POST', '/sync', {since:0, docs:[{path:`leaf/main/days/${lateDay}`, data:{date:lateDay, sets:[extra]}}]}));
  const LATE = clone(LONG); LATE.days[lateDay] = LATE.days[lateDay] || {date:lateDay, sets:[]}; LATE.days[lateDay].sets = LATE.days[lateDay].sets.concat([extra]).sort((a, b) => a.t < b.t ? -1 : 1);
  LATE.settings.notify = {promotion:false};
  for(let i = 0; i < 6; i++) await stepCheckpoint(env, slotTime('2027-03-17', 'MIDDAY'));
  assert.equal(cpNow().state.date, checkpointTarget('2027-03-17'));
  assert.deepEqual(cpNow().state.totalReps, computeAll(LATE, slotTime('2027-03-17', 'MIDDAY'), {until:cpNow().state.date}).totalReps, 'the late set is counted');
  assert.equal(cpNow().state.total, computeAll(LATE, slotTime('2027-03-17', 'MIDDAY'), {until:cpNow().state.date}).total);
  /* changing the plan's history throws it away too */
  const s2 = Object.assign({}, LATE.settings, {examWeeks:LATE.settings.examWeeks.concat([{start:'2027-04-04', end:'2027-04-10'}])});
  await on('2027-03-18', () => call(env, 'POST', '/sync', {since:0, docs:[{path:'leaf/main', data:s2, mtime:Date.now()}]}));
  await stepCheckpoint(env, slotTime('2027-03-17', 'EVENING'));
  assert.equal(cpNow().key, historyKey(s2));
  /* and a young village (under three weeks old) simply has no checkpoint */
  const young = makeEnv();
  await call(young, 'POST', '/sync', {since:0, docs:[{path:'leaf/main', data:Object.assign({}, BASE.settings, {startDate:'2027-03-08', studyStart:'2027-03-08'}), mtime:1}]});
  assert.equal(await stepCheckpoint(young, slotTime('2027-03-17', 'MORNING')), null);
  assert.equal((await runSlot(young, slotTime('2027-03-17', 'MORNING'), 'MORNING')).note, 'no device has notifications turned on');
});
