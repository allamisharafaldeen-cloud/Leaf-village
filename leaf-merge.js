/* The Leaf Village · merge rules shared by the app (platform.js) and the sync Worker.
   The one promise: merging two copies of a day never loses a logged set or a study minute.
   - Workout days and study days: entries are joined as a union, then sorted by time.
     The only way an entry goes away is the app's own Undo, which leaves a "removed" note
     (a tombstone) so the other copy drops that same entry too.
   - shield and offday: true wins.
   - Everything else (settings, prefs, media, timer, weigh-ins): the latest edit wins. */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.LeafMerge = factory();
})(typeof self !== 'undefined' ? self : this, function(){
'use strict';

const DATE = '\\d{4}-\\d{2}-\\d{2}';
const RE_DAY = new RegExp('^leaf/main/days/' + DATE + '$');
const RE_STUDY = new RegExp('^leaf/main/study/' + DATE + '$');
const RE_BODY = new RegExp('^leaf/main/body/' + DATE + '$');
const SINGLE = { 'leaf/main':1, 'leaf/prefs':1, 'leaf/media':1, 'leaf/timer':1, 'leaf/summary':1 };

/* 'day' | 'study' | 'lww' | null (null = not a document this app syncs) */
function kindOf(path){
  if(typeof path !== 'string') return null;
  if(RE_DAY.test(path)) return 'day';
  if(RE_STUDY.test(path)) return 'study';
  if(RE_BODY.test(path) || SINGLE[path]) return 'lww';
  return null;
}
const isEntries = path => { const k = kindOf(path); return k === 'day' || k === 'study'; };

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const listOf = (doc, field) => (isObj(doc) && Array.isArray(doc[field])) ? doc[field].filter(isObj) : [];
const fieldOf = kind => kind === 'day' ? 'sets' : 'entries';

/* what makes two entries "the same entry" */
const setKey = x => JSON.stringify([x.ex == null ? null : x.ex, x.reps == null ? null : x.reps, x.t == null ? null : x.t]);
const studyKey = e => JSON.stringify([e.start == null ? null : e.start, e.end == null ? null : e.end, e.min == null ? null : e.min, e.src == null ? null : e.src]);
const keyFn = kind => kind === 'day' ? setKey : studyKey;

const ms = v => { const n = Date.parse(v); return isNaN(n) ? null : n; };
/* time used for sorting; an entry with no readable time stays right after the one before it */
function timesOf(kind, list){
  const out = []; let prev = -Infinity;
  list.forEach(x => {
    let t = kind === 'day' ? ms(x.t) : ms(x.end);
    if(t == null && kind === 'study') t = ms(x.start);
    if(t == null) t = prev;
    prev = t; out.push(t);
  });
  return out;
}

/* union that keeps honest duplicates: if one copy holds the same entry twice, the result holds it twice */
function unionList(kind, a, b, removed){
  const key = keyFn(kind), gone = new Set(removed || []);
  const A = a.map((x, i) => ({x, k:key(x), src:0, i})), B = b.map((x, i) => ({x, k:key(x), src:1, i}));
  const tA = timesOf(kind, a), tB = timesOf(kind, b);
  A.forEach((o, i) => { o.t = tA[i]; }); B.forEach((o, i) => { o.t = tB[i]; });
  const have = new Map();
  A.forEach(o => have.set(o.k, (have.get(o.k) || 0) + 1));
  const seen = new Map(), all = A.slice();
  B.forEach(o => { const n = (seen.get(o.k) || 0) + 1; seen.set(o.k, n); if(n > (have.get(o.k) || 0)) all.push(o); });
  const kept = all.filter(o => !gone.has(o.k));
  kept.sort((p, q) => {
    if(p.t !== q.t) return p.t < q.t ? -1 : 1;
    if(kind === 'study'){ const sp = ms(p.x.start), sq = ms(q.x.start); if(sp != null && sq != null && sp !== sq) return sp < sq ? -1 : 1; }
    if(p.k !== q.k) return p.k < q.k ? -1 : 1;
    return (p.src - q.src) || (p.i - q.i);
  });
  return kept.map(o => o.x);
}

function idOf(path){ return path.slice(path.lastIndexOf('/') + 1); }

/* merge two copies of one workout day or study day */
function mergeEntries(path, a, b, removed){
  const kind = kindOf(path), field = fieldOf(kind);
  const out = Object.assign({}, isObj(a) ? a : {}, isObj(b) ? b : {});
  out.date = (isObj(a) && a.date) || (isObj(b) && b.date) || idOf(path);
  out[field] = unionList(kind, listOf(a, field), listOf(b, field), removed);
  if(kind === 'study'){
    ['shield', 'offday'].forEach(f => {
      const on = !!((isObj(a) && a[f]) || (isObj(b) && b[f]));
      if(on) out[f] = true; else delete out[f];
    });
  }
  return out;
}

/* entries the app took out on purpose: in the copy it last saw, missing from the copy it now saves */
function removedKeys(path, seen, next){
  const kind = kindOf(path); if(kind !== 'day' && kind !== 'study') return [];
  const key = keyFn(kind), field = fieldOf(kind);
  const still = new Set(listOf(next, field).map(key)), out = [];
  listOf(seen, field).forEach(x => { const k = key(x); if(!still.has(k) && out.indexOf(k) < 0) out.push(k); });
  return out;
}
const entryKeys = (path, doc) => { const kind = kindOf(path); return (kind === 'day' || kind === 'study') ? listOf(doc, fieldOf(kind)).map(keyFn(kind)) : []; };
function unionKeys(a, b){
  const out = [], s = new Set();
  [a, b].forEach(l => (l || []).forEach(k => { if(typeof k === 'string' && !s.has(k)){ s.add(k); out.push(k); } }));
  return out;
}

/* same content, whatever order the fields were written in */
function canon(v){
  if(Array.isArray(v)) return v.map(canon);
  if(isObj(v)){ const o = {}; Object.keys(v).sort().forEach(k => { if(v[k] !== undefined) o[k] = canon(v[k]); }); return o; }
  return v;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/* does `doc` hold every entry `other` has? (used to decide whether a copy still needs uploading) */
function covers(path, doc, other){
  const kind = kindOf(path); if(kind !== 'day' && kind !== 'study') return same(doc, other);
  return same(mergeEntries(path, doc, other, []), mergeEntries(path, doc, {}, []));
}

return { kindOf, isEntries, mergeEntries, removedKeys, entryKeys, unionKeys, same, covers, setKey, studyKey, canon };
});
