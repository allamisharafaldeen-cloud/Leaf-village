/* Random months of village life, run through the app's engine and the server's engine: they must agree day by day,
   a checkpointed server must agree with a from-scratch one, and nothing may throw or produce NaN.
   node tests/fuzz/parity.mjs [runs] [seed] */
process.env.TZ = 'Asia/Baghdad';
import E from '../../leaf-engine.js';
import { computeAll, computeWithScrolls, advanceCheckpoint, checkpointTarget } from '../../worker/src/engine.js';
import { at } from '../lib-data.mjs';

const RUNS = +process.argv[2] || 60, SEED0 = +process.argv[3] || 1;
let rs = 1; const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)], chance = p => rnd() < p, int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const START = '2026-11-01', iso = (d, h, m) => new Date(at(d, h, m || 0)).toISOString();
const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function village(span){
  const V = {settings:{v:1, name:'Fuzz', startDate:START, exercises:{pullups:{name:'Pull-ups'}, dips:{name:'Dips'}},
    baseline:{pullups:{max:int(4, 14), date:START}, dips:{max:int(10, 30), date:START}},
    scheduleHistory:[{from:START, plan:JSON.parse(JSON.stringify(E.DEFAULT_PLAN)), gtg:{sets:6, minSets:5, pct:pick([40, 50, 60])}, test:{sets:2, ex:['pullups', 'dips']}}], celebrated:0},
    days:{}, study:{}, body:{}, sleep:{}, timer:{state:'idle'}};
  const s = V.settings;
  if(chance(.7)) s.studyStart = E.addDays(START, int(0, 20));
  if(chance(.4)){ const a = E.addDays(START, int(10, span - 10)); s.examWeeks = [{start:a, end:E.addDays(a, int(0, 9))}]; }
  if(chance(.5)){ s.oncall = []; for(let i = 0; i < int(1, 8); i++) s.oncall.push(E.addDays(START, int(0, span))); s.oncall = [...new Set(s.oncall)].sort(); }
  if(chance(.35)){ s.deloads = []; for(let i = 0; i < int(1, 2); i++) s.deloads.push({start:E.addDays(START, int(0, span))}); }
  if(chance(.4)){ s.swaps = []; for(let i = 0; i < int(1, 3); i++){ const a = E.addDays(START, int(0, span - 2)); s.swaps.push({a, b:E.addDays(a, 1), created:iso(a, 7)}); } }
  if(chance(.6)){ s.scrolls = {used:{}}; for(let i = 0; i < int(1, 10); i++) s.scrolls.used[`${pick(['workout', 'study', 'sleep'])}|${E.addDays(START, int(0, span))}`] = pick(['common', 'rare', 'forbidden']); }
  if(chance(.5)){ s.shop = {owned:{}, buys:[]}; for(let i = 0; i < int(1, 6); i++) s.shop.buys.push({id:pick(['ramen', 'forbidden', 'card-anbu', 'title-copy', 'fx-sage']), date:E.addDays(START, int(0, span)), price:pick([100, 3000, 300, 150])}); }
  const kgs = chance(.5) ? [0] : [0, 0, 5, 10, 12.5, 15];
  for(let i = 0; i <= span; i++){
    const d = E.addDays(START, i), dw = new Date(at(d, 12)).getDay();
    if(chance(.8)){
      const n = dw === 5 ? int(0, 5) : int(0, 9), xs = [];
      for(let k = 0; k < n; k++){ const x = {ex:pick(['pullups', 'dips']), reps:int(0, 32), t:iso(d, int(5, 23), int(0, 59))}; const kg = pick(kgs); if(kg) x.kg = kg; xs.push(x); }
      xs.sort((a, b) => a.t < b.t ? -1 : 1);
      if(n) V.days[d] = {date:d, sets:xs};
    }
    if(chance(.6)){ const e = []; for(let k = 0; k < int(1, 3); k++){ const h = int(6, 21), m = int(5, 150); e.push({start:iso(d, h), end:new Date(at(d, h) + m * 60000).toISOString(), min:m, src:pick(['timer', 'manual'])}); } V.study[d] = {date:d, entries:e}; }
    if(chance(.75)){ const bed = int(20 * 60, 26 * 60 + 30), mins = int(200, 560); V.sleep[d] = chance(.1) ? {oncall:true} : {mins, bed:hhmm(bed), wake:hhmm(bed + mins), score:chance(.5) ? int(40, 99) : undefined}; }
    if(chance(.12)) V.body[d] = {date:d, weight:int(650, 760) / 10};
  }
  return V;
}

const pickDay = d => [d.date, d.status, d.xp, d.streak];
let fails = 0, checked = 0, withDue = 0;
for(let r = 0; r < RUNS; r++){
  rs = SEED0 * 7919 + r; const span = int(20, 120), V = village(span);
  const nowDay = E.addDays(START, span), now = at(nowDay, int(6, 23), int(0, 59));
  try{
    const bad = [];
    /* the app writes the scrolls its inventory says were used (what writeScrollMarks does when it is opened);
       the server, which has not seen those marks yet, must already treat the same days as covered */
    const VA = JSON.parse(JSON.stringify(V));
    let C = E.compute(VA, now);
    const due = E.scrollBook(C).pending;
    if(due.length) withDue++;
    if(due.length){ VA.settings.scrolls = Object.assign({}, VA.settings.scrolls, {used:Object.assign({}, (VA.settings.scrolls || {}).used)}); due.forEach(p => { VA.settings.scrolls.used[p.key] = p.type; }); C = E.compute(VA, now);
      if(E.scrollBook(C).pending.length) bad.push('the app still has scrolls to write after writing them: ' + JSON.stringify(E.scrollBook(C).pending)); }
    const W = computeWithScrolls(JSON.parse(JSON.stringify(V)), now), Wm = computeAll(JSON.parse(JSON.stringify(VA)), now);
    const a = C.days.map(pickDay), b = W.days.map(pickDay);
    if(JSON.stringify(a) !== JSON.stringify(b)){ const i = a.findIndex((x, k) => JSON.stringify(x) !== JSON.stringify(b[k])); bad.push(`days differ at ${i}: app ${JSON.stringify(a[i])} server ${JSON.stringify(b[i])}`); }
    if(C.total !== W.total) bad.push(`total app ${C.total} server ${W.total}`);
    if(JSON.stringify(Wm.days.map(pickDay)) !== JSON.stringify(b)) bad.push('the server with the marks written differs from the server working them out');
    const sa = C.study.list.map(x => [x.date, x.status, x.xp]), sb = W.study.list.map(x => [x.date, x.status, x.xp]);
    if(JSON.stringify(sa) !== JSON.stringify(sb)){ const i = sa.findIndex((x, k) => JSON.stringify(x) !== JSON.stringify(sb[k])); bad.push(`study differs: app ${JSON.stringify(sa[i])} server ${JSON.stringify(sb[i])}`); }
    if(C.sleep && W.sleep){ const la = C.sleep.list.map(x => [x.date, x.status, x.xp]), lb = W.sleep.list.map(x => [x.date, x.status, x.xp]); if(JSON.stringify(la) !== JSON.stringify(lb)){ const i = la.findIndex((x, k) => JSON.stringify(x) !== JSON.stringify(lb[k])); bad.push(`sleep differs: app ${JSON.stringify(la[i])} server ${JSON.stringify(lb[i])}`); } }
    /* the whole-app derived views must not throw or produce NaN */
    const views = {shop:E.shop(C), scrolls:E.scrollBook(C), quests:E.sideQuests(C), jutsu:E.jutsu(C), book:E.hokageBook(C), tf:E.transforms(C)};
    const walk = (o, path) => { if(typeof o === 'number' && !Number.isFinite(o)) bad.push(`not a number at ${path}`); else if(o && typeof o === 'object' && bad.length < 5) for(const k of Object.keys(o)) walk(o[k], path + '.' + k); };
    walk(views, 'views');
    ['pullups', 'dips'].forEach(ex => { E.suggestKg(C, ex); });
    /* checkpoint resume: replay only the days after a settled Saturday */
    const to = checkpointTarget(nowDay);
    if(to > START){
      const st = advanceCheckpoint(JSON.parse(JSON.stringify(V)), now, null, to, 0);
      if(st){ const R = computeWithScrolls(JSON.parse(JSON.stringify(V)), now, {resume:st});
        const tail = W.days.filter(d => d.date > st.date).map(pickDay), rt = R.days.map(pickDay);
        if(JSON.stringify(tail) !== JSON.stringify(rt)){ const i = tail.findIndex((x, k) => JSON.stringify(x) !== JSON.stringify(rt[k])); bad.push(`checkpoint resume differs at ${tail[i] && tail[i][0]}: full ${JSON.stringify(tail[i])} resumed ${JSON.stringify(rt[i])}`); }
        if(R.total !== W.total) bad.push(`checkpoint total full ${W.total} resumed ${R.total}`);
      }
    }
    checked++;
    if(bad.length){ fails++; console.log(`run ${r} (span ${span}):\n  ` + bad.join('\n  ')); }
  }catch(e){ fails++; console.log(`run ${r} threw: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); }
}
console.log(`${checked} runs checked, ${fails} with problems` + (withDue ? ` (${withDue} with scrolls to write)` : ''));
process.exit(fails ? 1 : 0);
