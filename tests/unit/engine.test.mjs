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
  assert.deepEqual(Object.values(A.weeks).filter(w => w.rival).map(w => [w.start, w.rival.win, w.rival.wins]), Object.values(W.weeks).filter(w => w.rival).map(w => [w.start, w.rival.win, w.rival.wins]), label);
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
  const R = raceVillage([5, 5, 5, 5, 6, 5], [240, 240, 240, 240, 300, 240], {examWeeks:[{start:'2026-12-14', end:'2026-12-15'}]});
  agree(R, at('2026-12-21', 9), 'race week with exam days');
});

/* ---------- monthly report, achievements, chapters ---------- */
test('monthly report: a hand-checked week adds up, and the fixture months tell the same story every time', () => {
  const V = cleanWeek(); V.settings.studyStart = START; study(V, '2026-11-01', 240); study(V, '2026-11-02', 400); study(V, '2026-11-03', 100);
  V.body = {'2026-11-05':{date:'2026-11-05', weight:72}, '2026-11-07':{date:'2026-11-07', weight:72.4}};
  const C = E.compute(V, at('2026-11-07', 22)), R = E.monthReport(C, '2026-11');
  assert.equal(R.label, 'November 2026'); assert.equal(R.complete, false);
  assert.deepEqual(R.missions, {done:5, missed:0, rest:2, exam:0, open:0});
  assert.deepEqual(R.reps, {pullups:5 * 5 * 2 + 20, dips:10 * 5 * 2 + 39});
  assert.deepEqual(R.maxes, [{ex:'pullups', from:10, to:11}, {ex:'dips', from:20, to:21}]);
  assert.equal(R.prs.length, 2); assert.equal(R.awards, 4); assert.equal(R.bestStreak, 7);
  assert.equal(R.xp, C.total, 'everything earned so far was earned this month');
  assert.equal(R.study.mins, 740); assert.deepEqual(R.study.best, {date:'2026-11-02', mins:400});
  assert.equal(R.study.daysMin, 2); assert.equal(R.study.daysFull, 1); assert.equal(R.study.missed, 3, 'Tue, Wed and Fri fell short');
  assert.deepEqual(R.weight, {from:72, to:72.4, n:2});
  assert.equal(R.rankFrom, 0); assert.equal(R.rankTo, E.rankFor(C.total));
  assert.equal(E.monthReport(C, '2026-10'), null, 'no report for a month before the village began');
  const F = E.compute(FIX, at('2026-11-15', 10)), oct = E.monthReport(F, '2026-10');
  assert.deepEqual(oct.missions, {done:15, missed:1, rest:8, exam:7, open:0}); assert.equal(oct.xp, 12095);
  assert.equal(oct.study.mins, 7035); assert.deepEqual(oct.reps, {pullups:327, dips:523});
  assert.deepEqual(oct.maxes, [{ex:'pullups', from:11, to:15}, {ex:'dips', from:22, to:26}]);
  assert.equal(oct.rankFrom, 2); assert.equal(oct.rankTo, 4); assert.equal(oct.complete, true); assert.equal(oct.title, 'Rise of the Jonin');
  assert.ok(oct.summary.length >= 3 && oct.summary.every(t => typeof t === 'string' && t.length > 20));
  const ch = E.chapters(F);
  assert.deepEqual(ch.map(c => [c.n, c.ym, c.complete]), [[1, '2026-09', true], [2, '2026-10', true], [3, '2026-11', false]]);
  assert.equal(ch.reduce((n, c) => n + c.report.xp, 0), F.total, 'the months add up to the total XP');
});

test('chapter titles follow what happened in the month', () => {
  const base = {missions:{done:10, missed:0, rest:8, exam:0, open:0}, study:{mins:3000, missed:0, daysMin:20, days:20}, prs:[], complete:true, promoted:false, comeback:false, exam:false, rankTo:3, rankFrom:3};
  const t = over => E.chapterTitle(Object.assign({}, base, over));
  assert.equal(t({}), 'The Unbroken Month');
  assert.equal(t({promoted:true, rankTo:4}), 'Rise of the Jonin'); assert.equal(t({promoted:true, rankTo:13}), 'The Village Has a Hokage');
  assert.equal(t({comeback:true, missions:Object.assign({}, base.missions, {missed:1})}), 'Back from the Brink');
  assert.equal(t({complete:false, prs:[1, 2]}), 'Breaking Limits'); assert.equal(t({complete:false, prs:[1]}), 'A New Record');
  assert.equal(t({complete:false, exam:true}), 'Trial by Exams');
  assert.equal(t({missions:Object.assign({}, base.missions, {missed:7})}), 'Storm Season');
  assert.equal(t({missions:Object.assign({}, base.missions, {missed:2})}), 'Stumble and Rise');
  assert.equal(t({complete:false}), 'Steady Steps');
});

test('achievements: each is earned on the right day, and the old seventeen still mean what they meant', () => {
  const C = E.compute(FIX, at('2026-11-15', 10)), A = Object.fromEntries(E.achievements(C).map(a => [a.id, a.date]));
  assert.equal(E.ACHIEVEMENTS.length, 35); assert.equal(new Set(E.ACHIEVEMENTS.map(a => a.id)).size, 35);
  ['first', 's7', 's30', 's100', 'pr', 'clean', 'p10', 'p15', 'p20', 'd25', 'd30', 'd40', 'tp1k', 'td2k', 'scale', 'genin', 'comeback'].forEach(id => assert.ok(id in A, `${id} is still there`));
  assert.equal(A.first, '2026-09-06'); assert.equal(A.p10, '2026-09-06', 'the starting max already counts');
  assert.equal(A.s7, '2026-09-12'); assert.equal(A.s30, null); assert.equal(A.clean, '2026-09-12');
  assert.equal(A.pr, C.prs[0].date); assert.equal(A.p15, C.prs.find(p => p.ex === 'pullups' && p.v >= 15).date);
  assert.equal(A.genin, C.days.find(d => d.peak >= 1).date); assert.equal(A.scale, C.body[3].date);
  assert.equal(A.sh100, '2026-10-17'); assert.equal(A.sh500, null); assert.equal(A.scholar, '2026-09-26'); assert.equal(A.ss30, '2026-11-09');
  assert.equal(A.comeback, E.streakStory(C).first); assert.equal(A.hokage, null); assert.equal(A.month, null);
  /* the same checks the old Scroll library made */
  assert.equal(!!A.s7, C.bestStreak >= 7); assert.equal(!!A.tp1k, C.totalReps.pullups >= 1000); assert.equal(!!A.d25, C.best.dips >= 25); assert.equal(!!A.d30, C.best.dips >= 30);
  /* a perfect calendar month, a full study week, the dawn set and the off-day scroll */
  const V = village({startDate:'2026-10-25', studyStart:'2026-10-25', baseline:{pullups:{max:10, date:'2026-10-25'}, dips:{max:20, date:'2026-10-25'}}, scheduleHistory:[{from:'2026-10-25', plan:E.DEFAULT_PLAN.map(p => p.type === 'test' ? {type:'rest'} : p), gtg:{sets:6, minSets:5, pct:50}, test:{sets:2, ex:['pullups','dips']}}]});
  for(let d = '2026-10-25'; d <= '2026-11-30'; d = E.addDays(d, 1)){
    const p = E.planFor(V.settings, d); if(p.type === 'gtg') sets(V, d, p.ex, p.ex === 'pullups' ? 5 : 10, 5, d === '2026-11-03' ? 4 : 8);
    const w = E.dowOf(d); if(w !== 4) study(V, d, (w === 5 || w === 6) ? 480 : 360); else if(d === '2026-11-12') study(V, d, 480);
  }
  const P = E.compute(V, at('2026-12-01', 9)), B = Object.fromEntries(E.achievements(P).map(a => [a.id, a.date]));
  assert.equal(B.month, '2026-11-30'); assert.equal(B.fullweek, '2026-10-31'); assert.equal(B.dawn, '2026-11-03'); assert.equal(B.offday8, '2026-11-12');
  assert.equal(B.s30, '2026-11-23'); assert.equal(B.ss30, '2026-11-27');
  assert.equal(E.monthsOf(P)['2026-11'].perfect, true); assert.match(E.monthReport(P, '2026-11').title, /^Rise of the /, 'a promotion names the chapter first');
  assert.equal(E.monthsOf(P)['2026-10'].perfect, false, 'October was not lived in full');
});

/* ---------- auto-progression ---------- */
test('auto-progression: the suggestion after a test follows the week that led to it', () => {
  const fri = (V, pu, di) => { V.days['2026-11-06'] = {date:'2026-11-06', sets:[{ex:'pullups', reps:pu, t:iso('2026-11-06', 17)}, {ex:'pullups', reps:pu - 2, t:iso('2026-11-06', 17, 10)}, {ex:'dips', reps:di, t:iso('2026-11-06', 17, 20)}, {ex:'dips', reps:di - 2, t:iso('2026-11-06', 17, 30)}]}; };
  const week = n => { const V = village(); [['2026-11-01', 'pullups', 5], ['2026-11-02', 'dips', 10], ['2026-11-03', 'pullups', 5], ['2026-11-04', 'dips', 10]].forEach(([d, ex, r], i) => { if(i < n) sets(V, d, ex, r, 6); }); return V; };
  const P = (V, when) => E.progression(E.compute(V, when || at('2026-11-06', 20)));
  assert.equal(P(week(4)), null, 'nothing to suggest before the test is finished');
  let V = week(4); fri(V, 11, 21); let p = P(V);
  assert.equal(p.why, 'rise'); assert.equal(p.changed, false); assert.deepEqual(p.next, {sets:6, minSets:5, pct:50});
  assert.deepEqual(p.targets, [{ex:'pullups', before:5, after:6}, {ex:'dips', before:10, after:11}]); assert.equal(p.from, '2026-11-07');
  V = week(4); fri(V, 10, 20); p = P(V);
  assert.equal(p.why, 'push'); assert.deepEqual(p.next, {sets:6, minSets:5, pct:55}); assert.equal(p.changed, true);
  assert.deepEqual(p.targets, [{ex:'pullups', before:5, after:6}, {ex:'dips', before:10, after:11}]);
  V = week(2); fri(V, 10, 20); p = P(V);
  assert.equal(p.why, 'ease'); assert.equal(p.done, 2); assert.equal(p.judged, 4); assert.deepEqual(p.next, {sets:5, minSets:4, pct:50});
  V = week(4); fri(V, 9, 20); p = P(V);
  assert.equal(p.why, 'down'); assert.deepEqual(p.next, {sets:6, minSets:5, pct:45});
  V = week(3); fri(V, 10, 20); p = P(V);
  assert.equal(p.why, 'hold'); assert.equal(p.changed, false);
  /* at the ceiling for the share of max, the push adds a set instead; and nothing goes past the limits */
  V = week(4); V.settings.scheduleHistory[0].gtg = {sets:6, minSets:5, pct:60}; ['2026-11-01', '2026-11-03'].forEach(d => { V.days[d].sets.forEach(x => { x.reps = 6; }); }); ['2026-11-02', '2026-11-04'].forEach(d => { V.days[d].sets.forEach(x => { x.reps = 12; }); });
  fri(V, 10, 20); p = P(V);
  assert.equal(p.why, 'push'); assert.deepEqual(p.next, {sets:7, minSets:6, pct:60});
  /* the answer is remembered, and the card is gone a week later */
  V = week(4); fri(V, 10, 20); V.settings.progression = {test:'2026-11-06', choice:'kept'};
  assert.equal(P(V).answered, 'kept');
  V = week(4); fri(V, 10, 20);
  assert.equal(P(V, at('2026-11-12', 9)).why, 'push'); assert.equal(P(V, at('2026-11-13', 9)), null);
});

/* ---------- exam countdown ---------- */
test('exam countdown: days left, hours banked since it was set, and when to suggest the exam-week pass', () => {
  const V = village({studyStart:START, exam:{name:'Finals', date:'2026-11-20', since:'2026-11-03'}});
  study(V, '2026-11-02', 300); study(V, '2026-11-03', 240); study(V, '2026-11-04', 90); study(V, '2026-11-06', 400);
  const X = when => E.examCountdown(E.compute(V, when));
  let x = X(at('2026-11-06', 20));
  assert.equal(x.name, 'Finals'); assert.equal(x.days, 14); assert.equal(x.final, true); assert.equal(x.passed, false);
  assert.equal(x.banked, 730, 'only hours since it was set'); assert.equal(x.suggestPass, false, 'more than a week away');
  assert.equal(X(at('2026-11-05', 9)).final, false, '15 days is not yet the final stretch');
  x = X(at('2026-11-13', 9)); assert.equal(x.days, 7); assert.equal(x.suggestPass, true);
  V.settings.examWeeks = [{start:'2026-11-15', end:'2026-11-21'}];
  assert.equal(X(at('2026-11-13', 9)).suggestPass, false, 'a pass already covers it');
  V.settings.examWeeks = [{start:'2026-11-01', end:'2026-11-02'}];
  assert.equal(X(at('2026-11-13', 9)).suggestPass, false, 'this month\'s pass is used');
  assert.equal(X(at('2026-11-20', 7)).days, 0); assert.equal(X(at('2026-11-21', 7)).passed, true);
  assert.equal(E.examCountdown(E.compute(village({exam:{name:'x', date:'soon'}}), at(START, 9))), null);
  assert.equal(E.examCountdown(E.compute(village(), at(START, 9))), null);
});

/* ---------- shadow clone rival ---------- */
/* six weeks from Sunday 15 Nov 2026 (the first week the race counts). perDay(week, date) says how many sets and study minutes */
function raceVillage(setsIn, minsIn, over){
  const S0 = '2026-11-15';
  const V = village(Object.assign({startDate:S0, studyStart:S0, baseline:{pullups:{max:10, date:S0}, dips:{max:20, date:S0}},
    scheduleHistory:[{from:S0, plan:E.DEFAULT_PLAN.map(p => p.type === 'test' ? {type:'rest'} : p), gtg:{sets:6, minSets:5, pct:50}, test:{sets:2, ex:['pullups','dips']}}]}, over || {}));
  for(let w = 0; w < 6; w++) for(let k = 0; k < 7; k++){
    const d = E.addDays(S0, w * 7 + k), p = E.planFor(V.settings, d);
    if(p.type === 'gtg' && setsIn[w]) sets(V, d, p.ex, p.ex === 'pullups' ? 5 : 10, setsIn[w]);
    if(k !== 4 && minsIn[w]) study(V, d, (k === 5 || k === 6) ? minsIn[w] + 120 : minsIn[w]);
  }
  return V;
}
test('shadow clone: a finished week races the week four weeks earlier; two wins of three earn +50 on that Saturday, from Sunday on', () => {
  const V = raceVillage([5, 5, 5, 5, 6, 5], [240, 240, 240, 240, 300, 240]);
  const sat = '2026-12-19', before = E.compute(V, at(sat, 23, 30)), after = E.compute(V, at('2026-12-20', 0, 30));
  assert.equal(day(before, sat).rival, 0, 'no result while the week is still running');
  assert.equal(day(after, sat).rival, 50); assert.equal(day(after, sat).xp, day(before, sat).xp + 50);
  assert.deepEqual(after.weeks['2026-12-13'].rival, {win:true, wins:3, losses:0});
  /* the first four weeks have nobody to race */
  ['2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06'].forEach(w => assert.equal(after.weeks[w].rival, null, w));
  const base = E.compute(raceVillage([5, 5, 5, 5, 6, 5], [240, 240, 240, 240, 300, 240]), at('2026-12-19', 23, 30));
  assert.equal(after.days.filter(d => d.date <= sat).reduce((n, d) => n + d.rival, 0), 50, 'exactly one bonus');
  assert.equal(base.total + 50 + after.todayRec.gain, after.total);
  /* same reps and study, so only XP differs (the streak multiplier is higher by week 5): 1 win, 2 level = no bonus */
  let C = E.compute(raceVillage([5, 5, 5, 5, 5, 5], [240, 240, 240, 240, 240, 240]), at('2026-12-21', 9));
  assert.deepEqual(C.weeks['2026-12-13'].rival, {win:false, wins:1, losses:0}); assert.equal(day(C, sat).rival, 0);
  /* fewer sets and less study: the clone wins */
  C = E.compute(raceVillage([6, 5, 5, 5, 0, 5], [300, 240, 240, 240, 100, 240]), at('2026-12-21', 9));
  assert.deepEqual(C.weeks['2026-12-13'].rival, {win:false, wins:0, losses:3});
  /* an exam week on either side: no race */
  C = E.compute(raceVillage([5, 5, 5, 5, 6, 5], [240, 240, 240, 240, 300, 240], {examWeeks:[{start:'2026-12-14', end:'2026-12-15'}]}), at('2026-12-21', 9));
  assert.equal(C.weeks['2026-12-13'].rival, null); assert.equal(day(C, sat).rival, 0);
  /* weeks before the rule arrived never race */
  const F = E.compute(FIX, at('2026-11-15', 10));
  assert.ok(Object.values(F.weeks).every(w => !w.rival)); assert.ok(F.days.every(d => d.rival === 0));
  assert.equal(E.raceResult({start:'2026-11-08', days:7, xp:9, repsAll:9, mins:9}, {start:'2026-10-11', days:7, xp:1, repsAll:1, mins:1}), null);
});
test('shadow clone card: weekday by weekday against four weeks ago, and last week\'s result on Sunday', () => {
  const V = raceVillage([5, 5, 5, 5, 6, 5], [240, 240, 240, 240, 300, 240]);
  let R = E.rival(E.compute(V, at('2026-12-16', 21)));                        // Wednesday of the race week
  assert.equal(R.on, true); assert.equal(R.week, '2026-12-13'); assert.equal(R.clone, '2026-11-15'); assert.equal(R.day, 3);
  assert.equal(R.me.repsAll, 6 * 5 + 6 * 10 + 6 * 5 + 6 * 10); assert.equal(R.them.repsAll, 5 * 5 + 5 * 10 + 5 * 5 + 5 * 10);
  assert.equal(R.me.mins, 4 * 300); assert.equal(R.them.mins, 4 * 240); assert.equal(R.themWeek.mins, 4 * 240 + 2 * 360);
  assert.ok(R.me.xp > R.them.xp); assert.equal(R.last, null);
  R = E.rival(E.compute(V, at('2026-12-20', 9)));
  assert.deepEqual(R.last, {week:'2026-12-13', xp:50, win:true, wins:3, losses:0}); assert.equal(R.day, 0); assert.equal(R.on, true);
  assert.equal(E.rival(E.compute(V, at('2026-11-18', 9))).on, false, 'no clone in the first four weeks');
  assert.equal(E.rival(E.compute(FIX, at('2026-11-10', 9))).why, 'soon');
  const X = raceVillage([5, 5, 5, 5, 6, 5], [240, 240, 240, 240, 300, 240], {examWeeks:[{start:'2026-12-14', end:'2026-12-15'}]});
  assert.equal(E.rival(E.compute(X, at('2026-12-16', 9))).why, 'exam');
});
test('the Worker credits the same shadow clone bonus, also when it resumes from a checkpoint', () => {
  const V = raceVillage([5, 5, 5, 5, 6, 6], [240, 240, 240, 240, 300, 300]);
  ['2026-12-19', '2026-12-20', '2026-12-26', '2026-12-27', '2026-12-30'].forEach(d => { const now = at(d, 12); agree(asOf(V, now), now, 'race ' + d); });
  const now = at('2026-12-28', 9), full = computeAll(V, now);
  assert.deepEqual(Object.values(full.weeks).filter(w => w.rival && w.rival.win).map(w => w.start), ['2026-12-13', '2026-12-20']);
  const cp = computeAll(V, now, {until:'2026-12-12'}).state;
  assert.equal(cp.tail.length, 4); assert.deepEqual(cp.tail.map(w => w.start), ['2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06']);
  const recent = clone(V); ['days', 'study', 'body'].forEach(k => Object.keys(recent[k]).forEach(d => { if(d <= cp.date) delete recent[k][d]; }));
  const resumed = computeAll(recent, now, {resume:cp});
  assert.equal(resumed.total, full.total); assert.equal(resumed.total, E.compute(V, now).total);
});

/* ---------- focus cycles ---------- */
test('focus cycles: 50 minutes count, the 10-minute breaks do not, across midnight and up to the 3-hour check', () => {
  const m = n => n * 60000, t0 = at(START, 9);
  assert.deepEqual(E.focusSpans(t0, t0 + m(130)).map(([a, b]) => [(a - t0) / 60000, (b - t0) / 60000]), [[0, 50], [60, 110], [120, 130]]);
  assert.deepEqual(E.focusSpans(t0, t0 + m(55)).map(([a, b]) => (b - a) / 60000), [50], 'in the break nothing more is counted');
  assert.deepEqual(E.timerSpans({segStart:t0}, t0 + m(130)), [[t0, t0 + m(130)]], 'without focus mode the whole stretch counts');
  const V = village({studyStart:START});
  V.timer = {state:'running', focus:true, segStart:t0, checkAt:t0 + m(180), sessionMs:0};
  const mins = when => E.compute(V, when).study.days[START].mins;
  assert.equal(mins(t0 + m(30)), 30); assert.equal(mins(t0 + m(50)), 50); assert.equal(mins(t0 + m(59)), 50); assert.equal(mins(t0 + m(75)), 65);
  assert.equal(mins(t0 + m(180)), 150); assert.equal(mins(t0 + m(400)), 150, 'the 3-hour check still caps an unattended timer');
  /* over midnight: 23:30 start, so work 23:30-00:20 and 00:30-01:20 */
  V.timer = {state:'running', focus:true, segStart:at(START, 23, 30), checkAt:at(START, 23, 30) + m(180), sessionMs:0};
  const S = E.compute(V, at('2026-11-02', 1, 0)).study;
  assert.equal(S.days[START].mins, 30); assert.equal(S.days['2026-11-02'].mins, 20 + 30);
  /* the Worker counts the same minutes */
  [at('2026-11-02', 0, 10), at('2026-11-02', 0, 25), at('2026-11-02', 1, 0), at('2026-11-02', 6, 0)].forEach(now => agree(V, now, 'focus ' + now));
});

/* ---------- jutsu unlocks ---------- */
test('skill tree: each move unlocks at its branch\'s bodyweight max, is only an exercise once its own baseline is saved, and never joins the plan by itself', () => {
  assert.equal(new Set(E.JUTSU.map(j => j.id)).size, E.JUTSU.length);
  E.JUTSU.forEach(j => assert.ok(['pullups', 'dips'].includes(j.of) && j.need > 0, j.id));
  const C = E.compute(FIX, at('2026-11-15', 10)), J = Object.fromEntries(E.jutsu(C).map(j => [j.id, j]));
  assert.deepEqual(E.jutsu(C).filter(j => j.unlocked).map(j => j.id), ['chest-to-bar-pullups', 'archer-pullups', 'weighted-pullups', 'weighted-dips'], 'pull-ups best 15, dips best 26');
  assert.equal(J['muscle-ups'].unlocked, false); assert.equal(J['muscle-ups'].need, 16); assert.equal(J['archer-pullups'].learned, false);
  assert.equal(J['weighted-dips'].learned, false, 'a weighted move is learned by training with weight');
  assert.ok(J['archer-pullups'].date, 'the day it unlocked is known');
  { const V0 = E.compute(village(), at(START, 9)); assert.deepEqual(E.jutsu(V0).filter(j => j.unlocked).map(j => j.id), E.JUTSU.filter(j => (V0.best[j.of] || 0) >= j.need).map(j => j.id), 'a beginner has only what his starting max allows'); }
  /* learning one adds an exercise with its own baseline; history and the plan are exactly as before */
  const L = clone(FIX); L.settings.exercises['archer-pullups'] = {name:'Archer pull-ups', jutsu:true}; L.settings.baseline['archer-pullups'] = {max:4, date:'2026-11-15'};
  const C2 = E.compute(L, at('2026-11-15', 10)), j = E.jutsu(C2).find(x => x.id === 'archer-pullups');
  assert.equal(j.learned, true); assert.deepEqual(j.baseline, {max:4, date:'2026-11-15'}); assert.equal(j.max, 4);
  assert.equal(C2.total, C.total); assert.deepEqual(C2.days.map(d => [d.date, d.plan.type, d.status, d.xp]), C.days.map(d => [d.date, d.plan.type, d.status, d.xp]));
  for(let k = 0; k < 14; k++){ const p = E.planFor(L.settings, E.addDays('2026-11-15', k)); assert.ok(p.ex !== 'archer-pullups' && !(p.exs || []).includes('archer-pullups')); }
  /* once picked for a day it is a groove day with targets from its own max */
  const plan = clone(L.settings.scheduleHistory[1].plan); plan[2] = {type:'gtg', ex:'archer-pullups'};
  L.settings.scheduleHistory.push(Object.assign({}, L.settings.scheduleHistory[1], {from:'2026-11-16', plan}));
  const C3 = E.compute(L, at('2026-11-17', 9));
  assert.equal(C3.todayRec.plan.ex, 'archer-pullups'); assert.equal(C3.todayRec.info.target, 2);
  agree(L, at('2026-11-17', 9), 'jutsu day');
});

/* ---------- sleep ---------- */
test('sleep: a good night needs hours, bedtime and wake time; earlier is fine; on call keeps the streak; nothing costs XP', () => {
  const V = cleanWeek();
  V.sleep = {
    '2026-11-02':{date:'2026-11-02', mins:470, score:85, bed:'19:40', wake:'03:50'},   // good + score bonus
    '2026-11-03':{date:'2026-11-03', mins:460, score:79, bed:'18:30', wake:'02:40'},   // earlier is fine: good, no bonus
    '2026-11-04':{date:'2026-11-04', oncall:true, mins:0, score:null, bed:null, wake:null},
    '2026-11-05':{date:'2026-11-05', mins:500, score:90, bed:'00:30', wake:'04:00'},   // asleep after midnight: short, still +10
    '2026-11-06':{date:'2026-11-06', mins:440, score:70, bed:'19:30', wake:'03:30'}    // 7h20 < 7h30: short
  };
  const C = E.compute(V, at('2026-11-08', 12));
  const st = d => C.sleep.days[d];
  assert.deepEqual(['02','03','04','05','06','07','08'].map(x => st('2026-11-' + x).status), ['good','good','oncall','short','short','missed','open']);
  assert.deepEqual(['02','03','04','05','06'].map(x => st('2026-11-' + x).xp), [30, 20, 0, 10, 0]);
  assert.equal(st('2026-11-04').streak, 2, 'on call keeps the streak');
  assert.equal(st('2026-11-05').streak, 0); assert.equal(C.sleep.best, 2);
  assert.equal(st('2026-11-05').checks.bed, false); assert.equal(st('2026-11-06').checks.hours, false);
  const without = E.compute(Object.assign(clone(V), {sleep:{}}), at('2026-11-08', 12));
  assert.equal(C.total - without.total, 60, 'sleep XP is added on top and nothing is ever taken away');
  assert.equal(C.weeks['2026-11-01'].xp, without.weeks['2026-11-01'].xp, 'sleep XP stays out of the shadow clone race');
});

test('sleep: the goal comes from the schedule, so a change starts tomorrow and never rewrites a past night', () => {
  const V = cleanWeek();
  V.sleep = {'2026-11-03':{date:'2026-11-03', mins:460, score:80, bed:'19:40', wake:'03:50'}};
  V.settings.scheduleHistory.push(Object.assign(clone(V.settings.scheduleHistory[0]), {from:'2026-11-04', sleep:{mins:480, bedBy:1170, wakeBy:240}}));
  V.sleep['2026-11-04'] = {date:'2026-11-04', mins:460, score:80, bed:'19:40', wake:'03:50'};
  const C = E.compute(V, at('2026-11-04', 12));
  assert.equal(C.sleep.days['2026-11-03'].status, 'good', 'the old goal still judges the old night');
  assert.equal(C.sleep.days['2026-11-04'].status, 'short');
  assert.deepEqual(C.sleep.days['2026-11-04'].checks, {hours:false, bed:false, wake:true});
});

test('sleep: the Worker agrees with the app day by day, also when resuming from a checkpoint', () => {
  const V = cleanWeek();
  V.sleep = {}; ['2026-11-02','2026-11-03','2026-11-05','2026-11-06','2026-11-09','2026-11-10'].forEach((d, i) => { V.sleep[d] = {date:d, mins:440 + i * 10, score:75 + i * 2, bed:'19:45', wake:'03:55'}; });
  V.sleep['2026-11-04'] = {date:'2026-11-04', oncall:true, mins:0};
  const now = at('2026-11-11', 20), A = E.compute(V, now), W = computeAll(V, now);
  assert.equal(W.total, A.total);
  A.sleep.list.forEach(r => { assert.equal(W.sleep.days[r.date].status, r.status, r.date); assert.equal(W.sleep.days[r.date].xp, r.xp, r.date); });
  const cp = computeAll(V, now, {until:'2026-11-07'}).state, R = computeAll(V, now, {resume:cp});
  assert.equal(R.total, A.total); assert.equal(R.sleep.streak, A.sleep.streak);
});

test('sleep: a backup keeps good nights and drops broken ones', () => {
  const V = cleanWeek();
  const d = Object.assign({app:'The Leaf Village'}, clone(V), {sleep:{
    '2026-11-02':{date:'2026-11-02', mins:470, score:85, bed:'19:40', wake:'03:50'},
    '2026-11-03':{date:'2026-11-03', oncall:true},
    '2026-11-04':{date:'2026-11-04', mins:'lots'},
    'yesterday':{mins:400}}});
  const r = E.cleanBackup(d, at('2026-11-08', 12));
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.data.sleep).sort(), ['2026-11-02','2026-11-03']);
  assert.equal(r.data.sleep['2026-11-02'].mins, 470);
  assert.ok(r.fixed >= 2);
});

/* ---------- transformation jutsu: hidden missions ---------- */
const tf = (C, id) => E.transforms(C).find(t => t.id === id);
const goodNight = (V, d) => { (V.sleep = V.sleep || {})[d] = {date:d, mins:470, score:85, bed:'19:30', wake:'03:30'}; };
function perfectWeek(){
  const V = cleanWeek(); V.settings.studyStart = START;
  for(let k = 0; k < 7; k++){ const d = E.addDays(START, k); if(E.dowOf(d) !== 4) study(V, d, 480); goodNight(V, d); }
  return V;
}
test('transformations: reps missions (Gon in one day, Kaneki lifetime) know the day they were earned', () => {
  const V = cleanWeek();
  let C = E.compute(V, at('2026-11-07', 12));
  assert.equal(tf(C, 'gon').date, null); assert.equal(tf(C, 'gon').n, 59, 'best day so far: the test day');
  sets(V, '2026-11-07', 'dips', 25, 4);
  C = E.compute(V, at('2026-11-07', 20));
  assert.equal(tf(C, 'gon').date, '2026-11-07'); assert.equal(tf(C, 'gon').n, 100);
  assert.equal(tf(C, 'kaneki').date, null); assert.ok(tf(C, 'kaneki').n < 993);
  sets(V, '2026-11-08', 'pullups', 50, 14);
  C = E.compute(V, at('2026-11-08', 22));
  assert.equal(tf(C, 'kaneki').date, '2026-11-08'); assert.equal(tf(C, 'kaneki').n, 993);
  assert.equal(E.transforms(C).length, 11);
});
test('transformations: the Perfect Week needs every scroll with no shield; Checkmate needs the full study goal; Dual Wielder counts days', () => {
  const V = perfectWeek();
  let C = E.compute(V, at('2026-11-07', 21));
  assert.equal(tf(C, 'ayanokoji').date, '2026-11-07'); assert.equal(tf(C, 'lelouch').date, '2026-11-07');
  assert.equal(tf(C, 'kirito').n, 7); assert.equal(tf(C, 'jinwoo').n, 7);
  const midweek = E.compute(V, at('2026-11-04', 21));
  assert.equal(tf(midweek, 'ayanokoji').date, null); assert.equal(tf(midweek, 'ayanokoji').n, 4, 'four perfect days so far this week');
  const short = clone(V); short.sleep['2026-11-03'].mins = 300;
  C = E.compute(short, at('2026-11-07', 21));
  assert.equal(tf(C, 'ayanokoji').date, null, 'a short night spoils the perfect week'); assert.equal(tf(C, 'lelouch').date, '2026-11-07', 'Checkmate does not look at sleep');
  assert.equal(tf(C, 'jinwoo').n, 4, 'the daily quest run starts again after the short night'); assert.equal(tf(C, 'kirito').n, 7);
  const minOnly = clone(V); minOnly.study['2026-11-02'].entries[0].min = 250;
  C = E.compute(minOnly, at('2026-11-07', 21));
  assert.equal(tf(C, 'lelouch').date, null, 'the minimum is not the plan'); assert.equal(tf(C, 'ayanokoji').date, '2026-11-07');
});
test('transformations: Tatakae counts test days with a new max; Tanjiro and Tobi read the sleep streak', () => {
  const V = cleanWeek();
  V.days['2026-11-13'] = {date:'2026-11-13', sets:[{ex:'pullups', reps:12, t:iso('2026-11-13', 17)}, {ex:'pullups', reps:9, t:iso('2026-11-13', 17, 10)}, {ex:'dips', reps:20, t:iso('2026-11-13', 17, 20)}, {ex:'dips', reps:18, t:iso('2026-11-13', 17, 30)}]};
  let C = E.compute(V, at('2026-11-13', 20));
  assert.equal(tf(C, 'eren').n, 2, 'two new maxes on the same day count once; a second test day makes two');
  const S = village();
  for(let k = 0; k < 40; k++){ const d = E.addDays(START, k); if(k !== 5) goodNight(S, d); else (S.sleep[d] = {date:d, mins:300, score:50, bed:'21:00', wake:'02:00'}); }
  C = E.compute(S, at('2026-12-10', 12));
  assert.equal(tf(C, 'tanjiro').date, E.addDays(START, 19), 'fourteen good nights after the short one');
  assert.equal(tf(C, 'tobi').date, E.addDays(START, 26), 'a broken streak rebuilt to 21');
});

/* ---------- one-time swap ---------- */
test('a one-time swap trades two days for that week only, in the app and on the server', async () => {
  const W = await import('../../worker/src/engine.js');
  const V = cleanWeek();
  V.settings.swaps = [{a:'2026-11-13', b:'2026-11-14', created:iso('2026-11-13', 7)}];
  for(const P of [E.planFor, W.planFor]){
    assert.equal(P(V.settings, '2026-11-13').type, 'rest', 'Friday rests');
    assert.equal(P(V.settings, '2026-11-14').type, 'test', 'Saturday tests');
    assert.equal(P(V.settings, '2026-11-20').type, 'test', 'next Friday is a normal test day');
    assert.equal(P(V.settings, '2026-11-21').type, 'rest', 'next Saturday is a normal rest day');
  }
  assert.equal(E.swapOf(V.settings, '2026-11-14'), '2026-11-13');
  let C = E.compute(V, at('2026-11-14', 9));
  assert.equal(C.days.find(d => d.date === '2026-11-13').status, 'rest', 'Friday counted as a rest day');
  assert.equal(C.todayRec.plan.type, 'test');
  C = E.compute(V, at('2026-11-15', 9));
  assert.equal(C.days.find(d => d.date === '2026-11-14').status, 'missed', 'skipping the moved test is still a missed test');
  const bad = clone(V); bad.settings.swaps = [{a:'2026-11-13'}, 'x', {a:'2026-11-13', b:'2026-11-14'}];
  assert.equal(E.planFor(bad.settings, '2026-11-13').type, 'rest', 'broken entries are ignored');
});

/* ---------- Tsunade's shop ---------- */
test('shop: Ryō from XP, forms earned before the shop stay owned, later missions pay bounties, purchases spend', () => {
  const V = cleanWeek();
  sets(V, '2026-11-07', 'dips', 25, 4);
  let C = E.compute(V, at('2026-11-24', 9));
  let S = E.shop(C);
  assert.equal(S.earned, Math.floor(C.days.reduce((m, d) => m + d.earn, 0) / E.RYO_PER_XP), 'every 5 XP gained is 1 Ryō, back-paid; missed days never take coins back');
  C.days.forEach(d => assert.ok(d.earn >= Math.max(0, d.gain), d.date));
  assert.ok(S.earned > Math.floor(C.total / E.RYO_PER_XP), 'the missed days after the clean week cost XP, not Ryō');
  const gon = S.forms.find(f => f.id === 'gon');
  assert.equal(gon.own.how, 'mission', 'Gon was earned before the shop opened, so he stays owned');
  assert.equal(gon.bountyPaid, null); assert.equal(S.bounty, 0);
  const W = clone(V); sets(W, '2026-11-24', 'pullups', 50, 20);
  C = E.compute(W, at('2026-11-24', 22)); S = E.shop(C);
  assert.equal(S.forms.find(f => f.id === 'kaneki').bountyPaid, '2026-11-24', '993 lifetime reps after opening day pays the bounty');
  assert.equal(S.forms.find(f => f.id === 'kaneki').own, null, 'a bounty does not give the form');
  assert.equal(S.bounty, E.RARITY.rare.bounty);
  W.settings.shop = {owned:{kirito:{date:'2026-11-24', price:1500}}};
  C = E.compute(W, at('2026-11-24', 22)); S = E.shop(C);
  assert.equal(S.forms.find(f => f.id === 'kirito').own.how, 'bought');
  assert.equal(S.balance, S.earned + S.bounty - 1500);
  assert.ok(S.pick && !S.owned[S.pick], 'Tsunade picks a form not owned yet');
  const pick = S.forms.find(f => f.pick); assert.equal(pick.cost, Math.round(pick.price * 0.8 / 10) * 10);
  const bad = clone(W); bad.settings.shop = {owned:{kirito:{date:'2026-11-24', price:1500}, nobody:{date:'2026-11-24', price:1}, gojo:{date:'x', price:2}}};
  const cleaned = E.cleanBackup(Object.assign({app:'The Leaf Village'}, bad), at('2026-11-24', 22));
  assert.ok(cleaned.ok, 'the backup still loads');
  const cs = (cleaned.data || cleaned.backup || cleaned).settings;
  assert.deepEqual(Object.keys(cs.shop.owned), ['kirito'], 'broken purchases are dropped');
});

/* ---------- protection scrolls ---------- */
function scrollWeek(V, from){
  /* Tue 24 Nov .. Mon 30 Nov: every workout day done */
  const plan = {'2026-11-24':'pullups', '2026-11-25':'dips', '2026-11-29':'pullups', '2026-11-30':'dips'};
  Object.keys(plan).forEach(d => sets(V, d, plan[d], plan[d] === 'pullups' ? 5 : 10, 5));
  V.days['2026-11-27'] = {date:'2026-11-27', sets:[{ex:'pullups', reps:10, t:iso('2026-11-27', 17)}, {ex:'pullups', reps:9, t:iso('2026-11-27', 17, 10)}, {ex:'dips', reps:20, t:iso('2026-11-27', 17, 20)}, {ex:'dips', reps:18, t:iso('2026-11-27', 17, 30)}]};
}
test('scrolls: 7 days in a row earn an area scroll; a missed day uses it, keeps the streak, costs and earns nothing; server agrees', () => {
  const V = village(); scrollWeek(V);
  let C = E.compute(V, at('2026-11-30', 22)), B = E.scrollBook(C);
  assert.equal(B.inv.workout, 1, 'seven good workout days earn a workout scroll');
  assert.equal(B.inv.study, 0); assert.equal(B.pending.length, 0);
  /* Tue 1 Dec is missed */
  C = E.compute(V, at('2026-12-02', 9)); B = E.scrollBook(C);
  assert.deepEqual(B.pending.map(p => [p.key, p.type]), [['workout|2026-12-01', 'common']]);
  const missed = day(C, '2026-12-01'); assert.equal(missed.status, 'missed');
  V.settings.scrolls = {used:{'workout|2026-12-01':'common'}};
  C = E.compute(V, at('2026-12-02', 9)); B = E.scrollBook(C);
  const cov = day(C, '2026-12-01');
  assert.equal(cov.status, 'scroll'); assert.equal(cov.xp, 0); assert.equal(cov.streak, day(C, '2026-11-30').streak, 'the streak is kept');
  assert.equal(B.inv.workout, 0, 'the scroll is used up'); assert.equal(B.count.workout, 0, 'and the count starts again');
  assert.equal(B.pending.length, 0);
  const W = computeAll(V, at('2026-12-02', 9));
  assert.deepEqual(C.days.map(d => [d.date, d.status, d.xp, d.streak]), W.days.map(d => [d.date, d.status, d.xp, d.streak]), 'the server honours the scroll');
  /* a second miss with nothing left stays missed */
  C = E.compute(V, at('2026-12-03', 9)); B = E.scrollBook(C);
  assert.equal(B.pending.length, 0); assert.equal(day(C, '2026-12-02').status, 'missed');
  /* a mark before the scroll era is ignored */
  const O = village(); O.settings.scrolls = {used:{'workout|2026-11-03':'common'}};
  assert.equal(day(E.compute(O, at('2026-11-05', 9)), '2026-11-03').status, 'missed');
});
test('scrolls: Rare and Forbidden cover any area; a bought Forbidden Scroll arrives on its day; ramen doubles that day\'s Ryō', () => {
  const V = village(); scrollWeek(V);
  V.settings.shop = {buys:[{id:'forbidden', date:'2026-11-30', price:3000}]};
  let C = E.compute(V, at('2026-11-30', 22)), B = E.scrollBook(C), S = E.shop(C);
  assert.equal(B.inv.forbidden, 1); assert.equal(S.forbiddenMonth, true);
  assert.equal(S.spent, 3000);
  /* study starts and is missed on Dec 1: no study scroll, no rare, so the Forbidden Scroll covers it */
  V.settings.studyStart = '2026-12-01';
  C = E.compute(V, at('2026-12-02', 9)); B = E.scrollBook(C);
  assert.ok(B.pending.some(p => p.key === 'study|2026-12-01' && p.type === 'forbidden'), JSON.stringify(B.pending));
  assert.ok(B.pending.some(p => p.key === 'workout|2026-12-01' && p.type === 'common'));
  const base = E.shop(E.compute(V, at('2026-11-30', 22))).earned;
  V.settings.shop.buys.push({id:'ramen', date:'2026-11-30', price:100});
  const C2 = E.compute(V, at('2026-11-30', 22)), S2 = E.shop(C2), g = day(C2, '2026-11-30').gain;
  assert.ok(S2.ramenToday);
  assert.ok(S2.earned >= base + Math.floor(g / E.RYO_PER_XP) - 1, 'ramen doubles the day');
  const bad = clone(V); bad.settings.scrolls = {used:{'workout|2026-12-01':'common', 'gym|2026-12-01':'common', 'study|2026-12-01':'gold'}}; bad.settings.shop.buys.push({id:'nothing', date:'2026-12-01', price:5});
  const cleaned = E.cleanBackup(Object.assign({app:'The Leaf Village'}, bad), at('2026-12-02', 9));
  const cs = (cleaned.data || cleaned.backup || cleaned).settings;
  assert.deepEqual(Object.keys(cs.scrolls.used), ['workout|2026-12-01']); assert.equal(cs.shop.buys.length, 2);
});

/* ---------- weighted sets ---------- */
test('weighted sets: maxes per weight, the working weight follows the test, targets and XP follow the load, server agrees', () => {
  const V = village();
  V.body = {'2026-11-01':{date:'2026-11-01', weight:69}};
  const kgSet = (d, ex, reps, kg, h, m) => ({ex, reps, kg, t:iso(d, h, m || 0)});
  let C = E.compute(V, at('2026-11-27', 9));
  assert.equal(E.suggestKg(C, 'dips'), 0, 'dips at 20 have not outgrown bodyweight yet');
  V.days['2026-11-27'] = {date:'2026-11-27', sets:[kgSet('2026-11-27', 'dips', 11, 10, 17), kgSet('2026-11-27', 'dips', 9, 10, 17, 10), kgSet('2026-11-27', 'pullups', 12, 0, 17, 20), kgSet('2026-11-27', 'pullups', 11, 0, 17, 30)]};
  C = E.compute(V, at('2026-11-27', 20));
  const fri = day(C, '2026-11-27');
  assert.equal(fri.status, 'done');
  assert.equal(C.load.dips, 10, 'the working weight is the weight of the test'); assert.equal(C.load.pullups, 0);
  assert.equal(C.wmax.dips[10], 11); assert.equal(C.maxes.dips, 20, 'the bodyweight max is untouched');
  assert.ok(C.prs.some(p => p.ex === 'dips' && p.kg === 10 && p.v === 11), 'a first weighted test is a record at that weight');
  assert.ok(E.strengthNow(C, 'dips').v > 100, 'strength score from a set of 12 or fewer');
  /* Monday dips: groove sets of half the weighted max, carrying the weight */
  V.days['2026-11-30'] = {date:'2026-11-30', sets:[0, 1, 2, 3].map(k => kgSet('2026-11-30', 'dips', 6, 10, 9 + k)).concat([kgSet('2026-11-30', 'dips', 6, 0, 14)])};
  C = E.compute(V, at('2026-11-30', 20));
  const mon = day(C, '2026-11-30');
  assert.equal(mon.info.target, 6); assert.equal(mon.info.kg, 10);
  assert.equal(mon.info.q, 4, 'a bodyweight set of 6 is lighter than the target and does not count');
  assert.equal(E.suggestKg(C, 'dips'), 10);
  const plain = clone(V); plain.days['2026-11-30'].sets.forEach(x => { delete x.kg; });
  const P = E.compute(plain, at('2026-11-30', 20));
  assert.ok(day(C, '2026-11-30').base > day(P, '2026-11-30').base, 'weighted reps earn more XP than the same reps without weight');
  /* the server sees the same days */
  const Wk = computeAll(V, at('2026-11-30', 20));
  assert.deepEqual(C.days.map(d => [d.date, d.status, d.xp]), Wk.days.map(d => [d.date, d.status, d.xp]));
  /* first Friday of December: the bodyweight check, which keeps the working weight */
  C = E.compute(V, at('2026-12-04', 9));
  assert.equal(E.suggestKg(C, 'dips'), 0, 'first test of the month is at bodyweight');
  V.days['2026-12-04'] = {date:'2026-12-04', sets:[kgSet('2026-12-04', 'dips', 29, 0, 17), kgSet('2026-12-04', 'dips', 25, 0, 17, 10), kgSet('2026-12-04', 'pullups', 13, 0, 17, 20), kgSet('2026-12-04', 'pullups', 12, 0, 17, 30)]};
  C = E.compute(V, at('2026-12-04', 20));
  assert.equal(C.maxes.dips, 29); assert.equal(C.load.dips, 10, 'the monthly bodyweight test keeps the working weight');
  assert.equal(day(C, '2026-12-04').status, 'done');
  /* hitting 12 at the working weight: the next test suggests 2.5 kg more */
  V.days['2026-12-11'] = {date:'2026-12-11', sets:[kgSet('2026-12-11', 'dips', 12, 10, 17), kgSet('2026-12-11', 'dips', 10, 10, 17, 10), kgSet('2026-12-11', 'pullups', 14, 0, 17, 20), kgSet('2026-12-11', 'pullups', 12, 0, 17, 30)]};
  C = E.compute(V, at('2026-12-18', 9));
  assert.equal(E.suggestKg(C, 'dips'), 12.5);
  assert.equal(E.suggestKg(C, 'pullups'), 5, 'pull-ups at 14 get their first weight');
  const Wk2 = computeAll(V, at('2026-12-18', 9));
  assert.deepEqual(C.days.map(d => [d.date, d.status, d.xp]), Wk2.days.map(d => [d.date, d.status, d.xp]));
  /* a bad weight is dropped by the backup check */
  const bad = clone(V); bad.days['2026-12-11'].sets[0].kg = -4;
  const cl = E.cleanBackup(Object.assign({app:'The Leaf Village'}, bad), at('2026-12-18', 9));
  assert.equal((cl.data || cl.backup || cl).days['2026-12-11'].sets.length, 3);
});

/* ---------- on call and side quests ---------- */
test('on call: a missed day marked on call costs nothing and keeps the streak; the server agrees', () => {
  const V = village(); scrollWeek(V);
  let C = E.compute(V, at('2026-12-02', 9));
  assert.equal(day(C, '2026-12-01').status, 'missed');
  V.settings.oncall = ['2026-12-01'];
  C = E.compute(V, at('2026-12-02', 9));
  const d = day(C, '2026-12-01');
  assert.equal(d.status, 'exam'); assert.equal(d.streak, day(C, '2026-11-30').streak);
  assert.deepEqual(C.days.map(x => [x.date, x.status, x.xp]), computeAll(V, at('2026-12-02', 9)).days.map(x => [x.date, x.status, x.xp]));
});
test('side quests: three a week, the same every time, paid in Ryō when done', () => {
  const V = village(); scrollWeek(V);
  const C = E.compute(V, at('2026-11-30', 22)), Q = E.sideQuests(C);
  assert.ok(Q.weeks.length >= 2); Q.weeks.forEach(w => assert.equal(new Set(w.quests.map(q => q.id)).size, 3));
  assert.deepEqual(E.sideQuests(E.compute(V, at('2026-11-30', 22))).weeks.map(w => w.quests.map(q => q.id)), Q.weeks.map(w => w.quests.map(q => q.id)));
  const paid = Q.weeks.reduce((m, w) => m + w.quests.filter(q => q.done).reduce((a, q) => a + q.ryo, 0), 0);
  assert.equal(Q.ryo, paid); assert.equal(E.shop(C).quests, paid);
  assert.equal(E.shop(C).balance, E.shop(C).earned + E.shop(C).bounty + paid - E.shop(C).spent);
});

/* ---------- Hokage Book ---------- */
test('Hokage Book: one chapter per reached rank, written from the logs; the rest sealed; no finale before Hokage', () => {
  const V = cleanWeek();
  const C = E.compute(V, at('2026-11-07', 21));
  const B = E.hokageBook(C);
  assert.equal(B.chapters.length, E.RANKS.length);
  assert.equal(B.reached, B.chapters.filter(c => !c.sealed).length);
  const first = B.chapters[0];
  assert.equal(first.from, '2026-11-01'); assert.equal(first.sealed, false);
  const opened = B.chapters.filter(c => !c.sealed);
  assert.equal(opened.reduce((m, c) => m + c.xp, 0), C.total, 'the chapters add up to the total XP');
  assert.equal(opened.reduce((m, c) => m + c.repsAll, 0), C.days.reduce((m, d) => m + d.sets.reduce((k, x) => k + x.reps, 0), 0), 'every rep is in exactly one chapter');
  assert.ok(opened[opened.length - 1].open, 'the last reached chapter is still being written');
  assert.ok(B.chapters[E.RANKS.length - 1].sealed); assert.equal(B.finale, null);
});

test('Ryō: a missed workout never takes away the Ryō from that day\'s study', () => {
  const V = village(); V.settings.studyStart = START;
  study(V, '2026-11-02', 300);
  const C = E.compute(V, at('2026-11-03', 9)), d = day(C, '2026-11-02');
  assert.equal(d.status, 'missed'); assert.ok(d.sxp > 0);
  assert.equal(d.earn, d.sxp, 'the study XP is paid in full');
  assert.ok(d.gain < d.sxp, 'while the XP total does feel the missed workout');
});
test('a half-done test day saved by a scroll still records the max that was tested', () => {
  const V = village();
  V.days['2026-12-04'] = {date:'2026-12-04', sets:[{ex:'dips', reps:24, t:iso('2026-12-04', 17)}, {ex:'dips', reps:20, t:iso('2026-12-04', 17, 10)}]};
  let C = E.compute(V, at('2026-12-05', 9));
  assert.equal(day(C, '2026-12-04').status, 'missed'); assert.equal(C.maxes.dips, 24);
  V.settings.scrolls = {used:{'workout|2026-12-04':'common'}};
  C = E.compute(V, at('2026-12-05', 9));
  assert.equal(day(C, '2026-12-04').status, 'scroll'); assert.equal(C.maxes.dips, 24, 'the scroll protects the streak, the test still counts');
  assert.deepEqual(C.days.map(x => [x.date, x.status, x.xp]), computeAll(V, at('2026-12-05', 9)).days.map(x => [x.date, x.status, x.xp]));
});
test('a first weigh-in never rewrites the XP of weighted days before it', () => {
  const V = village();
  V.days['2026-11-06'] = {date:'2026-11-06', sets:[{ex:'dips', reps:11, kg:10, t:iso('2026-11-06', 17)}, {ex:'dips', reps:9, kg:10, t:iso('2026-11-06', 17, 10)}, {ex:'pullups', reps:10, t:iso('2026-11-06', 17, 20)}, {ex:'pullups', reps:9, t:iso('2026-11-06', 17, 30)}]};
  const before = day(E.compute(V, at('2026-11-10', 9)), '2026-11-06').xp;
  V.body = {'2026-11-09':{date:'2026-11-09', weight:80}};
  assert.equal(day(E.compute(V, at('2026-11-10', 9)), '2026-11-06').xp, before);
});
