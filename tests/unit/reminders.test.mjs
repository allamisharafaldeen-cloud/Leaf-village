/* The reminder decision function, at fixed dates. Baghdad time throughout.
   The fixture's plan from 18 Oct: Sun groove pull-ups · Mon mixed (pull-ups + dips) · Tue groove pull-ups ·
   Wed groove dips · Thu rest · Fri test · Sat rest. Study started 20 Sep. Exam week 4–10 Oct. Shield used Tue 20 Oct. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, senseiFor, MAX_CHARS, TITLES } from '../../worker/src/reminders.js';
import { computeAll } from '../../worker/src/engine.js';
import { LINES, SENSEI_NAMES, fill } from '../../worker/src/lines.js';
import { backup, dataOf, asOf, at, slotTime, clone } from '../lib-data.mjs';

const BASE = dataOf(backup());
const iso = (date, hh, mm) => new Date(at(date, hh, mm)).toISOString();
const run = (date, slot, edit, picks) => { const now = slotTime(date, slot); const data = asOf(BASE, now); if(edit) edit(data); return decide({data, nowMs:now, slot, picks:picks || {}}); };
const lineOf = (d, sensei) => (d.lines.find(l => l.sensei === sensei) || {}).text || '';
const keys = d => d.pieces.map(p => p.key);
function wellFormed(d){
  if(!d.send){ assert.equal(d.body, ''); return; }
  const lines = d.body.split('\n');
  assert.ok(lines.length >= 1 && lines.length <= 3, 'one to three lines');
  assert.ok(d.body.length < MAX_CHARS, `under ${MAX_CHARS} characters (got ${d.body.length})`);
  const names = lines.map(l => l.slice(0, l.indexOf(':')));
  names.forEach(n => assert.ok(Object.values(SENSEI_NAMES).includes(n), `line starts with a sensei's name: "${n}"`));
  assert.equal(new Set(names).size, names.length, 'one line per sensei');
  assert.ok(!/\{\w+\}/.test(d.body), 'no unfilled placeholder');
  assert.ok(!/undefined|NaN|null/.test(d.body), 'no broken number');
}

test('groove day, behind at midday: Kakashi gives the real count', () => {
  const d = run('2026-11-10', 'MIDDAY', data => { data.days['2026-11-10'].sets = data.days['2026-11-10'].sets.slice(0, 2); data.study['2026-11-10'].entries = data.study['2026-11-10'].entries.slice(0, 1); });
  wellFormed(d);
  assert.deepEqual(keys(d), ['kakashi.midday'], 'study has started, so no study nag at midday');
  assert.match(d.body, /^Kakashi: /);
  assert.match(d.body, /2\/5 sets of 8 pull-ups/);          // max 15 → 50% → 8 reps
  assert.equal(d.title, 'Midday check');
});

test('groove day, behind in the evening and at last call: the stake is named', () => {
  const edit = data => { data.days['2026-11-10'].sets = data.days['2026-11-10'].sets.slice(0, 3); };
  const eve = run('2026-11-10', 'EVENING', edit), last = run('2026-11-10', 'LASTCALL', edit);
  wellFormed(eve); wellFormed(last);
  assert.match(lineOf(eve, 'kakashi'), /3\/5 sets of 8 pull-ups/);
  assert.match(lineOf(last, 'kakashi'), /3\/5 sets of 8 pull-ups/);
  assert.match(lineOf(last, 'kakashi'), /100 XP and your \d+-day streak/);
});

test('groove day, sets below the target do not count as progress', () => {
  const d = run('2026-11-10', 'EVENING', data => { data.days['2026-11-10'].sets = data.days['2026-11-10'].sets.slice(0, 4).map((x, i) => Object.assign({}, x, {reps:i < 2 ? 8 : 7})); });
  assert.match(lineOf(d, 'kakashi'), /2\/5 sets of 8 pull-ups/);
});

test('mission done: no workout reminder', () => {
  ['MIDDAY', 'EVENING', 'LASTCALL'].forEach(slot => {
    const d = run('2026-11-10', slot, data => { data.days['2026-11-10'] = clone(BASE.days['2026-11-10']); });
    assert.ok(!keys(d).some(k => k.startsWith('kakashi.')), slot);
  });
});

test('mixed day partly done: each exercise gets its own count', () => {
  const d = run('2026-11-09', 'EVENING', data => {
    data.days['2026-11-09'] = {date:'2026-11-09', sets:[
      {ex:'pullups', reps:8, t:iso('2026-11-09', 8, 0)}, {ex:'dips', reps:13, t:iso('2026-11-09', 8, 5)},
      {ex:'pullups', reps:8, t:iso('2026-11-09', 12, 0)}, {ex:'pullups', reps:5, t:iso('2026-11-09', 15, 0)}]};
  });
  wellFormed(d);
  assert.match(lineOf(d, 'kakashi'), /pull-ups 2\/3, dips 1\/3/i);
  const m = run('2026-11-09', 'MORNING');
  wellFormed(m);
  assert.match(lineOf(m, 'kakashi'), /3 × 8 pull-ups and 3 × 13 dips/);
});

test('test day: Guy briefs the maxes to beat with +100 XP, then chases the test sets', () => {
  const m = run('2026-11-13', 'MORNING');
  wellFormed(m);
  assert.deepEqual(keys(m), ['guy.brief.test', 'hiruzen.study.target']);
  assert.match(lineOf(m, 'guy'), /15 pull-ups and 26 dips/);
  assert.match(lineOf(m, 'guy'), /\+100 XP/);
  assert.match(lineOf(m, 'hiruzen'), /6h/);                  // Friday study: 6h minimum, 8h full
  assert.match(lineOf(m, 'hiruzen'), /8h/);
  const e = run('2026-11-13', 'EVENING', data => { data.days['2026-11-13'] = {date:'2026-11-13', sets:[{ex:'pullups', reps:16, t:iso('2026-11-13', 9, 0)}, {ex:'pullups', reps:13, t:iso('2026-11-13', 9, 10)}, {ex:'dips', reps:27, t:iso('2026-11-13', 9, 30)}]}; });
  wellFormed(e);
  assert.match(lineOf(e, 'guy'), /pull-ups 2\/2, dips 1\/2/i);
  const l = run('2026-11-13', 'LASTCALL');
  assert.match(lineOf(l, 'guy'), /pull-ups 0\/2, dips 0\/2/i);
  assert.match(lineOf(l, 'guy'), /150 XP/);                 // a missed test costs 150
  const done = run('2026-11-13', 'LASTCALL', data => { data.days['2026-11-13'] = {date:'2026-11-13', sets:['pullups', 'pullups', 'dips', 'dips'].map((ex, i) => ({ex, reps:10, t:iso('2026-11-13', 9, i)}))}; });
  assert.ok(!keys(done).some(k => k.startsWith('guy.')), 'test finished: Guy is quiet');
});

test('rest day (a Thursday): Jiraiya in the morning, no workout nags, and no study nag because Thursday has no target', () => {
  const m = run('2026-11-12', 'MORNING');
  wellFormed(m);
  assert.deepEqual(keys(m), ['jiraiya.brief.rest']);
  assert.match(m.body, /^Jiraiya: /);
  ['MIDDAY', 'LASTCALL'].forEach(slot => assert.equal(run('2026-11-12', slot).send, false, `${slot}: nothing to send`));
  const e = run('2026-11-12', 'EVENING');
  assert.deepEqual(keys(e), ['jiraiya.weigh'], 'rest-day evening: weigh-in challenge not done yet');
  assert.match(e.body, /0\/2|0 of 2/);
  const weighed = run('2026-11-12', 'EVENING', data => { data.body['2026-11-12'] = {date:'2026-11-12', weight:73}; });
  assert.equal(weighed.send, false, 'already weighed in today');
});

test('Thursday off-day study is optional: still no study nag after opening it', () => {
  ['MIDDAY', 'EVENING', 'LASTCALL'].forEach(slot => {
    const d = run('2026-11-12', slot, data => { data.study['2026-11-12'] = {date:'2026-11-12', entries:[], offday:true}; });
    assert.ok(!keys(d).some(k => k.includes('.study.')), slot);
  });
});

test('study reminders: midday only at zero, evening when below the minimum, last call with the exact time left', () => {
  const none = data => { delete data.study['2026-11-10']; data.days['2026-11-10'] = clone(BASE.days['2026-11-10']); };
  const some = mins => data => { data.study['2026-11-10'] = {date:'2026-11-10', entries:[{start:iso('2026-11-10', 6, 0), end:iso('2026-11-10', 6, 0 + 0) , min:mins, src:'manual'}]}; data.days['2026-11-10'] = clone(BASE.days['2026-11-10']); };
  assert.deepEqual(keys(run('2026-11-10', 'MIDDAY', none)), ['hiruzen.study.midday']);
  assert.match(run('2026-11-10', 'MIDDAY', none).body, /4h/);
  assert.equal(run('2026-11-10', 'MIDDAY', some(30)).send, false, 'some study logged: no midday nag');
  const eve = run('2026-11-10', 'EVENING', some(95));
  wellFormed(eve);
  assert.deepEqual(keys(eve), ['hiruzen.study.evening']);
  assert.match(eve.body, /1h 35m/); assert.match(eve.body, /2h 25m/);
  assert.deepEqual(keys(run('2026-11-10', 'EVENING', none)), ['hiruzen.study.evening0']);
  assert.equal(run('2026-11-10', 'EVENING', some(240)).send, false, 'minimum reached: quiet');
  const last = run('2026-11-10', 'LASTCALL', some(203));
  wellFormed(last);
  assert.match(last.body, /37m/, 'exact time still needed');
});

test('a running study timer counts toward today', () => {
  const d = run('2026-11-10', 'EVENING', data => {
    data.days['2026-11-10'] = clone(BASE.days['2026-11-10']);
    data.study['2026-11-10'] = {date:'2026-11-10', entries:[{start:iso('2026-11-10', 6, 0), end:iso('2026-11-10', 8, 0), min:120, src:'timer'}]};
    data.timer = {state:'running', segStart:at('2026-11-10', 16, 40), checkAt:at('2026-11-10', 19, 40), sessionMs:0};
  });
  assert.match(d.body, /3h/);   // 2h logged + 1h on the timer
  assert.match(d.body, /1h\b/); // 1h still needed
  const capped = run('2026-11-10', 'LASTCALL', data => {
    data.days['2026-11-10'] = clone(BASE.days['2026-11-10']);
    delete data.study['2026-11-10'];
    data.timer = {state:'running', segStart:at('2026-11-10', 12, 0), checkAt:at('2026-11-10', 15, 0), sessionMs:0};
  });
  assert.match(capped.body, /1h\b/, 'a forgotten timer stops counting at its 3-hour check: 3h counted, 1h needed');
});

test('last call with the shield still available: he is told about "Protect my streak"', () => {
  const d = run('2026-11-10', 'LASTCALL', data => { data.study['2026-11-10'].entries = data.study['2026-11-10'].entries.slice(0, 1); data.days['2026-11-10'].sets = data.days['2026-11-10'].sets.slice(0, 4); });
  wellFormed(d);
  assert.deepEqual(keys(d), ['kakashi.lastcall', 'hiruzen.study.lastcall', 'hiruzen.study.shield']);
  assert.match(lineOf(d, 'hiruzen'), /2h/, '2h of the 4h minimum still needed');
  assert.match(lineOf(d, 'hiruzen'), /"Protect my streak"/);
  assert.match(lineOf(d, 'hiruzen'), /before midnight/);
  assert.match(lineOf(d, 'hiruzen'), /truly/);
  assert.equal(d.title, 'Last call');
});

test('shield used: the shielded day gets no study reminder, and the rest of that week no shield offer', () => {
  ['MIDDAY', 'EVENING', 'LASTCALL'].forEach(slot => {
    const d = run('2026-10-20', slot, data => { data.study['2026-10-20'] = clone(BASE.study['2026-10-20']); });
    assert.ok(!keys(d).some(k => k.includes('.study.')), `${slot}: shielded day is left alone`);
  });
  const wed = run('2026-10-21', 'LASTCALL', data => { data.study['2026-10-21'].entries = data.study['2026-10-21'].entries.slice(0, 1); });
  assert.ok(keys(wed).includes('hiruzen.study.lastcall'));
  assert.ok(!keys(wed).includes('hiruzen.study.shield'), 'shield already used this Sunday-to-Saturday week');
  assert.ok(!/Protect my streak/.test(wed.body));
  const nextWeek = run('2026-10-27', 'LASTCALL', data => { data.study['2026-10-27'].entries = data.study['2026-10-27'].entries.slice(0, 1); });
  assert.ok(keys(nextWeek).includes('hiruzen.study.shield'), 'a new week brings a new shield');
});

test('exam week: one calm good-luck line in the morning naming the day, nothing else all day', () => {
  const m = run('2026-10-06', 'MORNING');
  wellFormed(m);
  assert.deepEqual(keys(m), ['hiruzen.exam']);
  assert.match(m.body, /^Third Hokage: /);
  assert.match(m.body, /[Dd]ay 3\b/);
  assert.equal(run('2026-10-04', 'MORNING').body.match(/[Dd]ay (\d)/)[1], '1');
  ['MIDDAY', 'EVENING', 'LASTCALL'].forEach(slot => assert.equal(run('2026-10-06', slot, data => { delete data.study['2026-10-06']; }).send, false, slot));
  assert.ok(keys(run('2026-10-11', 'MORNING')).every(k => k !== 'hiruzen.exam'), 'the day after exam week is a normal day');
});

test('Sunday morning: the weekly report leads, with last week\'s real numbers', () => {
  const d = run('2026-11-08', 'MORNING');
  wellFormed(d);
  assert.deepEqual(keys(d), ['hiruzen.weekly', 'hiruzen.brief.gtg', 'hiruzen.study.target']);
  assert.equal(d.lines.length, 1, 'all three are the Third Hokage, so they share one line');
  const C = computeAll(asOf(BASE, slotTime('2026-11-08', 'MORNING')), slotTime('2026-11-08', 'MORNING')), W = C.weeks['2026-11-01'];
  const reps = id => Object.keys(BASE.days).filter(k => k >= '2026-11-01' && k <= '2026-11-07').reduce((n, k) => n + BASE.days[k].sets.filter(x => x.ex === id).reduce((m, x) => m + x.reps, 0), 0);
  assert.ok(d.body.includes(`${reps('pullups')} pull-ups`)); assert.ok(d.body.includes(`${reps('dips')} dips`));
  assert.equal(W.done, 4); assert.equal(W.missed, 1);       // Tue 3 Nov was left unfinished
  assert.match(d.body, /4 (missions )?done/); assert.match(d.body, /1 missed/);
  const mins = Object.keys(BASE.study).filter(k => k >= '2026-11-01' && k <= '2026-11-07').reduce((n, k) => n + BASE.study[k].entries.reduce((m, e) => m + e.min, 0), 0);
  assert.ok(d.body.includes(`${Math.floor(mins / 60)}h`), 'study hours');
  assert.match(d.body, /[+−][\d,]+ XP/);
  assert.match(d.body, /no new max|\d new max/);
  assert.match(d.body, /5 × 8 pull-ups|5 sets of 8 pull-ups/, 'then today\'s Sunday mission from the Third Hokage');
  assert.equal(senseiFor(BASE.settings, '2026-11-08'), 'hiruzen');
});

test('a promotion within 300 XP gets a short Third Hokage line in the evening only', () => {
  const now = slotTime('2026-11-10', 'EVENING'), data = asOf(BASE, now), C = computeAll(data, now);
  assert.ok(C.xpToNext > 300);
  assert.ok(!keys(decide({data, nowMs:now, slot:'EVENING', picks:{}})).includes('hiruzen.promo'));
  /* bring the total to just under the next rank by adding old study half-hours (20 XP each) */
  const near = clone(data); let extra = 0;
  while(computeAll(near, now).xpToNext > 300 && extra < 3000){
    near.study['2026-09-21'].entries.push({start:iso('2026-09-21', 12, 0), end:iso('2026-09-21', 12, 30), min:30, src:'manual'}); extra++;
  }
  const C2 = computeAll(near, now);
  assert.ok(C2.xpToNext > 0 && C2.xpToNext <= 300, `test setup reached the window (${C2.xpToNext} XP to go after ${extra} edits)`);
  const d = decide({data:near, nowMs:now, slot:'EVENING', picks:{}});
  wellFormed(d);
  assert.ok(keys(d).includes('hiruzen.promo'));
  assert.ok(lineOf(d, 'hiruzen').includes(`${C2.xpToNext} XP`)); assert.ok(lineOf(d, 'hiruzen').includes(C2.nextRank));
  ['MORNING', 'MIDDAY', 'LASTCALL'].forEach(slot => assert.ok(!keys(decide({data:near, nowMs:slotTime('2026-11-10', slot), slot, picks:{}})).includes('hiruzen.promo'), slot));
});

test('the notify switches control everything', () => {
  const withNotify = n => data => { data.settings = Object.assign({}, data.settings, {notify:n}); };
  const behind = data => { data.days['2026-11-10'].sets = []; delete data.study['2026-11-10']; };
  const both = (...fns) => data => fns.forEach(f => f(data));
  assert.equal(run('2026-11-10', 'MORNING', withNotify({enabled:false})).send, false, 'master switch off: silence');
  assert.equal(run('2026-11-10', 'LASTCALL', both(behind, withNotify({enabled:false}))).send, false);
  assert.deepEqual(keys(run('2026-11-10', 'MORNING', withNotify({briefing:false}))), [], 'briefing off: no morning briefing');
  assert.deepEqual(keys(run('2026-11-10', 'MORNING', withNotify({study:false}))), ['kakashi.brief.gtg']);
  assert.deepEqual(keys(run('2026-11-10', 'EVENING', both(behind, withNotify({streak:false})))), ['hiruzen.study.evening0']);
  assert.deepEqual(keys(run('2026-11-10', 'EVENING', both(behind, withNotify({study:false})))), ['kakashi.evening']);
  assert.deepEqual(keys(run('2026-11-08', 'MORNING', withNotify({weekly:false}))), ['hiruzen.brief.gtg', 'hiruzen.study.target']);
  assert.deepEqual(keys(run('2026-11-13', 'MORNING', withNotify({test:false}))), ['hiruzen.study.target'], 'test-day messages off');
  assert.deepEqual(keys(run('2026-11-13', 'EVENING', withNotify({test:false, study:false}))), []);
  assert.deepEqual(keys(run('2026-11-10', 'MORNING', withNotify({}))), ['kakashi.brief.gtg', 'hiruzen.study.target'], 'missing switches mean on');
});

test('nothing applies: nothing is sent', () => {
  const allDone = data => { data.days['2026-11-10'] = clone(BASE.days['2026-11-10']); data.study['2026-11-10'] = clone(BASE.study['2026-11-10']); };
  ['MIDDAY', 'EVENING', 'LASTCALL'].forEach(slot => { const d = run('2026-11-10', slot, allDone); assert.equal(d.send, false, slot); assert.equal(d.body, ''); });
  assert.equal(decide({data:{settings:null}, nowMs:Date.now(), slot:'MORNING', picks:{}}).send, false, 'no settings yet');
  assert.equal(decide({data:asOf(BASE, slotTime('2026-09-01', 'MORNING')), nowMs:slotTime('2026-09-01', 'MORNING'), slot:'MORNING', picks:{}}).send, false, 'before the start date');
  assert.equal(decide({data:BASE, nowMs:Date.now(), slot:'BRUNCH', picks:{}}).send, false, 'unknown slot');
});

test('every slot of every day in the fixture is well formed and under 320 characters', () => {
  let sent = 0, picks = {};
  for(let day = Date.parse('2026-09-06T00:00:00Z'); day <= Date.parse('2026-11-14T00:00:00Z'); day += 86400000){
    const date = new Date(day).toISOString().slice(0, 10);
    Object.keys(TITLES).forEach(slot => {
      /* the day as it really stood at that minute, and also a worst case with nothing logged */
      [null, data => { delete data.days[date]; delete data.study[date]; }].forEach(edit => {
        const d = run(date, slot, edit, picks); wellFormed(d); if(d.send) sent++;
        if(!edit) picks = d.picks;
      });
    });
  }
  assert.ok(sent > 200, `plenty of notifications checked (${sent})`);
});

test('a line is never repeated on consecutive days', () => {
  let picks = {}; const last = {};
  for(let i = 0; i < 28; i++){
    const date = new Date(Date.parse('2026-10-12T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
    Object.keys(TITLES).forEach(slot => {
      const d = run(date, slot, data => { delete data.days[date]; delete data.study[date]; }, picks);
      picks = d.picks;
      d.pieces.forEach(p => {
        const tpl = LINES[p.key][picks[p.key].i];
        if(last[p.key]) assert.notEqual(tpl, last[p.key].tpl, `${p.key} repeated on ${date}`);
        last[p.key] = {tpl, date};
      });
    });
  }
  const same = run('2026-11-10', 'MORNING', null, picks), again = run('2026-11-10', 'MORNING', null, same.picks);
  assert.equal(again.body, same.body, 'asking twice on the same day gives the same words');
});

test('every pool has at least 6 original lines that fit, and only uses placeholders it is given', () => {
  const worst = {name:'Sharafaldeen', need:12, goal:15, target:25, ex:'weighted pull-ups', combo:'8 × 25 weighted pull-ups and 8 × 40 ring dips', maxes:'38 weighted pull-ups and 62 ring dips', sets:5,
    progress:'weighted pull-ups 10/12, ring dips 11/12', stake:'150 XP and your 365-day streak', penalty:150, streak:365, have:1, goal2:2, min:'10h 30m', full:'13h 30m', done:'9h 59m',
    day:7, days:7, xp:'+12,345', rank:'Tailed Beast Mode', reps:'1,234 pull-ups, 2,345 dips', missed:5, hours:'61h 45m', prs:'2 new maxes'};
  const limit = {'hiruzen.weekly':150, 'hiruzen.study.shield':110};
  Object.keys(LINES).forEach(key => {
    const pool = LINES[key];
    assert.ok(pool.length >= 6, `${key} has ${pool.length} lines`);
    assert.equal(new Set(pool).size, pool.length, `${key} has no duplicate lines`);
    pool.forEach(t => {
      const text = fill(t, worst);
      assert.ok(!/\{\w+\}/.test(text), `${key}: unknown placeholder in "${t}"`);
      assert.ok(text.length <= (limit[key] || 145), `${key}: too long even for big numbers (${text.length}): ${text}`);
    });
    const sensei = key.split('.')[0];
    assert.ok(SENSEI_NAMES[sensei], `${key} belongs to a sensei`);
    if(sensei === 'guy') pool.forEach(t => assert.ok(/!/.test(t), `Guy shouts: ${t}`));
  });
});
