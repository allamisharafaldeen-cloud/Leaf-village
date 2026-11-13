/* The app in a real browser (Chromium), served under /Leaf-village/ like GitHub Pages, syncing against the
   real Worker code. "Devices" are separate browser profiles. The clock is fixed to Sunday 15 Nov 2026, Baghdad. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import nodeCrypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startRig, KEY, until, sleep } from '../lib-browser.mjs';
import { runSlot } from '../lib-worker.mjs';
import { computeAll, snapshotFromDocs } from '../../worker/src/engine.js';
import { b64u } from '../../worker/src/webpush.js';
import M from '../../leaf-merge.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/backup.json', import.meta.url));
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const SHOTS = fileURLToPath(new URL('../.tmp/', import.meta.url));
const T0 = Date.parse('2026-11-15T07:00:00Z');            // Sunday 10:00 in Baghdad: a pull-up groove day
const TODAY = 'leaf/main/days/2026-11-15', STUDY_TODAY = 'leaf/main/study/2026-11-15';
const min = n => n * 60000;
let rig, A, B;
const serverDocs = () => Object.fromEntries(rig.env.DB.raw.prepare('SELECT path, data FROM docs').all().map(r => [r.path, JSON.parse(r.data)]));
const noErrors = () => assert.deepEqual(rig.errors, [], 'no page errors');
const logged = docs => Object.keys(docs).filter(p => M.isEntries(p)).sort().map(p => [p, M.entryKeys(p, docs[p]).slice().sort()]);

before(async () => { rig = await startRig(8931); });
after(async () => { if(rig) await rig.stop(); });

test('import: the backup file comes in whole, and the app opens on it', async () => {
  A = await rig.device('iPad', {now:T0});
  await A.open();
  assert.equal(await A.page.locator('[data-act="setup-save"]').count(), 1, 'a new device starts at the enrollment screen');
  await A.importBackup(FIXTURE);
  const docs = await A.docs();
  assert.deepEqual(docs['leaf/main'], fixture.settings);
  Object.keys(fixture.days).forEach(d => assert.deepEqual(docs[`leaf/main/days/${d}`], fixture.days[d], d));
  Object.keys(fixture.study).forEach(d => assert.deepEqual(docs[`leaf/main/study/${d}`], fixture.study[d], d));
  Object.keys(fixture.body).forEach(d => assert.deepEqual(docs[`leaf/main/body/${d}`], fixture.body[d], d));
  assert.match(await A.page.locator('.mb-top b, .rank-name, h1').first().textContent(), /\S/);
  noErrors();
});

test('export: Download backup gives the same file format and the same data back', async () => {
  await A.tab('settings');
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.click('[data-act="backup"]')]);
  assert.match(dl.suggestedFilename(), /^leaf-village-backup-2026-11-15\.json$/);
  const out = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  assert.deepEqual(Object.keys(out).sort(), Object.keys(fixture).sort(), 'same top-level fields as before');
  assert.equal(out.app, 'The Leaf Village');
  ['settings', 'days', 'study', 'body', 'studyStart', 'examWeeks', 'timer'].forEach(k => assert.deepEqual(out[k], fixture[k], k));
  assert.ok(!JSON.stringify(out).includes('leaf-sync'), 'no sync bookkeeping leaks into the backup');
  noErrors();
});

test('the engine in the Worker agrees with the engine in the app', async () => {
  await A.tab('mission');
  const summary = await until(async () => (await A.docs())['leaf/summary'], 'the app to write its summary');
  const C = computeAll(snapshotFromDocs(await A.docs()), T0);
  assert.equal(C.today, '2026-11-15'); assert.equal(summary.today, C.today);
  assert.equal(summary.xp, C.total, 'total XP');
  assert.equal(summary.rank, C.rank); assert.equal(summary.nextRank, C.nextRank); assert.equal(summary.xpToNext, C.xpToNext);
  assert.equal(summary.streak, C.streak); assert.equal(summary.bestStreak, C.bestStreak);
  assert.deepEqual(summary.maxes, C.maxes); assert.deepEqual(summary.best, C.best);
  assert.equal(summary.study.streak, C.study.streak); assert.equal(summary.study.best, C.study.best);
  summary.recent.forEach(r => { const d = C.days.find(x => x.date === r.date); assert.equal(d.status, r.status, r.date); assert.equal(d.xp, r.xp, `${r.date} xp`); assert.equal((C.study.days[r.date] || {}).xp || 0, r.studyXp, `${r.date} study xp`); });
  summary.study.recent.forEach(r => { assert.equal(C.study.days[r.date].status, r.status, r.date); assert.equal(Math.round(C.study.days[r.date].mins), r.minutes, r.date); });
  const up = summary.upcoming['2026-11-15'], t = C.todayRec;
  assert.equal(up.type, t.plan.type); assert.equal(up.target, t.info.target); assert.equal(up.need, t.info.need);
});

test('sync unreachable: the app keeps working, says so in plain words, and catches up later', async () => {
  rig.worker.offline = true;
  await A.turnOnSync();
  let st = await A.status();
  assert.equal(st.error, 'offline');
  assert.match(await A.page.locator('#sync-status').textContent(), /No internet right now\. Your logs are safe on this device/);
  assert.equal(await A.page.locator('#banner .banner').count(), 0, 'no error banner: sync trouble never interrupts the app');
  await A.setTime(T0 + min(1));
  await A.logSet(8);
  await until(async () => ((await A.docs())[TODAY] || {sets:[]}).sets.length === 1, 'the set to be saved on the device');
  assert.match(await A.page.locator('#toast').textContent(), /8 pull-ups logged/);
  assert.equal(Object.keys(serverDocs()).length, 0, 'nothing reached the server');
  rig.worker.offline = false;
  assert.equal(await A.sync(), true);
  st = await A.status();
  assert.equal(st.error, null); assert.equal(st.waiting, 0);
  const local = await A.docs(), remote = serverDocs();
  Object.keys(local).filter(p => p !== 'leaf/summary').forEach(p => assert.deepEqual(remote[p], local[p], `first sync uploaded ${p}`));
  await A.tab('settings');
  assert.match(await A.page.locator('#sync-status').textContent(), /^Synced just now\. Everything is saved online\./);
  noErrors();
});

test('a second device types the key on the enrollment screen and the whole village comes down', async () => {
  B = await rig.device('phone', {now:T0 + min(2), viewport:{width:390, height:844}});
  await B.open();
  assert.equal(await B.page.locator('[data-act="setup-save"]').count(), 1);
  await B.page.fill('#sync-key', KEY);
  await B.page.click('[data-act="sync-on"]');
  await B.page.waitForSelector('nav a[aria-current="page"]');
  const a = await A.docs(), b = await B.docs();
  Object.keys(a).filter(p => p !== 'leaf/summary').forEach(p => assert.deepEqual(b[p], a[p], p));
  const [sa, sb] = await until(async () => { const x = (await A.docs())['leaf/summary'], y = (await B.docs())['leaf/summary']; return x && y && x.xp === y.xp ? [x, y] : null; }, 'both devices to show the same XP');
  assert.equal(sb.rank, sa.rank); assert.equal(sb.streak, sa.streak); assert.deepEqual(sb.maxes, sa.maxes);
  noErrors();
});

test('a wrong key is refused and explained; nothing is uploaded or changed', async () => {
  const C = await rig.device('stranger', {now:T0});
  await C.open();
  await C.page.fill('#sync-key', 'not the key');
  await C.page.click('[data-act="sync-on"]');
  await until(async () => (await C.status()).error === 'key', 'the key to be refused');
  assert.match(await C.page.locator('section.card:has(#sync-key) .notice').textContent(), /sync key doesn't match/);
  assert.equal(Object.keys(await C.docs()).filter(p => p.startsWith('leaf/main')).length, 0, 'the stranger got nothing');
  await C.close();
  noErrors();
});

test('two devices log while offline: after syncing, both hold every set and every study minute', async () => {
  rig.worker.offline = true;
  await A.setTime(T0 + min(10)); await A.logSet(8);
  await B.setTime(T0 + min(20)); await B.logSet(9);
  await A.setTime(T0 + min(30)); await A.logSet(8);
  await B.setTime(T0 + min(40));
  await B.page.evaluate(() => { const sc = document.querySelector('.mscroll.study'); if(sc && !sc.classList.contains('open')) sc.querySelector('[data-act="scroll-toggle"]').click(); });
  await B.page.evaluate(() => document.querySelector('[data-act="st-add"][data-min="30"]').click());
  await A.setTime(T0 + min(50));
  await A.page.evaluate(() => { const sc = document.querySelector('.mscroll.study'); if(sc && !sc.classList.contains('open')) sc.querySelector('[data-act="scroll-toggle"]').click(); });
  await A.page.evaluate(() => document.querySelector('[data-act="st-add"][data-min="60"]').click());
  await until(async () => ((await A.docs())[STUDY_TODAY] || {entries:[]}).entries.length === 1 && (await A.docs())[TODAY].sets.length === 3, 'A to save');
  await until(async () => ((await B.docs())[STUDY_TODAY] || {entries:[]}).entries.length === 1 && (await B.docs())[TODAY].sets.length === 2, 'B to save');
  rig.worker.offline = false;
  assert.equal(await A.sync(), true); assert.equal(await B.sync(), true); assert.equal(await A.sync(), true);
  const a = await A.docs(), b = await B.docs(), s = serverDocs();
  const times = d => d[TODAY].sets.map(x => `${x.reps}@${(Date.parse(x.t) - T0) / 60000}`);
  assert.deepEqual(times(a), ['8@1', '8@10', '9@20', '8@30'], 'iPad: all four sets, in the order they were done');
  assert.deepEqual(times(b), times(a)); assert.deepEqual(times(s), times(a));
  [a, b, s].forEach(d => assert.equal(d[STUDY_TODAY].entries.reduce((n, e) => n + e.min, 0), 90, '30 + 60 study minutes'));
  assert.deepEqual(logged(a), logged(b), 'both devices hold exactly the same logs');
  assert.deepEqual(logged(a), logged(s), 'and so does the online copy');
  Object.keys(fixture.days).forEach(d => assert.deepEqual(a[`leaf/main/days/${d}`], fixture.days[d], `past day ${d} untouched`));
  const sa = await until(async () => { const x = (await A.docs())['leaf/summary'], y = (await B.docs())['leaf/summary']; return x && y && x.xp === y.xp ? x : null; }, 'both devices to show the same XP');
  assert.ok(sa.xp > 0);
  noErrors();
});

test('Undo still removes only the most recent entry, and the other device follows', async () => {
  await A.setTime(T0 + min(60));
  await A.tab('mission');
  await A.page.evaluate(() => document.querySelector('[data-act="undo"]').click());
  assert.match(await A.page.locator('[data-act="undo"]').textContent(), /Tap again to remove 8 pull-ups/);
  await A.page.evaluate(() => document.querySelector('[data-act="undo"]').click());
  await until(async () => (await A.docs())[TODAY].sets.length === 3, 'the last set to go');
  const times = d => d[TODAY].sets.map(x => `${x.reps}@${(Date.parse(x.t) - T0) / 60000}`);
  assert.deepEqual(times(await A.docs()), ['8@1', '8@10', '9@20'], 'only the latest set (8 at minute 30) was removed');
  assert.equal(await B.sync(), true, 'the phone syncs before the iPad has uploaded the undo');
  assert.equal(await A.sync(), true); assert.equal(await B.sync(), true); assert.equal(await A.sync(), true);
  assert.deepEqual(times(await B.docs()), ['8@1', '8@10', '9@20'], 'the phone dropped the same set and did not bring it back');
  assert.deepEqual(times(serverDocs()), ['8@1', '8@10', '9@20']);
  assert.deepEqual(times(await A.docs()), ['8@1', '8@10', '9@20']);
  /* study undo */
  await B.setTime(T0 + min(70)); await B.tab('mission');
  await B.page.evaluate(() => document.querySelector('[data-act="st-undo"]').click());
  await B.page.evaluate(() => document.querySelector('[data-act="st-undo"]').click());
  await until(async () => (await B.docs())[STUDY_TODAY].entries.length === 1, 'the last study entry to go');
  assert.equal((await B.docs())[STUDY_TODAY].entries[0].min, 30, 'the later entry (1 hour, logged at minute 50) was the one removed');
  await B.sync(); await A.sync();
  assert.deepEqual((await A.docs())[STUDY_TODAY], (await B.docs())[STUDY_TODAY]);
  assert.equal(await A.page.locator('[data-act="undo"]').count(), 1);
  assert.equal(await A.page.locator('.day-edit, [data-act="edit-day"], [data-act="delete-day"]').count(), 0, 'there is still no way to edit a past day');
  const online = serverDocs();
  Object.keys(fixture.days).forEach(d => assert.deepEqual(online[`leaf/main/days/${d}`], fixture.days[d]));
  noErrors();
});

test('settings: the latest edit wins and reaches the other device (reminder switches)', async () => {
  await A.setTime(T0 + min(80)); await A.tab('settings');
  assert.equal(await A.page.locator('[data-act="notify"]').count(), 7, 'seven reminder switches');
  await A.page.evaluate(() => document.querySelector('[data-act="notify"][data-k="weekly"]').click());
  await until(async () => ((await A.docs())['leaf/main'].notify || {}).weekly === false, 'the switch to save');
  await A.sync(); await B.sync();
  assert.equal((await B.docs())['leaf/main'].notify.weekly, false);
  assert.equal(serverDocs()['leaf/main'].notify.weekly, false);
  await B.setTime(T0 + min(90)); await B.tab('settings');
  assert.equal(await B.page.locator('[data-act="notify"][data-k="weekly"]').getAttribute('aria-checked'), 'false');
  await B.page.evaluate(() => document.querySelector('[data-act="notify"][data-k="enabled"]').click());
  await until(async () => ((await B.docs())['leaf/main'].notify || {}).enabled === false, 'the master switch to save');
  assert.equal(await B.page.locator('[data-act="notify"][data-k="study"]').isDisabled(), true, 'master switch off greys out the rest');
  await B.page.evaluate(() => document.querySelector('[data-act="notify"][data-k="enabled"]').click());
  await until(async () => (await B.docs())['leaf/main'].notify.enabled === true, 'the master switch back on');
  await B.sync(); await A.sync();
  assert.deepEqual((await A.docs())['leaf/main'], (await B.docs())['leaf/main']);
  noErrors();
});

test('importing a backup again with sync on keeps the logs made since', async () => {
  await A.tab('settings');
  await A.importBackup(FIXTURE);
  await until(async () => { const s = await A.status(); return s.state === 'idle' && s.waiting === 0 && s.last > 0; }, 'the import to sync');
  await A.sync();
  const a = await A.docs();
  assert.equal(a[TODAY].sets.length, 3, 'today\'s sets came back from the online copy');
  assert.equal(a['leaf/main'].notify, undefined, 'the imported settings replaced the newer ones, as "Replace with backup" says');
  await B.sync();
  assert.deepEqual(logged(await B.docs()), logged(a));
  noErrors();
});

test('fully offline with the service worker: the app opens from its cache and logging still works', async () => {
  const D = await rig.device('offline iPad', {now:T0 + min(100), serviceWorkers:'allow'});
  await D.open();
  await D.page.evaluate(() => navigator.serviceWorker.ready);
  await until(() => D.page.evaluate(() => !!navigator.serviceWorker.controller), 'the service worker to take control', 60000);
  await D.importBackup(FIXTURE);
  await D.ctx.setOffline(true);
  await D.page.reload({waitUntil:'domcontentloaded'});
  await D.page.waitForSelector('nav a[aria-current="page"]');
  assert.equal(await D.page.evaluate(() => typeof window.LeafSync), 'object', 'platform.js and leaf-merge.js came from the cache');
  await D.logSet(8);
  await until(async () => ((await D.docs())[TODAY] || {sets:[]}).sets.length === 1, 'the set to be saved offline');
  await D.ctx.setOffline(false);
  await D.close();
  noErrors();
});

test('notifications: tap to turn on, the subscription is stored, and a sensei reminder arrives and is shown', async () => {
  /* a pretend push service: it receives exactly what Apple's would, and we decrypt it the way the iPad would */
  const ecdh = nodeCrypto.createECDH('prime256v1'); ecdh.generateKeys(); const auth = nodeCrypto.randomBytes(16);
  const got = [];
  const pushServer = http.createServer(async (req, res) => { const chunks = []; for await (const c of req) chunks.push(c); got.push({headers:req.headers, body:Buffer.concat(chunks)}); res.writeHead(201); res.end(); });
  await new Promise(r => pushServer.listen(rig.pushPort, '127.0.0.1', r));
  const hk = (salt, ikm, info, len) => Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, info, len));
  const decrypt = body => {
    const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
    const ikm = hk(auth, ecdh.computeSecret(asPub), Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPub]), 32);
    const d = nodeCrypto.createDecipheriv('aes-128-gcm', hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12));
    d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    return JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8'));
  };
  try{
    const P = await rig.device('iPad with notifications', {now:T0 + min(110), serviceWorkers:'allow', permissions:['notifications']});
    const fake = {endpoint:`http://127.0.0.1:${rig.pushPort}/push/ipad-1`, keys:{p256dh:b64u(ecdh.getPublicKey()), auth:b64u(auth)}};
    await P.ctx.addInitScript(sub => {
      /* headless Chromium always answers "denied", so the permission question is played by the test: asked once, allowed */
      let perm = 'default'; window.__asked = 0;
      Object.defineProperty(Notification, 'permission', {get:() => perm, configurable:true});
      Notification.requestPermission = async () => { window.__asked++; perm = 'granted'; return perm; };
      let current = null; window.__subscribeCalls = [];
      const make = opts => ({endpoint:sub.endpoint, options:opts, toJSON:() => sub, unsubscribe:async () => { current = null; return true; }});
      PushManager.prototype.subscribe = async function(opts){ window.__subscribeCalls.push({userVisibleOnly:opts.userVisibleOnly, keyBytes:new Uint8Array(opts.applicationServerKey).length}); current = make(opts); return current; };
      PushManager.prototype.getSubscription = async function(){ return current; };
    }, fake);
    await P.open();
    await until(() => P.page.evaluate(() => !!navigator.serviceWorker.controller), 'the service worker to take control', 60000);
    await P.importBackup(FIXTURE);
    await P.tab('settings');
    assert.match(await P.page.locator('section.card:has(.alarm-list)').textContent(), /Turn on Sync first/);
    assert.equal(await P.page.locator('[data-act="push-on"]').count(), 0, 'no button until sync is on');
    await P.turnOnSync();
    await P.page.click('[data-act="push-on"]');
    await P.page.waitForSelector('[data-act="push-test"]');
    assert.match(await P.page.locator('section.card:has(.alarm-list)').textContent(), /Notifications are on for this device/);
    assert.equal(await P.page.evaluate(() => window.__asked), 1, 'the permission question was asked once, from the tap');
    assert.deepEqual(await P.page.evaluate(() => window.__subscribeCalls), [{userVisibleOnly:true, keyBytes:65}], 'subscribed once with the Worker\'s public key');
    const subs = rig.env.DB.raw.prepare('SELECT endpoint, device FROM push_subs').all();
    assert.equal(subs.length, 1); assert.equal(subs[0].endpoint, fake.endpoint);

    await P.page.click('[data-act="push-test"]');
    await until(() => got.length === 1, 'the test notification to reach the push service');
    assert.equal(got[0].headers['content-encoding'], 'aes128gcm'); assert.match(got[0].headers.authorization, /^vapid t=/);
    const testMsg = decrypt(got[0].body);
    assert.match(testMsg.notification.body, /^Third Hokage: Notifications are working, Sharaf\./);

    /* the 5:40 cron on a Monday (mixed day): Kakashi's briefing and the Third Hokage's study target */
    const when = Date.parse('2026-11-16T02:40:00Z');
    const report = await runSlot(rig.env, when, 'MORNING');
    assert.equal(report.sent, 1);
    await until(() => got.length === 2, 'the morning briefing to reach the push service');
    const msg = decrypt(got[1].body);
    assert.equal(msg.web_push, 8030); assert.equal(msg.notification.title, 'Morning briefing');
    assert.match(msg.notification.body, /^Kakashi: .*3 × 8 pull-ups and 3 × 13 dips.*\nThird Hokage: .*4h.*6h/s);
    assert.ok(msg.notification.body.length < 320);
    assert.equal(msg.notification.navigate, rig.appUrl);

    /* hand that message to the app's service worker, as the system would, and see what it shows */
    const sw = P.ctx.serviceWorkers()[0];
    const shown = await sw.evaluate(async json => {
      const out = []; self.registration.showNotification = async (title, o) => { out.push({title, body:o.body, tag:o.tag, icon:o.icon, url:o.data && o.data.url}); };
      const waits = []; const ev = new PushEvent('push', {data:json}); const real = ev.waitUntil.bind(ev); ev.waitUntil = p => { waits.push(p); return real(p); };
      self.dispatchEvent(ev); await Promise.all(waits); await new Promise(r => setTimeout(r, 100));
      return out;
    }, JSON.stringify(msg));
    assert.equal(shown.length, 1, 'exactly one notification is shown per push');
    assert.equal(shown[0].title, 'Morning briefing'); assert.equal(shown[0].body, msg.notification.body); assert.equal(shown[0].url, rig.appUrl); assert.equal(shown[0].tag, 'leaf-morning');

    await P.page.click('[data-act="push-off"]');
    await until(() => rig.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n === 0, 'the subscription to be removed');
    await P.page.waitForSelector('[data-act="push-on"]');
    await P.close();
  } finally { await new Promise(r => pushServer.close(r)); }
  noErrors();
});

test('iPad screenshots of the Sync and Reminders cards (looked at by hand)', async () => {
  for(const [name, viewport] of [['portrait', {width:820, height:1180}], ['landscape', {width:1148, height:802}]]){
    const S = await rig.device('shot ' + name, {now:T0 + min(120), viewport});
    await S.open(); await S.importBackup(FIXTURE); await S.turnOnSync();
    await S.page.locator('section.card:has(#sync-status)').scrollIntoViewIfNeeded();
    await S.page.evaluate(() => window.scrollBy(0, -90));
    await S.page.screenshot({path:`${SHOTS}settings-${name}.png`});
    await S.close();
  }
  noErrors();
});
