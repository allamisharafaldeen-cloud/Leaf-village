/* Run by the deploy workflow against the live Worker. Read-only: it changes nothing in the database,
   and it prints only statuses and counts (the Actions log is public; training data is not). */
import { createHash } from 'node:crypto';
const url = process.env.WORKER_URL, key = process.env.LEAF_SYNC_KEY || '';
if(!url){ console.error('WORKER_URL is not set'); process.exit(1); }
const token = createHash('sha256').update('leaf-village|' + key.trim()).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(path, init){
  const res = await fetch(url + path, init); let json = null; try{ json = await res.json(); }catch(e){}
  return {status:res.status, json, headers:res.headers};
}
const auth = {Authorization:'Bearer ' + token, 'Content-Type':'application/json'};
let failed = 0;
const check = (name, ok, extra) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' · ' + extra : ''}`); if(!ok) failed++; };

/* a brand-new workers.dev address can take a few minutes to start answering */
let health = null;
for(let i = 0; i < 40; i++){
  try{ health = await get('/health'); if(health.status === 200 && health.json && health.json.ready) break; }catch(e){ health = null; }
  await sleep(10000);
}
check('Worker answers and has its sync key', !!(health && health.status === 200 && health.json && health.json.ready), health ? `HTTP ${health.status}` : 'no answer');
if(health && health.status === 200){
  check('no key → rejected', (await get('/sync', {method:'POST', body:'{}'})).status === 401);
  check('wrong key → rejected', (await get('/sync', {method:'POST', headers:{Authorization:'Bearer ' + 'f'.repeat(64)}, body:'{}'})).status === 401);
  const sync = await get('/sync', {method:'POST', headers:auth, body:JSON.stringify({since:2147483647, docs:[]})});
  check('right key → sync works', sync.status === 200 && sync.json && sync.json.ok === true && Array.isArray(sync.json.docs), `HTTP ${sync.status}`);
  check('push keys exist', !!(sync.json && typeof sync.json.vapid === 'string' && sync.json.vapid.length > 80));
  const status = await get('/status', {headers:auth});
  check('database reachable', status.status === 200, status.json ? `${status.json.docs} documents, ${status.json.devices} device(s) with notifications` : '');
  if(status.json && status.json.lastRun) console.log(`     last reminder run: ${status.json.lastRun.slot} · ${status.json.lastRun.note || `sent to ${status.json.lastRun.sent}`} · ${new Date(status.json.lastRun.at).toISOString()}`);
  for(const slot of ['MORNING', 'MIDDAY', 'EVENING', 'LASTCALL']){
    const p = await get(`/reminders/preview?slot=${slot}`, {headers:auth});
    check(`reminder preview ${slot}`, p.status === 200 && p.json && p.json.chars < 320, p.json ? (p.json.send ? `would send ${p.json.chars} characters` : 'nothing to say right now') : `HTTP ${p.status}`);
  }
  const app = 'https://allamisharafaldeen-cloud.github.io';
  const pre = await get('/sync', {method:'OPTIONS', headers:{Origin:app, 'Access-Control-Request-Method':'POST', 'Access-Control-Request-Headers':'authorization,content-type'}});
  check('the app on GitHub Pages is allowed in', pre.headers.get('access-control-allow-origin') === app);
  const other = await get('/sync', {method:'POST', headers:Object.assign({Origin:'https://example.com'}, auth), body:'{}'});
  check('other websites are not', other.status === 403 && !other.headers.get('access-control-allow-origin'));
}
process.exit(failed ? 1 : 0);
