/* The friends' copy (open/) on a phone that already has Sharaf's village: a fresh setup with other exercises, its own
   storage, no sync or notifications, no forms, crest art; and Sharaf's village is still there afterwards. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startRig, until, sleep } from '../lib-browser.mjs';

const FIXTURE = fileURLToPath(new URL('../fixtures/backup.json', import.meta.url));
const T0 = Date.parse('2026-11-15T07:00:00Z');   // Sunday 10:00 in Baghdad
let rig;
before(async () => { rig = await startRig(8951); });
after(async () => { await rig.stop(); });

test('friends\' copy: own setup, own storage, no sync, no forms; the main village is untouched', async () => {
  const d = await rig.device('phone', {now:T0, viewport:{width:390, height:844}});
  await d.open(); await d.importBackup(FIXTURE);
  const mainName = await d.page.locator('.ninja-name, h1').first().textContent();
  const page = d.page, OPEN = rig.appUrl + 'open/';
  await page.goto(OPEN, {waitUntil:'domcontentloaded'}); await page.waitForFunction(() => !document.querySelector('.loading'));
  await page.waitForSelector('[data-act="setup-save"]');
  assert.equal(await page.evaluate(() => window.LEAF_OPEN), true);
  await page.fill('#su-name', 'Ali');
  await page.locator('[data-act="setup-ex"][data-slot="exA"][data-v="pushups"]').click();
  await page.locator('[data-act="setup-ex"][data-slot="exB"][data-v="squats"]').click();
  assert.match(await page.locator('label[for], .field').filter({hasText:'Max push-ups in one go'}).first().textContent(), /push-ups/);
  await page.fill('#su-pull', '20'); await page.fill('#su-dip', '40'); await page.fill('#su-weight', '70');
  await page.locator('[data-act="setup-save"]').click();
  await page.waitForSelector('.mscroll[data-sid="work"]');
  const docsOf = db => page.evaluate(db => new Promise((res, rej) => { const r = indexedDB.open(db); r.onerror = () => rej(r.error); r.onsuccess = () => { const out = {};
    if(!r.result.objectStoreNames.contains('docs')){ r.result.close(); res(out); return; }
    const tx = r.result.transaction('docs', 'readonly'); const c = tx.objectStore('docs').openCursor(); c.onsuccess = () => { const cur = c.result; if(cur){ out[cur.key] = cur.value; cur.continue(); } }; tx.oncomplete = () => { r.result.close(); res(out); }; }; }), db);
  const s = await until(async () => (await docsOf('leaf-village-open'))['leaf/main'], 'the friend\'s village to be saved');
  assert.notEqual((await docsOf('leaf-village-local'))['leaf/main'].name, 'Ali', 'the main village is a different one');
  assert.equal(s.name, 'Ali'); assert.deepEqual(Object.keys(s.exercises).sort(), ['pushups', 'squats']);
  assert.equal(s.scheduleHistory[0].plan[0].ex, 'pushups'); assert.deepEqual(s.scheduleHistory[0].test.ex, ['pushups', 'squats']);
  assert.match(await page.locator('.mscroll[data-sid="work"]').textContent(), /push-ups/i, 'Sunday trains the first exercise');
  assert.match(await page.locator('.stage img.char').getAttribute('src'), /^ranks\/academy-cut/, 'a crest, from the copy\'s own folder');
  /* settings: a device-only note instead of sync and notifications */
  await page.evaluate(() => { location.hash = 'settings'; }); await sleep(600);
  for(let i = 0; i < 40; i++){ const h = page.locator('.card.folded .fold-head'); if(!(await h.count())) break; await h.first().click(); }
  const st = await page.locator('main').textContent();
  assert.match(st, /Everything stays on this phone/); assert.doesNotMatch(st, /Sync key|Turn on notifications/);
  /* the shop has no forms */
  await page.evaluate(() => { location.hash = 'ninja'; }); await sleep(600);
  for(let i = 0; i < 40; i++){ const h = page.locator('.card.folded .fold-head'); if(!(await h.count())) break; await h.first().click(); }
  const shop = await page.locator('#tf-card').textContent();
  assert.doesNotMatch(shop, /Skins|Bounties|Gojo|Kakashi's? Ninja/); assert.match(shop, /Scrolls/);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).every(k => k.startsWith('open:') || !k.startsWith('open')) ), true);
  /* back to the main app: Sharaf's village is still there */
  await page.goto(rig.appUrl, {waitUntil:'domcontentloaded'}); await page.waitForFunction(() => !document.querySelector('.loading'));
  assert.equal(await page.locator('[data-act="setup-save"]').count(), 0, 'the main app did not lose its village');
  assert.equal(await page.locator('.ninja-name, h1').first().textContent(), mainName);
  assert.deepEqual(rig.errors, [], 'no page errors');
  await d.ctx.close();
});
