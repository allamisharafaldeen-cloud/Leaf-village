/* The Leaf Village · sync and sensei reminders.
   A small Cloudflare Worker with a D1 database, all on the free tier.

   POST /sync              push changed documents, pull documents changed since a cursor
   POST /push/subscribe    remember this device's push subscription
   POST /push/unsubscribe  forget it
   POST /push/test         send a test notification
   GET  /reminders/preview what a slot would say right now (nothing is sent)
   GET  /health            is the Worker up (no data)
   cron 02:40, 08:40, 14:40, 19:40 UTC = 5:40, 11:40, 17:40, 22:40 in Baghdad

   Everything except /health needs the sync key. */
import LeafMerge from '../../leaf-merge.js';
import { snapshotFromDocs, dateAt } from './engine.js';
import { decide, slotAt, TITLES } from './reminders.js';
import { generateVapid, sendPush, validEndpoint } from './webpush.js';

const { kindOf, mergeEntries, unionKeys, same } = LeafMerge;
const MAX_PUSH_DOCS = 24, PAGE = 300, MAX_DOC_BYTES = 400000, MAX_BODY_BYTES = 1500000, MAX_REMOVED = 500;
const enc = new TextEncoder();

/* ---------- small helpers ---------- */
const origins = env => String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
function cors(req, env){
  const o = req.headers.get('Origin');
  if(!o || origins(env).indexOf(o) < 0) return {};
  return {'Access-Control-Allow-Origin':o, 'Vary':'Origin', 'Access-Control-Allow-Methods':'GET, POST, OPTIONS', 'Access-Control-Allow-Headers':'Authorization, Content-Type', 'Access-Control-Max-Age':'86400'};
}
const reply = (req, env, status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status, headers:Object.assign({'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}, cors(req, env))});
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
/* the app never sends the key itself, only this fingerprint of it */
export const keyToken = async key => hex(await crypto.subtle.digest('SHA-256', enc.encode('leaf-village|' + String(key).trim())));
let tokenCache = null;
async function authorized(req, env){
  const key = String(env.LEAF_SYNC_KEY || '').trim();
  if(!key) return false;
  if(!tokenCache || tokenCache.key !== key) tokenCache = {key, token:await keyToken(key)};
  const got = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if(got.length !== tokenCache.token.length) return false;
  let diff = 0; for(let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ tokenCache.token.charCodeAt(i);
  return diff === 0;
}
async function readJson(req){
  const text = await req.text();
  if(text.length > MAX_BODY_BYTES) throw {status:413, error:'too_large'};
  try{ const v = JSON.parse(text || '{}'); if(!v || typeof v !== 'object') throw 0; return v; }catch(e){ throw {status:400, error:'bad_json'}; }
}

/* ---------- database ---------- */
async function metaGet(env, key){ const r = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first(); return r ? r.value : null; }
async function metaSet(env, key, value){ await env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run(); }
async function metaOnce(env, key, make){
  let v = await metaGet(env, key);
  if(v == null){
    await env.DB.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').bind(key, await make()).run();
    v = await metaGet(env, key);
  }
  return v;
}
const genCache = new WeakMap(), vapidCache = new WeakMap();
const cached = async (map, env, load) => { if(!map.has(env.DB)) map.set(env.DB, await load()); return map.get(env.DB); };
/* a random id for this database; if the database is ever recreated the app notices and uploads everything again */
const getGen = env => cached(genCache, env, () => metaOnce(env, 'gen', async () => hex(crypto.getRandomValues(new Uint8Array(12)))));
/* the push keys are made once, on first use, and kept in the database so they stay the same across deploys */
const getVapid = env => cached(vapidCache, env, async () => JSON.parse(await metaOnce(env, 'vapid', async () => JSON.stringify(await generateVapid()))));
const parseArr = s => { try{ const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; }catch(e){ return []; } };
const parseObj = s => { try{ const v = JSON.parse(s); return v && typeof v === 'object' ? v : null; }catch(e){ return null; } };

/* ---------- sync ---------- */
function cleanIncoming(list){
  const out = [], seen = new Set();
  (Array.isArray(list) ? list : []).forEach(d => {
    if(!d || typeof d.path !== 'string' || !kindOf(d.path) || seen.has(d.path)) return;
    if(!d.data || typeof d.data !== 'object' || Array.isArray(d.data)) return;
    if(JSON.stringify(d.data).length > MAX_DOC_BYTES) return;
    seen.add(d.path);
    out.push({path:d.path, data:d.data, mtime:Math.max(0, Number(d.mtime) || 0), removed:(Array.isArray(d.removed) ? d.removed : []).filter(k => typeof k === 'string' && k.length < 300)});
  });
  return out;
}
/* merge what the device sent with what is stored; nothing is overwritten blindly */
async function writeDocs(env, incoming, now){
  let todo = incoming;
  for(let attempt = 0; attempt < 4 && todo.length; attempt++){
    const marks = todo.map(() => '?').join(',');
    const rows = (await env.DB.prepare(`SELECT path, data, removed, mtime, seq FROM docs WHERE path IN (${marks})`).bind(...todo.map(d => d.path)).all()).results || [];
    const have = {}; rows.forEach(r => { have[r.path] = r; });
    const write = [];
    todo.forEach(d => {
      const ex = have[d.path], kind = kindOf(d.path), old = ex ? parseObj(ex.data) : null;
      if(kind === 'lww'){
        const mtime = Math.min(d.mtime, now);
        if(ex && (ex.mtime > mtime || same(old, d.data))) return;           // the stored edit is newer, or nothing changed
        write.push({path:d.path, data:JSON.stringify(d.data), removed:'[]', mtime, base:ex ? ex.seq : 0});
      } else {
        const oldRemoved = ex ? parseArr(ex.removed) : [];
        const removed = unionKeys(oldRemoved, d.removed).slice(-MAX_REMOVED);
        const merged = mergeEntries(d.path, old || {}, d.data, removed);
        if(ex && same(old, merged) && removed.length === oldRemoved.length) return;
        write.push({path:d.path, data:JSON.stringify(merged), removed:JSON.stringify(removed), mtime:now, base:ex ? ex.seq : 0});
      }
    });
    if(!write.length) return;
    const stmts = [];
    for(let i = 0; i < write.length; i += 12){
      const part = write.slice(i, i + 12);
      const sql = `INSERT INTO docs (path, data, removed, mtime, updated, seq, base) VALUES ${part.map(() => `(?, ?, ?, ?, ?, (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'seq') + 1, ?)`).join(', ')}
        ON CONFLICT(path) DO UPDATE SET data = excluded.data, removed = excluded.removed, mtime = excluded.mtime, updated = excluded.updated, seq = excluded.seq, base = excluded.base
        WHERE docs.seq = excluded.base
        RETURNING path`;
      const args = []; part.forEach(w => args.push(w.path, w.data, w.removed, w.mtime, now, w.base));
      stmts.push(env.DB.prepare(sql).bind(...args));
    }
    stmts.push(env.DB.prepare(`UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'seq'`));
    const res = await env.DB.batch(stmts);
    const written = new Set();
    res.slice(0, -1).forEach(r => (r.results || []).forEach(x => written.add(x.path)));
    /* a row that changed between our read and our write was left alone: read it again and merge again */
    const missed = new Set(write.filter(w => !written.has(w.path)).map(w => w.path));
    todo = todo.filter(d => missed.has(d.path));
  }
  if(todo.length) throw {status:409, error:'busy'};
}
/* documents changed after `since`, oldest change first, as ready-made JSON text */
async function readSince(env, since){
  let rows = (await env.DB.prepare('SELECT path, data, removed, mtime, seq FROM docs WHERE seq > ? ORDER BY seq, path LIMIT ?').bind(since, PAGE + 1).all()).results || [];
  let more = false, cursor;
  if(rows.length > PAGE){
    more = true;
    const cut = rows[PAGE].seq, kept = rows.filter(r => r.seq < cut);
    if(kept.length){ rows = kept; cursor = kept[kept.length - 1].seq; }
    else { rows = (await env.DB.prepare('SELECT path, data, removed, mtime, seq FROM docs WHERE seq = ? ORDER BY path').bind(cut).all()).results || []; cursor = cut; }
  } else {
    cursor = Math.max(since, Number(await metaGet(env, 'seq')) || 0);
  }
  const docs = '[' + rows.map(r => `{"path":${JSON.stringify(r.path)},"data":${r.data},"removed":${r.removed || '[]'},"mtime":${r.mtime || 0},"seq":${r.seq}}`).join(',') + ']';
  return {docs, more, cursor};
}
async function handleSync(req, env){
  const body = await readJson(req), now = Date.now();
  const since = Math.max(0, Math.floor(Number(body.since) || 0));
  const incoming = cleanIncoming(body.docs).slice(0, MAX_PUSH_DOCS);
  const gen = await getGen(env);
  if(incoming.length) await writeDocs(env, incoming, now);
  const page = await readSince(env, since);
  const vapid = await getVapid(env);
  return reply(req, env, 200, `{"ok":true,"gen":${JSON.stringify(gen)},"now":${now},"cursor":${page.cursor},"more":${page.more},"accepted":${incoming.length},"vapid":${JSON.stringify(vapid.publicKey)},"docs":${page.docs}}`);
}

/* ---------- push subscriptions ---------- */
const testHosts = env => String(env.PUSH_TEST_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
async function handleSubscribe(req, env){
  const b = await readJson(req), sub = b.subscription || {}, keys = sub.keys || {};
  if(!validEndpoint(sub.endpoint, testHosts(env)) || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') throw {status:400, error:'bad_subscription'};
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO push_subs (endpoint, p256dh, auth, device, created, updated, fails) VALUES (?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, updated = excluded.updated, fails = 0`)
    .bind(sub.endpoint, keys.p256dh, keys.auth, String(b.device || '').slice(0, 60), now, now).run();
  /* a device that re-subscribes gets a new address; drop its old one */
  if(typeof b.replaces === 'string' && b.replaces && b.replaces !== sub.endpoint) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(b.replaces).run();
  return reply(req, env, 200, {ok:true});
}
async function handleUnsubscribe(req, env){
  const b = await readJson(req);
  if(typeof b.endpoint === 'string') await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(b.endpoint).run();
  return reply(req, env, 200, {ok:true});
}
const appUrl = env => String(env.APP_URL || (origins(env)[0] || '') + '/');
/* works with a plain service-worker push handler and with Safari's built-in "declarative" push */
const payloadFor = (env, title, body, tag) => ({web_push:8030, notification:{title, body, navigate:appUrl(env), tag, silent:false}});
async function deliver(env, subs, payload, opts){
  const vapid = await getVapid(env), out = [];
  for(const sub of subs){
    let status = 0;
    try{ status = await sendPush(sub, payload, vapid, Object.assign({subject:appUrl(env)}, opts)); }catch(e){ status = 0; }
    out.push(status);
    if(status === 404 || status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run();
    else if(status < 200 || status >= 300) await env.DB.prepare('UPDATE push_subs SET fails = fails + 1 WHERE endpoint = ?').bind(sub.endpoint).run();
    else await env.DB.prepare('UPDATE push_subs SET fails = 0 WHERE endpoint = ? AND fails > 0').bind(sub.endpoint).run();
  }
  return out;
}
const allSubs = async env => (await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subs ORDER BY updated DESC LIMIT 10').all()).results || [];

/* ---------- reminders ---------- */
/* settings, timer and the logs are all the senseis need; photos, prefs and the summary stay unread */
async function loadSnapshot(env){
  const rows = (await env.DB.prepare(`SELECT path, data FROM docs WHERE path = 'leaf/main' OR path = 'leaf/timer' OR path LIKE 'leaf/main/%'`).all()).results || [];
  const map = {}; rows.forEach(r => { const v = parseObj(r.data); if(v) map[r.path] = v; });
  return snapshotFromDocs(map);
}
async function runSlot(env, nowMs, slot){
  const report = {at:nowMs, slot, sent:0, status:[], note:''};
  if(!slot){ report.note = 'no slot at this hour'; return report; }
  const subs = await allSubs(env);
  if(!subs.length){ report.note = 'no device has notifications turned on'; await metaSet(env, 'last_run', JSON.stringify(report)); return report; }
  const mark = `${dateAt(nowMs)}|${slot}`;
  if(await metaGet(env, 'last_sent') === mark){ report.note = 'already sent'; return report; }
  const picks = parseObj(await metaGet(env, 'picks')) || {};
  const d = decide({data:await loadSnapshot(env), nowMs, slot, picks});
  if(!d.send){ report.note = 'nothing to say'; await metaSet(env, 'last_run', JSON.stringify(report)); return report; }
  report.status = await deliver(env, subs, payloadFor(env, d.title, d.body, 'leaf-' + slot.toLowerCase()), {ttl:slot === 'LASTCALL' ? 3600 : 3 * 3600, nowMs});
  report.sent = report.status.filter(x => x >= 200 && x < 300).length;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('picks', JSON.stringify(d.picks)),
    env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('last_sent', mark),
    env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('last_run', JSON.stringify(report))
  ]);
  return report;
}
async function handlePreview(req, env, url){
  const slot = String(url.searchParams.get('slot') || '').toUpperCase();
  const at = Number(url.searchParams.get('at')) || Date.now();
  const d = decide({data:await loadSnapshot(env), nowMs:at, slot:TITLES[slot] ? slot : slotAt(at) || 'MORNING', picks:parseObj(await metaGet(env, 'picks')) || {}});
  return reply(req, env, 200, {ok:true, send:d.send, slot:d.slot, today:d.today, title:d.title, body:d.body, chars:d.body.length});
}
async function handleTest(req, env){
  const subs = await allSubs(env);
  if(!subs.length) return reply(req, env, 200, {ok:true, sent:0, devices:0});
  const s = (await loadSnapshot(env)).settings || {};
  const body = `Third Hokage: Notifications are working, ${s.name || 'ninja'}. The village will find you at 5:40, 11:40, 17:40 and 22:40.`;
  const status = await deliver(env, subs, payloadFor(env, 'The Leaf Village', body, 'leaf-test'), {ttl:600});
  return reply(req, env, 200, {ok:true, devices:subs.length, sent:status.filter(x => x >= 200 && x < 300).length, status});
}
async function handleStatus(req, env){
  const n = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM docs) AS docs, (SELECT COUNT(*) FROM push_subs) AS devices').first();
  return reply(req, env, 200, {ok:true, docs:n.docs, devices:n.devices, lastRun:parseObj(await metaGet(env, 'last_run'))});
}

export default {
  async fetch(req, env){
    const url = new URL(req.url), path = url.pathname.replace(/\/+$/, '') || '/';
    try{
      if(req.method === 'OPTIONS') return new Response(null, {status:204, headers:cors(req, env)});
      if(path === '/' || path === '/health') return reply(req, env, 200, {ok:true, app:'leaf-village-sync', ready:!!String(env.LEAF_SYNC_KEY || '').trim()});
      const o = req.headers.get('Origin');
      if(o && origins(env).indexOf(o) < 0) return reply(req, env, 403, {ok:false, error:'origin'});
      if(!(await authorized(req, env))) return reply(req, env, 401, {ok:false, error:'key'});
      if(req.method === 'POST' && path === '/sync') return await handleSync(req, env);
      if(req.method === 'POST' && path === '/push/subscribe') return await handleSubscribe(req, env);
      if(req.method === 'POST' && path === '/push/unsubscribe') return await handleUnsubscribe(req, env);
      if(req.method === 'POST' && path === '/push/test') return await handleTest(req, env);
      if(req.method === 'GET' && path === '/reminders/preview') return await handlePreview(req, env, url);
      if(req.method === 'GET' && path === '/status') return await handleStatus(req, env);
      return reply(req, env, 404, {ok:false, error:'not_found'});
    }catch(e){
      if(e && e.status) return reply(req, env, e.status, {ok:false, error:e.error});
      console.error('request failed', e && e.message);
      return reply(req, env, 500, {ok:false, error:'server'});
    }
  },
  async scheduled(event, env, ctx){
    ctx.waitUntil(runSlot(env, event.scheduledTime, slotAt(event.scheduledTime)).then(r => console.log('reminder', r.slot, r.note || `sent to ${r.sent} of ${r.status.length}`)).catch(e => console.error('reminder failed', e && e.message)));
  }
};
export { runSlot };
