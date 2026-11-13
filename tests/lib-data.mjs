/* Shared test helpers: the backup fixture as engine data, and "the village as it stood at a given moment". */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const backup = () => JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/backup.json', import.meta.url)), 'utf8'));
export const dataOf = b => ({settings:b.settings, days:b.days, study:b.study, body:b.body, timer:b.timer || {state:'idle'}});
export const clone = v => JSON.parse(JSON.stringify(v));
/* Baghdad wall-clock time → the real instant */
export const at = (date, hh, mm = 0) => Date.parse(`${date}T00:00:00Z`) - 3 * 3600000 + (hh * 60 + mm) * 60000;
export const SLOT_TIME = {MORNING:[5, 40], MIDDAY:[11, 40], EVENING:[17, 40], LASTCALL:[22, 40]};
export const slotTime = (date, slot) => at(date, SLOT_TIME[slot][0], SLOT_TIME[slot][1]);
/* drop everything logged after `nowMs`, so a test sees the day as it was at that minute */
export function asOf(data, nowMs){
  const today = new Date(nowMs + 3 * 3600000).toISOString().slice(0, 10), out = clone(data);
  Object.keys(out.days).forEach(d => { if(d > today){ delete out.days[d]; return; } out.days[d].sets = out.days[d].sets.filter(x => Date.parse(x.t) <= nowMs); if(!out.days[d].sets.length) delete out.days[d]; });
  Object.keys(out.study).forEach(d => { if(d > today){ delete out.study[d]; return; } out.study[d].entries = (out.study[d].entries || []).filter(e => Date.parse(e.end) <= nowMs); });
  Object.keys(out.body).forEach(d => { if(d > today) delete out.body[d]; });
  return out;
}
/* the backup as the flat {path: document} map the database holds */
export function docsOf(b){
  const map = {'leaf/main':b.settings};
  if(b.prefs) map['leaf/prefs'] = b.prefs;
  if(b.media) map['leaf/media'] = b.media;
  if(b.timer) map['leaf/timer'] = b.timer;
  [['days', b.days], ['study', b.study], ['body', b.body]].forEach(([k, o]) => Object.keys(o || {}).forEach(id => { map[`leaf/main/${k}/${id}`] = o[id]; }));
  return map;
}
