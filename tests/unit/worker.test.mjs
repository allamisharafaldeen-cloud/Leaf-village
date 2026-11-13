/* The sync Worker itself: key check, CORS, pushing and pulling, merging on the server, push subscriptions, the cron. */
import test from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import { makeEnv, call, runSlot } from '../lib-worker.mjs';
import worker from '../../worker/src/index.js';
import { b64u } from '../../worker/src/webpush.js';
import { backup, docsOf, slotTime } from '../lib-data.mjs';

const DAY = 'leaf/main/days/2026-11-10', STUDY = 'leaf/main/study/2026-11-10';
const set = (ex, reps, hhmm) => ({ex, reps, t:`2026-11-10T${hhmm}:00.000Z`});
const sync = (env, since, docs) => call(env, 'POST', '/sync', {since, docs:docs || []});
const byPath = res => Object.fromEntries(res.json.docs.map(d => [d.path, d]));

test('everything except /health needs the sync key', async () => {
  const env = makeEnv();
  assert.equal((await call(env, 'GET', '/health', undefined, {key:null})).status, 200);
  assert.deepEqual((await call(env, 'GET', '/health', undefined, {key:null})).json, {ok:true, app:'leaf-village-sync', ready:true});
  for(const [m, p] of [['POST', '/sync'], ['POST', '/push/subscribe'], ['POST', '/push/test'], ['GET', '/reminders/preview'], ['GET', '/status']]){
    assert.equal((await call(env, m, p, m === 'POST' ? {} : undefined, {key:null})).status, 401, `${p} without a key`);
    assert.equal((await call(env, m, p, m === 'POST' ? {} : undefined, {key:'wrong key'})).status, 401, `${p} with the wrong key`);
  }
  assert.equal((await sync(env, 0)).status, 200);
  const raw = await worker.fetch(new Request('https://worker.test/sync', {method:'POST', headers:{Authorization:'Bearer ' + env.LEAF_SYNC_KEY}, body:'{}'}), env);
  assert.equal(raw.status, 401, 'the key itself is never accepted on the wire, only its fingerprint');
  const noKey = makeEnv({LEAF_SYNC_KEY:''});
  assert.equal((await call(noKey, 'POST', '/sync', {}, {key:''})).status, 401, 'a Worker with no key configured rejects everyone');
  assert.equal((await call(noKey, 'GET', '/health', undefined, {key:null})).json.ready, false);
});

test('browsers are only allowed in from the app on GitHub Pages', async () => {
  const env = makeEnv(), app = 'https://allamisharafaldeen-cloud.github.io';
  const pre = await worker.fetch(new Request('https://worker.test/sync', {method:'OPTIONS', headers:{Origin:app, 'Access-Control-Request-Method':'POST'}}), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), app);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  const ok = await call(env, 'POST', '/sync', {since:0}, {headers:{Origin:app}});
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('Access-Control-Allow-Origin'), app);
  const evil = await call(env, 'POST', '/sync', {since:0}, {headers:{Origin:'https://evil.example'}});
  assert.equal(evil.status, 403); assert.equal(evil.headers.get('Access-Control-Allow-Origin'), null);
  const evilPre = await worker.fetch(new Request('https://worker.test/sync', {method:'OPTIONS', headers:{Origin:'https://evil.example'}}), env);
  assert.equal(evilPre.headers.get('Access-Control-Allow-Origin'), null);
});

test('first sync uploads a whole backup; a second device pulls all of it down', async () => {
  const env = makeEnv(), docs = docsOf(backup()), paths = Object.keys(docs);
  let cursor = 0, gen = null;
  for(let i = 0; i < paths.length; i += 20){
    const res = await sync(env, cursor, paths.slice(i, i + 20).map(p => ({path:p, data:docs[p], mtime:0})));
    assert.equal(res.status, 200); cursor = res.json.cursor; gen = res.json.gen;
  }
  const pulled = {}; let since = 0, pages = 0, more = true;
  while(more){ const res = await sync(env, since); res.json.docs.forEach(d => { pulled[d.path] = d.data; }); since = res.json.cursor; more = res.json.more; pages++; assert.equal(res.json.gen, gen); assert.ok(pages < 20); }
  assert.equal(Object.keys(pulled).length, paths.length);
  paths.forEach(p => assert.deepEqual(pulled[p], docs[p], p));
  assert.equal(since, cursor);
  assert.deepEqual((await sync(env, since)).json.docs, [], 'nothing new after that');
  assert.equal((await call(env, 'GET', '/status')).json.docs, paths.length);
});

test('pulling pages through a large history misses nothing', async () => {
  const env = makeEnv(), want = new Set();
  for(let i = 0; i < 700; i += 20){
    const docs = Array.from({length:20}, (_, k) => { const n = i + k, date = new Date(Date.UTC(2024, 0, 1) + n * 86400000).toISOString().slice(0, 10); want.add(`leaf/main/days/${date}`); return {path:`leaf/main/days/${date}`, data:{date, sets:[{ex:'pullups', reps:5, t:`${date}T05:00:00.000Z`}]}}; });
    assert.equal((await sync(env, 0, docs)).status, 200);
  }
  const got = new Set(); let since = 0, more = true, pages = 0;
  while(more){ const res = await sync(env, since); res.json.docs.forEach(d => got.add(d.path)); assert.ok(res.json.cursor > since || !res.json.more); since = res.json.cursor; more = res.json.more; pages++; }
  assert.equal(got.size, 700); assert.ok(pages >= 3, `paged (${pages} pages)`);
  want.forEach(p => assert.ok(got.has(p)));
});

test('two devices log different sets on the same day: the server keeps every one', async () => {
  const env = makeEnv();
  const a = await sync(env, 0, [{path:DAY, data:{date:'2026-11-10', sets:[set('pullups', 6, '05:00'), set('pullups', 6, '09:00')]}}]);
  const b = await sync(env, 0, [{path:DAY, data:{date:'2026-11-10', sets:[set('pullups', 7, '07:00')]}}]);
  assert.deepEqual(byPath(b)[DAY].data.sets.map(x => x.t.slice(11, 16)), ['05:00', '07:00', '09:00'], 'device B gets the merged day straight back');
  const a2 = await sync(env, a.json.cursor);
  assert.equal(byPath(a2)[DAY].data.sets.length, 3, 'device A picks up B\'s set on its next sync');
  const again = await sync(env, b.json.cursor, [{path:DAY, data:{date:'2026-11-10', sets:[set('pullups', 7, '07:00')]}}]);
  assert.deepEqual(again.json.docs, [], 'sending an older copy changes nothing and loses nothing');
  assert.equal(again.json.cursor, b.json.cursor);
});

test('Undo travels: the removed set goes away on the server and on the other device, and stays away', async () => {
  const env = makeEnv(), full = {date:'2026-11-10', sets:[set('pullups', 6, '05:00'), set('pullups', 9, '07:00')]};
  const first = await sync(env, 0, [{path:DAY, data:full}]);
  const undone = await sync(env, first.json.cursor, [{path:DAY, data:{date:'2026-11-10', sets:[full.sets[0]]}, removed:[JSON.stringify(['pullups', 9, '2026-11-10T07:00:00.000Z'])]}]);
  assert.equal(byPath(undone)[DAY].data.sets.length, 1);
  assert.equal(byPath(undone)[DAY].removed.length, 1, 'the other device is told what was removed');
  const stale = await sync(env, undone.json.cursor, [{path:DAY, data:full}]);
  assert.deepEqual(stale.json.docs, [], 'a device that still has the undone set cannot bring it back');
  assert.equal(byPath(await sync(env, 0))[DAY].data.sets.length, 1);
});

test('study days merge the same way, and a shield is never lost', async () => {
  const env = makeEnv(), e = (s, t, min) => ({start:`2026-11-10T${s}:00.000Z`, end:`2026-11-10T${t}:00.000Z`, min, src:'timer'});
  await sync(env, 0, [{path:STUDY, data:{date:'2026-11-10', entries:[e('05:00', '07:00', 120)], shield:true}}]);
  const res = await sync(env, 0, [{path:STUDY, data:{date:'2026-11-10', entries:[e('08:00', '09:30', 90)]}}]);
  const doc = byPath(res)[STUDY].data;
  assert.equal(doc.entries.reduce((n, x) => n + x.min, 0), 210);
  assert.equal(doc.shield, true);
});

test('settings and the like: the latest edit wins, whichever device syncs last', async () => {
  const env = makeEnv(), now = Date.now();
  await sync(env, 0, [{path:'leaf/main', data:{name:'Sharaf', v:2}, mtime:now - 1000}]);
  const older = await sync(env, 0, [{path:'leaf/main', data:{name:'Sharaf', v:1}, mtime:now - 60000}]);
  assert.equal(byPath(older)['leaf/main'].data.v, 2, 'an older edit arriving late does not overwrite a newer one');
  const newer = await sync(env, 0, [{path:'leaf/main', data:{name:'Sharaf', v:3}, mtime:now - 500}]);
  assert.equal(byPath(newer)['leaf/main'].data.v, 3);
  const future = await sync(env, 0, [{path:'leaf/timer', data:{state:'running'}, mtime:now + 86400000 * 365}]);
  assert.ok(byPath(future)['leaf/timer'].mtime <= Date.now(), 'a device with a wrong clock cannot claim the future');
  const fixed = await sync(env, 0, [{path:'leaf/timer', data:{state:'idle'}, mtime:Date.now() + 5}]);
  assert.equal(byPath(fixed)['leaf/timer'].data.state, 'idle');
  const weigh = 'leaf/main/body/2026-11-12';
  await sync(env, 0, [{path:weigh, data:{date:'2026-11-12', weight:73.2}, mtime:now - 100}]);
  assert.equal(byPath(await sync(env, 0, [{path:weigh, data:{date:'2026-11-12', weight:72.9}, mtime:now - 50}]))[weigh].data.weight, 72.9);
});

test('junk is ignored: unknown paths, wrong shapes, oversized documents', async () => {
  const env = makeEnv();
  const res = await sync(env, 0, [{path:'leaf/secrets', data:{a:1}}, {path:'../etc', data:{}}, {path:DAY, data:'not an object'}, {path:STUDY, data:[1, 2]},
    {path:'leaf/media', data:{blob:'x'.repeat(500000)}}, null, 7, {path:'leaf/prefs', data:{anim:'full'}, mtime:1}]);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.docs.map(d => d.path), ['leaf/prefs']);
  const bad = await worker.fetch(new Request('https://worker.test/sync', {method:'POST', headers:{Authorization:(await call(env, 'GET', '/health')).status && 'Bearer x'}, body:'{{'}), env);
  assert.equal(bad.status, 401);
  assert.equal((await call(env, 'POST', '/nowhere', {})).status, 404);
});

test('two requests writing the same day at the same moment both land', async () => {
  const env = makeEnv();
  const pushes = Array.from({length:8}, (_, i) => sync(env, 0, [{path:DAY, data:{date:'2026-11-10', sets:[set('pullups', 5 + i, `0${i}:30`)]}}]));
  (await Promise.all(pushes)).forEach(r => assert.equal(r.status, 200));
  assert.equal(byPath(await sync(env, 0))[DAY].data.sets.length, 8);
});

test('the push keys are made once and stay the same', async () => {
  const env = makeEnv();
  const k1 = (await sync(env, 0)).json.vapid, k2 = (await sync(env, 0)).json.vapid;
  assert.equal(k1, k2); assert.match(k1, /^[A-Za-z0-9_-]{86,88}$/);
  const row = env.DB.raw.prepare(`SELECT value FROM meta WHERE key = 'vapid'`).get();
  assert.equal(JSON.parse(row.value).publicKey, k1);
});

test('push subscriptions are stored, replaced and removed', async () => {
  const env = makeEnv(), keys = {p256dh:'BPk', auth:'abc'};
  assert.equal((await call(env, 'POST', '/push/subscribe', {subscription:{endpoint:'https://evil.example/hook', keys}})).status, 400);
  assert.equal((await call(env, 'POST', '/push/subscribe', {subscription:{endpoint:'https://web.push.apple.com/one', keys}, device:'iPad'})).status, 200);
  assert.equal((await call(env, 'POST', '/push/subscribe', {subscription:{endpoint:'https://web.push.apple.com/one', keys}, device:'iPad'})).status, 200);
  assert.equal((await call(env, 'GET', '/status')).json.devices, 1, 'subscribing twice is still one device');
  await call(env, 'POST', '/push/subscribe', {subscription:{endpoint:'https://web.push.apple.com/two', keys}, device:'iPad', replaces:'https://web.push.apple.com/one'});
  assert.equal((await call(env, 'GET', '/status')).json.devices, 1);
  await call(env, 'POST', '/push/unsubscribe', {endpoint:'https://web.push.apple.com/two'});
  assert.equal((await call(env, 'GET', '/status')).json.devices, 0);
});

test('the cron reads the synced data, sends one encrypted notification per device, and forgets dead subscriptions', async () => {
  const env = makeEnv(), docs = docsOf(backup()), paths = Object.keys(docs);
  for(let i = 0; i < paths.length; i += 20) await sync(env, 0, paths.slice(i, i + 20).map(p => ({path:p, data:docs[p], mtime:0})));
  const sub = () => { const e = nodeCrypto.createECDH('prime256v1'); e.generateKeys(); return {p256dh:b64u(e.getPublicKey()), auth:b64u(nodeCrypto.randomBytes(16))}; };
  await call(env, 'POST', '/push/subscribe', {subscription:{endpoint:'https://web.push.apple.com/ipad', keys:sub()}, device:'iPad'});
  await call(env, 'POST', '/push/subscribe', {subscription:{endpoint:'https://web.push.apple.com/gone', keys:sub()}, device:'old phone'});
  const sent = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({url, init}); return {status:String(url).endsWith('/gone') ? 410 : 201}; };
  try{
    const when = slotTime('2026-11-13', 'MORNING');            // Friday: test day
    const preview = await call(env, 'GET', `/reminders/preview?slot=MORNING&at=${when}`);
    assert.equal(preview.json.send, true); assert.match(preview.json.body, /^Guy: /); assert.match(preview.json.body, /Third Hokage: /);
    assert.equal(sent.length, 0, 'a preview sends nothing');
    const r = await runSlot(env, when, 'MORNING');
    assert.equal(sent.length, 2); assert.equal(r.sent, 1);
    sent.forEach(s => { assert.equal(s.init.headers['Content-Encoding'], 'aes128gcm'); assert.match(s.init.headers.Authorization, /^vapid t=/); assert.ok(s.init.body.length > 100); });
    assert.equal((await call(env, 'GET', '/status')).json.devices, 1, 'the dead subscription was removed');
    const again = await runSlot(env, when + 60000, 'MORNING');
    assert.equal(again.note, 'already sent'); assert.equal(sent.length, 2, 'the same slot is never sent twice');
    const quiet = await runSlot(env, slotTime('2026-11-12', 'MIDDAY'), 'MIDDAY');   // Thursday rest day, nothing to say
    assert.equal(quiet.note, 'nothing to say'); assert.equal(sent.length, 2);
    const t = await call(env, 'POST', '/push/test', {});
    assert.equal(t.json.sent, 1); assert.equal(sent.length, 3);
    let scheduled = null;
    await worker.scheduled({scheduledTime:slotTime('2026-11-13', 'EVENING')}, env, {waitUntil:p => { scheduled = p; }});
    await scheduled;
    assert.equal(sent.length, 4, 'the scheduled handler picks the slot from the clock');
    await worker.scheduled({scheduledTime:slotTime('2026-11-13', 'EVENING') + 3600000}, env, {waitUntil:p => { scheduled = p; }});
    await scheduled;
    assert.equal(sent.length, 4, 'an hour that is not a slot sends nothing');
  } finally { globalThis.fetch = realFetch; }
});

test('with no device subscribed the cron does no work at all', async () => {
  const env = makeEnv();
  const r = await runSlot(env, slotTime('2026-11-13', 'MORNING'), 'MORNING');
  assert.equal(r.sent, 0); assert.match(r.note, /no device/);
});
