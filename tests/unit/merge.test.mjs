/* Merge rules: two copies of a day never lose a logged set or a study minute. */
import test from 'node:test';
import assert from 'node:assert/strict';
import M from '../../leaf-merge.js';

const DAY = 'leaf/main/days/2026-11-10', STUDY = 'leaf/main/study/2026-11-10';
const set = (ex, reps, hhmm) => ({ex, reps, t:`2026-11-10T${hhmm}:00.000Z`});
const ent = (start, end, min, src = 'timer') => ({start:`2026-11-10T${start}:00.000Z`, end:`2026-11-10T${end}:00.000Z`, min, src});

test('kindOf sorts paths into day, study, last-edit-wins, or not ours', () => {
  assert.equal(M.kindOf(DAY), 'day');
  assert.equal(M.kindOf(STUDY), 'study');
  ['leaf/main', 'leaf/prefs', 'leaf/media', 'leaf/timer', 'leaf/summary', 'leaf/main/body/2026-11-10'].forEach(p => assert.equal(M.kindOf(p), 'lww', p));
  ['leaf/other', 'leaf/main/days/yesterday', 'x', '', null, 'leaf/main/days/2026-11-10/extra'].forEach(p => assert.equal(M.kindOf(p), null, String(p)));
});

test('two devices that each logged different sets: the merge has all of them, in time order', () => {
  const ipad = {date:'2026-11-10', sets:[set('pullups', 6, '05:00'), set('pullups', 6, '09:00')]};
  const phone = {date:'2026-11-10', sets:[set('pullups', 6, '05:00'), set('pullups', 7, '07:00'), set('dips', 12, '11:00')]};
  const m = M.mergeEntries(DAY, ipad, phone, []);
  assert.deepEqual(m.sets.map(x => x.t.slice(11, 16)), ['05:00', '07:00', '09:00', '11:00']);
  assert.equal(m.sets.reduce((n, x) => n + x.reps, 0), 6 + 7 + 6 + 12);
  assert.ok(M.same(m, M.mergeEntries(DAY, phone, ipad, [])), 'same result whichever copy comes first');
});

test('merging is safe to repeat and never shrinks a day', () => {
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  for(let round = 0; round < 200; round++){
    const pool = Array.from({length:8}, (_, i) => set(rnd() < .5 ? 'pullups' : 'dips', 3 + Math.floor(rnd() * 5), `${String(5 + i).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`));
    const pickSome = () => ({date:'2026-11-10', sets:pool.filter(() => rnd() < .6)});
    const a = pickSome(), b = pickSome(), c = pickSome();
    const ab = M.mergeEntries(DAY, a, b, []), abc = M.mergeEntries(DAY, ab, c, []), bca = M.mergeEntries(DAY, M.mergeEntries(DAY, b, c, []), a, []);
    assert.ok(M.same(abc, bca), 'order of merging does not matter');
    assert.ok(M.same(M.mergeEntries(DAY, abc, abc, []), abc), 'merging a copy with itself changes nothing');
    [a, b, c].forEach(x => x.sets.forEach(s => assert.ok(abc.sets.some(y => M.setKey(y) === M.setKey(s)), 'every set survives')));
    const total = new Set([...a.sets, ...b.sets, ...c.sets].map(M.setKey)).size;
    assert.equal(abc.sets.length, total);
  }
});

test('a single device keeps its sets exactly as logged', () => {
  const day = {date:'2026-11-10', sets:[set('pullups', 6, '05:00'), set('pullups', 6, '07:30'), set('pullups', 5, '09:10')]};
  assert.deepEqual(M.mergeEntries(DAY, day, day, []), day);
  assert.deepEqual(M.mergeEntries(DAY, day, {}, []), day);
  assert.deepEqual(M.mergeEntries(DAY, {}, day, []), day);
});

test('honest duplicates are kept: the same entry twice in one copy stays twice', () => {
  const old = {date:'2026-11-10', sets:[{ex:'pullups', reps:5}, {ex:'pullups', reps:5}]};      // no timestamps (very old data)
  const m = M.mergeEntries(DAY, old, old, []);
  assert.equal(m.sets.length, 2);
  assert.equal(M.mergeEntries(DAY, old, {date:'2026-11-10', sets:[{ex:'pullups', reps:5}]}, []).sets.length, 2);
});

test('Undo: the removed set stays removed even when the other copy still has it', () => {
  const before = {date:'2026-11-10', sets:[set('pullups', 6, '05:00'), set('pullups', 9, '07:00')]};
  const after = {date:'2026-11-10', sets:[set('pullups', 6, '05:00')]};
  const removed = M.removedKeys(DAY, before, after);
  assert.equal(removed.length, 1);
  const m = M.mergeEntries(DAY, after, before, removed);
  assert.deepEqual(m.sets, after.sets, 'the other copy does not bring the undone set back');
  const relog = {date:'2026-11-10', sets:[set('pullups', 6, '05:00'), set('pullups', 9, '07:05')]};
  assert.equal(M.mergeEntries(DAY, relog, before, removed).sets.length, 2, 'logging again after Undo is a new entry and is kept');
});

test('removedKeys only reports what the app took out, never what it has not seen yet', () => {
  const seen = {date:'2026-11-10', sets:[set('pullups', 6, '05:00')]};
  const next = {date:'2026-11-10', sets:[set('pullups', 6, '05:00'), set('pullups', 6, '08:00')]};
  assert.deepEqual(M.removedKeys(DAY, seen, next), []);
  assert.deepEqual(M.removedKeys(DAY, undefined, next), []);
  assert.deepEqual(M.removedKeys('leaf/main', {a:1}, {}), []);
});

test('study days: entries are a union, minutes add up, shield and offday stay true', () => {
  const a = {date:'2026-11-10', entries:[ent('05:00', '07:00', 120), ent('08:00', '09:30', 90)], shield:true};
  const b = {date:'2026-11-10', entries:[ent('05:00', '07:00', 120), ent('12:00', '12:45', 45, 'manual')], offday:true};
  const m = M.mergeEntries(STUDY, a, b, []);
  assert.equal(m.entries.reduce((n, e) => n + e.min, 0), 120 + 90 + 45);
  assert.deepEqual(m.entries.map(e => e.end.slice(11, 16)), ['07:00', '09:30', '12:45']);
  assert.equal(m.shield, true); assert.equal(m.offday, true);
  const plain = M.mergeEntries(STUDY, {date:'2026-11-10', entries:[]}, {date:'2026-11-10', entries:[]}, []);
  assert.ok(!('shield' in plain) && !('offday' in plain), 'no shield appears from nowhere');
});

test('covers: tells whether one copy already holds everything the other has', () => {
  const small = {date:'2026-11-10', sets:[set('pullups', 6, '05:00')]};
  const big = {date:'2026-11-10', sets:[set('pullups', 6, '05:00'), set('pullups', 6, '08:00')]};
  assert.equal(M.covers(DAY, big, small), true);
  assert.equal(M.covers(DAY, small, big), false);
  assert.equal(M.covers(STUDY, {date:'2026-11-10', entries:[]}, {date:'2026-11-10', entries:[], shield:true}), false);
});

test('same ignores the order fields were written in', () => {
  assert.ok(M.same({a:1, b:{c:2, d:[1, 2]}}, {b:{d:[1, 2], c:2}, a:1}));
  assert.ok(!M.same({a:[1, 2]}, {a:[2, 1]}));
});
