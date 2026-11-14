/* The app's game engine (leaf-engine.js) at fixed dates: XP, streaks, ranks, study statuses, combos, shields,
   exam weeks, midnight edges, and day-by-day agreement with the Worker's copy of the rules. */
process.env.TZ = 'Asia/Baghdad';
import test from 'node:test';
import assert from 'node:assert/strict';
import E from '../../leaf-engine.js';
import { computeAll } from '../../worker/src/engine.js';
import { backup, dataOf, asOf, at, clone } from '../lib-data.mjs';

/* a small village that starts on Sunday 1 Nov 2026: Sun pull-ups, Mon dips, Tue pull-ups, Wed dips, Thu rest, Fri test, Sat rest */
const START = '2026-11-01';
const iso = (date, hh, mm = 0) => new Date(at(date, hh, mm)).toISOString();
function village(over){
  return {settings:Object.assign({v:1, name:'Test', startDate:START,
    exercises:{pullups:{name:'Pull-ups'}, dips:{name:'Dips'}},
    baseline:{pullups:{max:10, date:START}, dips:{max:20, date:START}},
    scheduleHistory:[{from:START, plan:clone(E.DEFAULT_PLAN), gtg:{sets:6, minSets:5, pct:50}, test:{sets:2, ex:['pullups','dips']}}], celebrated:0}, over || {}),
    days:{}, study:{}, body:{}, timer:{state:'idle'}};
}
const sets = (V, date, ex, reps, n, hour = 8) => { const d = V.days[date] || (V.days[date] = {date, sets:[]}); for(let i = 0; i < n; i++) d.sets.push({ex, reps, t:iso(date, hour + i, 5)}); };
const study = (V, date, min, src = 'timer', hour = 9) => { const d = V.study[date] || (V.study[date] = {date, entries:[]}); d.entries.push({start:iso(date, hour), end:new Date(at(date, hour) + min * 60000).toISOString(), min, src}); return d; };
const day = (C, d) => C.days.find(x => x.date === d);
/* one clean week: every groove day done with 5 sets, a full test with two new maxes */
function cleanWeek(){
  const V = village();
  sets(V, '2026-11-01', 'pullups', 5, 5); sets(V, '2026-11-02', 'dips', 10, 5); sets(V, '2026-11-03', 'pullups', 5, 5); sets(V, '2026-11-04', 'dips', 10, 5);
  V.days['2026-11-06'] = {date:'2026-11-06', sets:[{ex:'pullups', reps:11, t:iso('2026-11-06', 17)}, {ex:'pullups', reps:9, t:iso('2026-11-06', 17, 10)}, {ex:'dips', reps:21, t:iso('2026-11-06', 17, 20)}, {ex:'dips', reps:18, t:iso('2026-11-06', 17, 30)}]};
  return V;
}

test('groove day XP: +10 and 1 per rep at target, +50 complete, +20 for every planned set, under-target sets earn reps only', () => {
  const V = village(); sets(V, START, 'pullups', 5, 5);
  let C = E.compute(V, at(START, 20));
  assert.equal(C.today, START); assert.equal(C.todayRec.status, 'done'); assert.equal(C.todayRec.info.target, 5);
  assert.equal(C.todayRec.xp, 5 * 15 + 50); assert.equal(C.total, 125); assert.equal(C.streak, 1);
  sets(V, START, 'pullups', 5, 1, 14);
  assert.equal(E.compute(V, at(START, 20)).todayRec.xp, 6 * 15 + 50 + 20);
  const U = village(); sets(U, START, 'pullups', 4, 3); sets(U, START, 'pullups', 5, 2, 12);
  C = E.compute(U, at(START, 20));
  assert.equal(C.todayRec.status, 'open'); assert.equal(C.todayRec.info.q, 2); assert.equal(C.todayRec.xp, 3 * 4 + 2 * 15);
});

test('a missed groove day costs 100 XP and the streak; XP never goes below zero', () => {
  const V = village(); sets(V, START, 'pullups', 5, 5);
  const C = E.compute(V, at('2026-11-03', 9));
  assert.equal(day(C, '2026-11-02').status, 'missed'); assert.equal(day(C, '2026-11-02').xp, -100);
  assert.equal(C.total, 25); assert.equal(C.streak, 0); assert.equal(C.bestStreak, 1); assert.equal(C.missedCount, 1);
  assert.equal(C.todayRec.status, 'open');
  assert.equal(E.compute(village(), at('2026-11-04', 9)).total, 0, 'three missed days in a row stop at zero');
});

test('a clean week: test-day XP, new maxes, all four sensei challenges and the 7-day streak bonus add up exactly', () => {
  const V = cleanWeek(); V.body = {'2026-11-05':{date:'2026-11-05', weight:72}, '2026-11-07':{date:'2026-11-07', weight:72.4}};
  const C = E.compute(V, at('2026-11-07', 12));
  const xp = d => day(C, d).xp;
  assert.equal(xp('2026-11-01'), 125); assert.equal(xp('2026-11-02'), 150);
  assert.equal(xp('2026-11-03'), 125 + 60, 'Kakashi: the 15th set at target this week');
  assert.equal(xp('2026-11-04'), 150); assert.equal(xp('2026-11-05'), 10);
  assert.equal(xp('2026-11-06'), 2 * (11 + 9 + 21 + 18) + 100 + 75 + 75 + 100, 'test reps, completion, two new maxes, Guy');
  assert.equal(xp('2026-11-07'), 11 + 120 + 40, 'rest day at a 7-day streak (x1.1), Third Hokage, Jiraiya');
  assert.equal(C.total, 125 + 150 + 185 + 150 + 10 + 468 + 171);
  assert.equal(C.streak, 7); assert.deepEqual(C.maxes, {pullups:11, dips:21}); assert.deepEqual(C.best, {pullups:11, dips:21});
  assert.deepEqual(C.prs.map(p => [p.ex, p.v]), [['pullups', 11], ['dips', 21]]);
  assert.deepEqual(C.awards.map(a => a.key).sort(), ['guy', 'hiruzen', 'jiraiya', 'kakashi']);
  assert.equal(E.planFor(V.settings, '2026-11-08').type, 'gtg');
  assert.equal(E.gtgTarget(C.maxes.pullups, 50), 6, 'next week\'s pull-up sets rise with the new max');
  assert.equal(C.cleanWeeks, 0, 'the week is not over yet');
  assert.equal(E.compute(V, at('2026-11-08', 6)).cleanWeeks, 1);
});

test('ranks: thresholds are exact, and a rank once earned never drops', () => {
  assert.equal(E.rankFor(0), 0); assert.equal(E.rankFor(1499), 0); assert.equal(E.rankFor(1500), 1); assert.equal(E.rankFor(4999), 1);
  assert.equal(E.rankFor(77499), 12); assert.equal(E.rankFor(77500), 13); assert.equal(E.RANKS.length, 14);
  assert.deepEqual(E.RANKS.map(r => r.xp), [0, 1500, 5000, 10000, 16000, 22500, 29500, 37000, 45000, 53000, 61000, 68500, 73500, 77500]);
  const plan = clone(E.DEFAULT_PLAN); plan[0] = {type:'test'};
  const V = village({scheduleHistory:[{from:START, plan, gtg:{sets:6, minSets:5, pct:50}, test:{sets:1, ex:['pullups']}}]});
  V.days[START] = {date:START, sets:[{ex:'pullups', reps:700, t:iso(START, 9)}]};
  let C = E.compute(V, at(START, 10));
  assert.equal(C.total, 1400 + 100 + 75 + 100); assert.equal(C.peak, 1); assert.equal(C.rankNow, 1);
  C = E.compute(V, at('2026-11-05', 10));
  assert.equal(C.total, 1675 - 300 + 10); assert.equal(C.rankNow, 0, 'XP fell below the Genin line'); assert.equal(C.peak, 1, 'but the rank stays');
});

test('study: minimum, full scroll, missed, weekend targets and XP per half hour', () => {
  const V = village({studyStart:START});
  study(V, '2026-11-01', 240); study(V, '2026-11-02', 360); study(V, '2026-11-03', 200); study(V, '2026-11-06', 359); study(V, '2026-11-07', 480);
  const C = E.compute(V, at('2026-11-07', 22)), S = C.study, st = d => S.days[d];
  assert.equal(st('2026-11-01').status, 'done'); assert.equal(st('2026-11-01').xp, 8 * 20 + 50);
  assert.equal(st('2026-11-02').xp, 12 * 20 + 50 + 30, 'full scroll');
  assert.equal(st('2026-11-03').status, 'missed'); assert.equal(st('2026-11-03').xp, 6 * 20); assert.equal(st('2026-11-03').broke, true);
  assert.equal(st('2026-11-04').status, 'missed'); assert.equal(st('2026-11-04').broke, false, 'already broken');
  assert.equal(st('2026-11-05').status, 'rest', 'Thursday');
  assert.deepEqual(st('2026-11-06').tgt, {min:360, full:480}); assert.equal(st('2026-11-06').status, 'missed', '5h59 on a Friday is short of 6h');
  assert.equal(st('2026-11-07').status, 'done'); assert.equal(st('2026-11-07').xp, 16 * 20 + 50 + 30);
  assert.equal(S.streak, 1); assert.equal(S.best, 2);
  assert.equal(day(C, '2026-11-07').sxp, 400);
});

test('study: one shield a week protects the streak, a second does not, and a new week brings a new one', () => {
  const V = village({studyStart:START});
  study(V, '2026-11-01', 240); study(V, '2026-11-02', 30).shield = true; V.study['2026-11-03'] = {date:'2026-11-03', entries:[], shield:true};
  study(V, '2026-11-04', 240); V.study['2026-11-08'] = {date:'2026-11-08', entries:[], shield:true}; study(V, '2026-11-06', 360); study(V, '2026-11-07', 360);
  const S = E.compute(V, at('2026-11-09', 9)).study;
  assert.equal(S.days['2026-11-02'].status, 'shield'); assert.equal(S.days['2026-11-02'].xp, 20, 'shielded hours still earn XP');
  assert.equal(S.days['2026-11-03'].status, 'missed'); assert.equal(S.days['2026-11-08'].status, 'shield');
  assert.equal(S.streak, 3); assert.equal(S.weeks['2026-11-01'].shields, 1);
  /* reaching the minimum on a shielded day keeps the shield for later */
  study(V, '2026-11-02', 210, 'timer', 14);
  const S2 = E.compute(V, at('2026-11-09', 9)).study;
  assert.equal(S2.days['2026-11-02'].status, 'done'); assert.equal(S2.days['2026-11-03'].status, 'shield');
});

test('Thursday off-day study: no minimum, any study counts for the streak, 8 hours fills the scroll', () => {
  const V = village({studyStart:START});
  study(V, '2026-11-04', 240); study(V, '2026-11-05', 90);
  let S = E.compute(V, at('2026-11-05', 22)).study;
  assert.deepEqual(S.days['2026-11-05'].tgt, {min:0, full:480, off:true});
  assert.equal(S.days['2026-11-05'].status, 'done'); assert.equal(S.days['2026-11-05'].xp, 60); assert.equal(S.streak, 2);
  study(V, '2026-11-05', 390, 'timer', 12);
  assert.equal(E.compute(V, at('2026-11-05', 22)).study.days['2026-11-05'].xp, 16 * 20 + 30);
  const R = village({studyStart:START}); R.study['2026-11-05'] = {date:'2026-11-05', entries:[], offday:true};
  S = E.compute(R, at('2026-11-06', 9)).study;
  assert.equal(S.days['2026-11-05'].status, 'rest', 'an off day that was opened but not used is still a rest day');
});

test('Scholar\'s week: 30 study hours in a Sunday-to-Saturday week earn 400 XP once, on the day it is reached', () => {
  const V = village({studyStart:START});
  ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].forEach(d => study(V, d, 360)); study(V, '2026-11-06', 359); study(V, '2026-11-07', 60);
  let C = E.compute(V, at('2026-11-07', 22));
  assert.equal(C.study.weeks[START].mins, 1859); assert.equal(C.study.days['2026-11-06'].award, 0);
  assert.equal(C.study.days['2026-11-07'].award, 400); assert.equal(C.study.days['2026-11-07'].xp, 2 * 20 + 400);
  assert.deepEqual(C.awards.filter(a => a.key === 'study').map(a => a.date), ['2026-11-07']);
});

test('combos: a set within an hour after a finished study hour earns +10, once per hour', () => {
  const V = village({studyStart:START});
  study(V, START, 120, 'timer', 9);                                    // hours completed at 10:00 and 11:00
  V.days[START] = {date:START, sets:[{ex:'pullups', reps:5, t:iso(START, 10, 30)}, {ex:'pullups', reps:5, t:iso(START, 10, 40)}, {ex:'pullups', reps:5, t:iso(START, 12, 1)}]};
  let C = E.compute(V, at(START, 12, 30));
  assert.equal(C.todayRec.info.combo, 1, '10:30 matches the 10:00 hour; 10:40 is before 11:00; 12:01 is too late for the 11:00 hour');
  assert.equal(C.todayRec.xp, 3 * 15 + 10);
  V.days[START].sets.push({ex:'pullups', reps:5, t:iso(START, 11, 59)});
  assert.equal(E.compute(V, at(START, 12, 30)).todayRec.info.combo, 2);
  /* a manual entry counts its hours at the moment it was logged */
  const M = village({studyStart:START}); study(M, START, 60, 'manual', 9);
  M.days[START] = {date:START, sets:[{ex:'pullups', reps:5, t:iso(START, 9, 30)}]};
  assert.equal(E.compute(M, at(START, 12)).todayRec.info.combo, 0, 'the hour was only logged at 10:00');
  C = E.compute(M, at(START, 10, 20));
  assert.equal(C.readyUntil, at(START, 11), 'a set is "ready" until an hour after the study hour');
  assert.equal(E.compute(M, at(START, 11, 1)).readyUntil, 0);
});

test('exam week: streaks are frozen (not broken, not grown), rest days earn nothing, work still earns XP', () => {
  const V = cleanWeek(); V.settings.studyStart = START; V.settings.examWeeks = [{start:'2026-11-08', end:'2026-11-14'}];
  ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].forEach(d => study(V, d, 240)); study(V, '2026-11-06', 360); study(V, '2026-11-07', 360);
  sets(V, '2026-11-09', 'dips', 11, 2); study(V, '2026-11-09', 60); sets(V, '2026-11-10', 'pullups', 6, 5); study(V, '2026-11-10', 240);
  const C = E.compute(V, at('2026-11-16', 9)), S = C.study;
  assert.equal(day(C, '2026-11-08').status, 'exam'); assert.equal(day(C, '2026-11-08').xp, 0);
  assert.equal(day(C, '2026-11-09').status, 'exam'); assert.equal(day(C, '2026-11-09').xp, 2 * 21, 'two dip sets at the new target of 11');
  assert.equal(day(C, '2026-11-10').status, 'done', 'a finished mission in exam week still counts'); assert.equal(day(C, '2026-11-10').streak, 8);
  assert.equal(day(C, '2026-11-12').status, 'exam'); assert.equal(day(C, '2026-11-12').xp, 0, 'a rest day in exam week earns nothing');
  assert.equal(day(C, '2026-11-15').status, 'missed', 'the day after exam week is a normal day again');
  assert.equal(day(C, '2026-11-14').streak, 8, 'frozen through the week');
  assert.equal(S.days['2026-11-08'].status, 'exam'); assert.equal(S.days['2026-11-09'].xp, 40); assert.equal(S.days['2026-11-10'].status, 'done');
  assert.equal(S.days['2026-11-14'].streak, 7); assert.equal(S.days['2026-11-15'].status, 'missed');
  assert.equal(C.missedCount, 1);
});

test('exam week over a shielded day: the day is an exam day and the week\'s shield is still unused', () => {
  const V = village({studyStart:START, examWeeks:[{start:'2026-11-02', end:'2026-11-03'}]});
  study(V, START, 240); V.study['2026-11-02'] = {date:'2026-11-02', entries:[], shield:true}; V.study['2026-11-04'] = {date:'2026-11-04', entries:[], shield:true};
  const S = E.compute(V, at('2026-11-05', 9)).study;
  assert.equal(S.days['2026-11-02'].status, 'exam'); assert.equal(S.days['2026-11-03'].status, 'exam');
  assert.equal(S.days['2026-11-04'].status, 'shield'); assert.equal(S.weeks[START].shields, 1); assert.equal(S.streak, 1);
});

test('midnight in Baghdad: the day turns at 00:00 local time, and an unfinished mission becomes missed', () => {
  const V = village(); sets(V, START, 'pullups', 5, 4);
  const before = E.compute(V, at(START, 23, 59) + 59000), after = E.compute(V, at('2026-11-02', 0, 0) + 1000);
  assert.equal(before.today, START); assert.equal(before.todayRec.status, 'open'); assert.equal(before.total, 60);
  assert.equal(after.today, '2026-11-02'); assert.equal(day(after, START).status, 'missed'); assert.equal(day(after, START).xp, 60 - 100); assert.equal(after.total, 0);
  assert.equal(after.todayRec.plan.ex, 'dips');
  assert.equal(E.dateAt(Date.parse('2026-11-01T20:59:59Z')), START, '23:59:59 in Baghdad');
  assert.equal(E.dateAt(Date.parse('2026-11-01T21:00:00Z')), '2026-11-02', '00:00:00 in Baghdad');
  assert.equal(E.weekStart('2026-11-07'), START); assert.equal(E.weekStart('2026-11-08'), '2026-11-08');
  assert.equal(E.addDays('2026-12-31', 1), '2027-01-01'); assert.equal(E.daysBetween('2026-02-27', '2026-03-01'), 2);
});

test('study timer across midnight: each day gets its own minutes, and the 3-hour check caps an unattended timer', () => {
  const V = village({studyStart:START});
  V.timer = {state:'running', segStart:at(START, 23, 30), checkAt:at(START, 23, 30) + 3 * 3600000, sessionMs:0};
  let S = E.compute(V, at('2026-11-02', 0, 45)).study;
  assert.equal(S.days[START].mins, 30); assert.equal(S.days['2026-11-02'].mins, 45);
  assert.equal(S.days[START].status, 'missed', 'yesterday closed at midnight with what had been studied by then');
  S = E.compute(V, at('2026-11-02', 9)).study;
  assert.equal(S.days['2026-11-02'].mins, 150, 'only up to the 3-hour check at 02:30');
  assert.deepEqual(E.splitByDay(at(START, 23, 30), at('2026-11-02', 0, 45)).map(p => [p.date, (p.end - p.start) / 60000]), [[START, 30], ['2026-11-02', 45]]);
  V.study[START] = {date:START, entries:[{start:iso(START, 8), end:iso(START, 11, 30), min:210, src:'timer'}]};
  assert.equal(E.compute(V, at('2026-11-02', 0, 45)).study.days[START].status, 'done', '3h30 logged + 30 live minutes before midnight');
});

test('a plan change that starts tomorrow never touches today or the past', () => {
  const V = cleanWeek();
  const before = E.compute(V, at('2026-11-07', 12));
  const plan = clone(E.DEFAULT_PLAN); plan[0] = {type:'rest'}; plan[6] = {type:'combo', exs:['pullups','dips']};
  V.settings.scheduleHistory = V.settings.scheduleHistory.concat([{from:'2026-11-08', plan, gtg:{sets:8, minSets:7, pct:60}, combo:{sets:2}, test:{sets:3, ex:['pullups']}, study:{week:{min:300, full:420}, end:{min:360, full:480}}}]);
  const after = E.compute(V, at('2026-11-07', 12));
  assert.deepEqual(after.days.map(d => [d.date, d.status, d.xp]), before.days.map(d => [d.date, d.status, d.xp]));
  assert.equal(after.total, before.total); assert.equal(after.todayRec.plan.type, 'rest');
  assert.equal(E.planFor(V.settings, '2026-11-07').type, 'rest'); assert.equal(E.planFor(V.settings, '2026-11-08').type, 'rest');
  assert.equal(E.planFor(V.settings, '2026-11-14').type, 'combo'); assert.equal(E.planFor(V.settings, '2026-11-09').gtg.pct, 60);
  assert.deepEqual(E.studyTarget(V.settings, '2026-11-04'), {min:240, full:360}); assert.deepEqual(E.studyTarget(V.settings, '2026-11-09'), {min:300, full:420});
  assert.equal(E.studyTarget(V.settings, '2026-11-12'), null);
  /* mixed day: every set of both, 110 XP for the planned sets, +70 complete */
  sets(V, '2026-11-14', 'pullups', 7, 2); sets(V, '2026-11-14', 'dips', 13, 2, 12);
  const C = E.compute(V, at('2026-11-14', 20)), t = C.todayRec;
  assert.equal(t.plan.type, 'combo'); assert.deepEqual(t.info.parts.map(p => p.target), [7, 13]); assert.equal(t.status, 'done');
  assert.equal(t.base, 2 * 17 + 2 * 23 + 70);
});

test('plans that could never be completed are playable: more than 10 sets a day, and a test day with nothing to test', () => {
  const V = village({scheduleHistory:[{from:START, plan:clone(E.DEFAULT_PLAN), gtg:{sets:12, minSets:11, pct:50}, test:{sets:2, ex:[]}}]});
  sets(V, START, 'pullups', 5, 12, 6);
  let C = E.compute(V, at(START, 22));
  assert.equal(C.todayRec.info.q, 12); assert.equal(C.todayRec.status, 'done'); assert.equal(C.todayRec.xp, 12 * 15 + 50 + 20);
  C = E.compute(V, at('2026-11-07', 9));
  assert.equal(day(C, '2026-11-06').plan.type, 'rest', 'a test day with no exercises ticked is a rest day, not a guaranteed miss');
  assert.equal(day(C, '2026-11-06').status, 'rest');
  /* the normal cap is unchanged: with 6 planned sets only the first 10 count */
  const N = village(); sets(N, START, 'pullups', 5, 13, 6);
  assert.equal(E.compute(N, at(START, 22)).todayRec.xp, 10 * 15 + 50 + 20);
});

test('damaged data never crashes the engine', () => {
  const V = village({studyStart:START, examWeeks:[null, {start:'2026-11-20'}, 'x'], scheduleHistory:[null, {from:START, plan:[{type:'gtg', ex:'pullups'}, {type:'banana'}, null, {type:'combo'}, {type:'gtg', ex:'ghost'}], gtg:{sets:'six'}, test:null}]});
  V.days = {[START]:{date:START, sets:{0:'x'}}, '2026-11-02':{sets:[null, 'x', {ex:'dips'}, {ex:'pullups', reps:'5', t:'never'}, {ex:5, reps:5}]}, '2026-11-03':null};
  V.study = {[START]:{entries:'no'}, '2026-11-02':{entries:[null, {min:'90'}, {min:-50, end:'x'}, {start:iso('2026-11-02', 9), end:iso('2026-11-02', 10), min:60, src:'timer'}]}};
  V.body = {a:null, b:{weight:'70'}, '2026-11-02':{date:'2026-11-02', weight:70}};
  V.timer = {state:'running', segStart:'yesterday', checkAt:null};
  const C = E.compute(V, at('2026-11-04', 9));
  assert.equal(C.days.length, 4); assert.equal(day(C, '2026-11-02').plan.type, 'rest'); assert.equal(day(C, '2026-11-03').plan.type, 'rest');
  assert.equal(C.totalReps.pullups, 5); assert.equal(C.study.days['2026-11-02'].mins, 150); assert.equal(C.weight, 70);
  assert.ok(Number.isFinite(C.total));
  assert.doesNotThrow(() => E.compute({}, at(START, 9)));
  assert.doesNotThrow(() => E.compute({settings:{startDate:'soon', studyStart:'2026-13-45', exercises:[], scheduleHistory:'x'}}, at(START, 9)));
  assert.equal(E.isDate('2026-02-30'), false); assert.equal(E.isDate('2026-02-28'), true);
});

test('streak story: when a streak broke, and the comeback when it is rebuilt to 7', () => {
  const V = village();
  const C0 = E.compute(cleanWeek(), at('2026-11-07', 12));
  assert.deepEqual(E.streakStory(C0), {broke:null, comeback:null, ever:false, first:null});
  sets(V, START, 'pullups', 5, 5);                                    // done, then Monday missed
  sets(V, '2026-11-03', 'pullups', 5, 5); sets(V, '2026-11-04', 'dips', 10, 5);
  ['2026-11-08', '2026-11-10'].forEach(d => sets(V, d, 'pullups', 6, 5)); sets(V, '2026-11-09', 'dips', 11, 5);   // targets rose with Friday's new maxes
  V.days['2026-11-06'] = cleanWeek().days['2026-11-06'];
  let st = E.streakStory(E.compute(V, at('2026-11-08', 20)));
  assert.deepEqual(st.broke, {date:'2026-11-02', kind:'workout'}); assert.equal(st.comeback, null);
  st = E.streakStory(E.compute(V, at('2026-11-09', 20)));
  assert.deepEqual(st.comeback, {date:'2026-11-09', kind:'workout', since:'2026-11-02'}); assert.equal(st.ever, true); assert.equal(st.first, '2026-11-09');
});

/* ---------- the Worker's copy of the rules ---------- */
const FIX = dataOf(backup());
function agree(data, now, label){
  const A = E.compute(data, now), W = computeAll(data, now);
  assert.equal(A.today, W.today, label);
  ['total', 'peak', 'rankNow', 'streak', 'bestStreak', 'doneCount', 'missedCount'].forEach(k => assert.equal(A[k], W[k], `${label} ${k}`));
  assert.deepEqual(A.maxes, W.maxes, label); assert.deepEqual(A.best, W.best, label); assert.deepEqual(A.totalReps, W.totalReps, label);
  assert.deepEqual(A.days.map(d => [d.date, d.plan.type, d.status, d.xp, d.streak, d.info.combo]), W.days.map(d => [d.date, d.plan.type, d.status, d.xp, d.streak, d.info.combo]), label);
  assert.deepEqual(A.study.list.map(r => [r.date, r.status, r.mins, r.xp]), W.study.list.map(r => [r.date, r.status, r.mins, r.xp]), label);
  assert.deepEqual(A.awards.map(a => [a.key, a.date, a.xp]), W.awards.map(a => [a.key, a.date, a.xp]), label);
  assert.deepEqual(A.prs.map(p => [p.date, p.ex, p.v]), W.prs.map(p => [p.date, p.ex, p.v]), label);
  assert.equal(A.study.streak, W.study.streak, label); assert.equal(A.study.best, W.study.best, label);
  return A;
}
test('the Worker\'s engine and the app\'s engine agree on every day of the ten-week history, four times a day', () => {
  for(let d = '2026-09-06'; d <= '2026-11-16'; d = E.addDays(d, 1)){
    [[0, 0], [5, 40], [17, 40], [23, 59]].forEach(([h, m]) => { const now = at(d, h, m); agree(asOf(FIX, now), now, `${d} ${h}:${m}`); });
  }
});
test('the ten-week history adds up to the same village every time', () => {
  const C = agree(FIX, at('2026-11-15', 10), 'fixture');
  assert.equal(C.total, 23457); assert.equal(C.peak, 5); assert.equal(C.streak, 1); assert.equal(C.bestStreak, 27);
  assert.equal(C.doneCount, 40); assert.equal(C.missedCount, 5); assert.equal(C.study.best, 32);
  assert.deepEqual(C.maxes, {pullups:15, dips:26}); assert.equal(C.prs.length, 11);
  assert.equal(E.RANKS[C.peak].name, 'ANBU');
});
test('the two engines agree with a study timer running over midnight, and on the fixed rules', () => {
  const data = clone(FIX); data.timer = {state:'running', segStart:at('2026-11-11', 22, 10), checkAt:at('2026-11-11', 22, 10) + 3 * 3600000, sessionMs:0};
  [at('2026-11-11', 23, 30), at('2026-11-12', 0, 20), at('2026-11-12', 6)].forEach(now => agree(asOf(data, now), now, 'timer ' + now));
  const V = village({scheduleHistory:[{from:START, plan:clone(E.DEFAULT_PLAN), gtg:{sets:12, minSets:11, pct:50}, test:{sets:2, ex:[]}}]});
  sets(V, START, 'pullups', 5, 12, 6);
  agree(V, at('2026-11-08', 9), 'long plan');
  const X = cleanWeek(); X.settings.studyStart = START; X.settings.examWeeks = [{start:'2026-11-08', end:'2026-11-14'}]; study(X, '2026-11-09', 60); sets(X, '2026-11-09', 'dips', 11, 2);
  agree(X, at('2026-11-16', 9), 'exam week');
});
