/* Builds tests/fixtures/backup.json: a backup-shaped file (the same format as Settings → Download backup)
   with ten weeks of made-up history. Deterministic: run it twice, get the same file.
   node tests/make-fixture.mjs */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let seed = 20261113;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pad = n => String(n).padStart(2, '0');
const dayMs = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const addDays = (s, n) => ymd(dayMs(s) + n * 86400000);
const dow = s => new Date(dayMs(s)).getUTCDay();
/* a Baghdad wall-clock time as the ISO string the app would store */
const at = (date, hh, mm, ss = 0) => new Date(dayMs(date) - 3 * 3600000 + ((hh * 60 + mm) * 60 + ss) * 1000).toISOString();

const START = '2026-09-06', STUDY_START = '2026-09-20', LAST = '2026-11-11';
const PLAN1 = [{type:'gtg',ex:'pullups'},{type:'gtg',ex:'dips'},{type:'gtg',ex:'pullups'},{type:'gtg',ex:'dips'},{type:'rest'},{type:'test'},{type:'rest'}];
const PLAN2 = [{type:'gtg',ex:'pullups'},{type:'combo',exs:['pullups','dips']},{type:'gtg',ex:'pullups'},{type:'gtg',ex:'dips'},{type:'rest'},{type:'test'},{type:'rest'}];
const settings = {
  v:1, name:'Sharaf', startDate:START,
  exercises:{pullups:{name:'Pull-ups'}, dips:{name:'Dips'}},
  baseline:{pullups:{max:10, date:START}, dips:{max:20, date:START}},
  scheduleHistory:[
    {from:START, plan:PLAN1, gtg:{sets:6, minSets:5, pct:50}, test:{sets:2, ex:['pullups','dips']}},
    {from:'2026-10-18', plan:PLAN2, gtg:{sets:6, minSets:5, pct:50}, combo:{sets:3}, test:{sets:2, ex:['pullups','dips']}, study:{week:{min:240, full:360}, end:{min:360, full:480}}}
  ],
  celebrated:5, studyStart:STUDY_START,
  examWeeks:[{start:'2026-10-04', end:'2026-10-10', created:'2026-10-03T09:00:00.000Z'}]
};
const planOn = d => (d >= '2026-10-18' ? PLAN2 : PLAN1)[dow(d)];
const inExam = d => d >= '2026-10-04' && d <= '2026-10-10';

const days = {}, study = {}, body = {};
const maxes = {pullups:10, dips:20};
const target = ex => Math.max(1, Math.round(maxes[ex] * 50 / 100));
const MISSED = new Set(['2026-09-15', '2026-10-27']);            // two missed missions
const PARTIAL = new Set(['2026-09-22', '2026-11-03']);           // started, not finished
for(let d = START; d <= LAST; d = addDays(d, 1)){
  const p = planOn(d), sets = [];
  if(inExam(d) || MISSED.has(d)){ /* nothing logged */ }
  else if(p.type === 'gtg'){
    const n = PARTIAL.has(d) ? 2 : 5 + (rnd() < .5 ? 1 : 0);
    for(let i = 0; i < n; i++) sets.push({ex:p.ex, reps:target(p.ex) + (rnd() < .2 ? 1 : 0), t:at(d, 7 + i * 2, Math.floor(rnd() * 50), Math.floor(rnd() * 60))});
  } else if(p.type === 'combo'){
    const n = PARTIAL.has(d) ? 1 : 3;
    for(let i = 0; i < n; i++) p.exs.forEach((ex, k) => sets.push({ex, reps:target(ex), t:at(d, 8 + i * 3, 5 + k * 4 + Math.floor(rnd() * 3), Math.floor(rnd() * 60))}));
    if(PARTIAL.has(d)) sets.push({ex:'pullups', reps:target('pullups'), t:at(d, 15, 12, 30)});
  } else if(p.type === 'test'){
    ['pullups', 'dips'].forEach((ex, k) => {
      const top = maxes[ex] + (rnd() < .6 ? 1 : 0);
      sets.push({ex, reps:top, t:at(d, 17, 10 + k * 20, 5)});
      sets.push({ex, reps:Math.max(1, top - 2), t:at(d, 17, 20 + k * 20, 40)});
      maxes[ex] = top;
    });
  }
  if(sets.length){ sets.sort((a, b) => a.t < b.t ? -1 : 1); days[d] = {date:d, sets}; }
  if(p.type === 'rest' && !inExam(d) && (dow(d) === 6 || rnd() < .5)) body[d] = {date:d, weight:Math.round((72 + rnd() * 2) * 10) / 10};

  if(d >= STUDY_START){
    const w = dow(d), min = (w === 5 || w === 6) ? 360 : 240;
    const entries = [];
    const session = (h, m, len, src) => entries.push({start:at(d, h, m), end:new Date(Date.parse(at(d, h, m)) + len * 60000).toISOString(), min:len, src});
    if(inExam(d)){ if(rnd() < .5) session(9, 0, 120, 'timer'); }
    else if(w === 4){ if(d === '2026-10-22'){ session(10, 0, 90, 'timer'); } }
    else if(d === '2026-09-29'){ session(9, 0, 60, 'timer'); }                          // fell short: missed
    else if(d === '2026-10-20'){ session(9, 0, 45, 'manual'); }                        // fell short, shielded
    else {
      session(8, 30, 120, 'timer'); session(11, 15, 90, 'timer');
      session(15, 0, min - 210 + (rnd() < .4 ? 60 : 0), rnd() < .3 ? 'manual' : 'timer');
      if(rnd() < .25) session(20, 0, 60, 'timer');
    }
    const doc = {date:d, entries};
    if(d === '2026-10-20') doc.shield = true;
    if(d === '2026-10-22') doc.offday = true;
    if(entries.length || doc.shield || doc.offday) study[d] = doc;
  }
}
const backup = {
  app:'The Leaf Village', exported:'2026-11-11T19:00:00.000Z', settings,
  prefs:{anim:'full', ambient:true, fxVol:.8, musicVol:.6, musicOnOpen:false, musicMode:'all', builtinHidden:false, bgAll:false, bgStrength:.5, bgFocus:{}, sfxOn:false, soundLen:{}, senseiFrame:{}},
  media:{bg:{}, sounds:{}, music:[], senseis:{}},
  days, body, study, timer:{state:'idle'}, studyStart:STUDY_START, examWeeks:settings.examWeeks
};
const out = fileURLToPath(new URL('./fixtures/backup.json', import.meta.url));
writeFileSync(out, JSON.stringify(backup, null, 1) + '\n');
console.log(`wrote ${out}: ${Object.keys(days).length} workout days, ${Object.keys(study).length} study days, ${Object.keys(body).length} weigh-ins`);
