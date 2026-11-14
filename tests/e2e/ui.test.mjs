/* The app's own screens in Chromium at iPad size: logging, undo, the study timer (also over midnight), import of
   good and damaged files, themes, rank wallpapers, a full disk, and how little of the page a tap touches.
   The clock starts on Sunday 15 Nov 2026, 10:00 in Baghdad (a pull-up groove day in the fixture). */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startRig, until, sleep } from '../lib-browser.mjs';

const FIXTURE = fileURLToPath(new URL('../fixtures/backup.json', import.meta.url));
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const TMP = fileURLToPath(new URL('../.tmp/', import.meta.url));
mkdirSync(TMP, {recursive:true});
const T0 = Date.parse('2026-11-15T07:00:00Z');
const at = (date, hh, mm = 0, ss = 0) => Date.parse(`${date}T00:00:00Z`) - 3 * 3600000 + ((hh * 60 + mm) * 60 + ss) * 1000;
const TODAY = 'leaf/main/days/2026-11-15';
const min = n => n * 60000;
const tmpFile = (name, data) => { const f = TMP + name; writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data)); return f; };
const clone = v => JSON.parse(JSON.stringify(v));
let rig, A;
const noErrors = () => { assert.deepEqual(rig.errors, [], 'no page errors'); };
const toastText = d => d.page.locator('#toast').textContent();
/* Safari has no scroll anchoring of its own, so the tests switch Chromium's off: the app must hold the page still by itself */
const likeSafari = d => d.page.addStyleTag({content:'*{overflow-anchor:none !important}'});
async function fresh(name, opts){
  const d = await rig.device(name, Object.assign({now:T0, viewport:{width:820, height:1180}}, opts || {}));
  await d.open(); await d.importBackup((opts && opts.file) || FIXTURE); await likeSafari(d);
  /* the welcome toast arrives a moment after the import: wait for it, so it cannot land on top of a toast under test */
  await d.page.waitForFunction(() => /Backup imported/.test(document.getElementById('toast').textContent));
  return d;
}
async function openScroll(d, sid){
  await d.tab('mission');
  const sc = d.page.locator(`.mscroll[data-sid="${sid}"]`);
  if(!(await sc.evaluate(el => el.classList.contains('open')))){ await sc.locator('.ms-roll').click(); await sleep(950); }
  assert.equal(await sc.evaluate(el => el.classList.contains('open')), true);
  return sc;
}
const topOf = (d, sel) => d.page.locator(sel).first().evaluate(el => el.getBoundingClientRect().top);
/* a new day can open with a story scene (a streak fell): close it like Sharaf would */
async function closeScenes(d){ for(let i = 0; i < 3; i++){ const b = d.page.locator('#overlay [data-act="scene-ok"]'); if(await b.count()){ await b.click(); await sleep(150); } else break; } }
const sets = async d => ((await d.docs())[TODAY] || {sets:[]}).sets;

before(async () => { rig = await startRig(8941); });
after(async () => { if(rig) await rig.stop(); });

test('logging a set: the mission scroll stays open and the page does not move; only the changed parts of the page are touched', async () => {
  A = await fresh('iPad');
  await openScroll(A, 'work');
  const btn = '.mscroll[data-sid="work"] [data-act="log"]';
  await A.page.locator(btn).evaluate(el => { el.scrollIntoView({block:'center'}); });
  await A.page.evaluate(() => {
    window.__keep = {btn:document.querySelector('.mscroll[data-sid="work"] [data-act="log"]'), stage:document.querySelector('.stage'), char:document.querySelector('.stage .char'), scroll:document.querySelector('.mscroll[data-sid="work"]'), study:document.querySelector('.mscroll[data-sid="study"]')};
    window.__frames = []; const t0 = performance.now();
    (function loop(){ const sc = document.querySelector('.mscroll[data-sid="work"]'), b = sc && sc.querySelector('[data-act="log"]');
      window.__frames.push({open:!!sc && sc.classList.contains('open'), label:b ? b.textContent : null, top:b ? Math.round(b.getBoundingClientRect().top) : null, y:Math.round(scrollY)});
      if(performance.now() - t0 < 1500) requestAnimationFrame(loop); })();
  });
  const before = await topOf(A, btn);
  await A.setTime(T0 + min(1));
  await A.page.locator(btn).click();
  await until(async () => (await sets(A)).length === 1, 'the set to be saved');
  await sleep(1600);
  const frames = await A.page.evaluate(() => window.__frames);
  assert.ok(frames.length > 20, 'frames were sampled');
  assert.ok(frames.every(f => f.open), 'the scroll was open in every frame');
  const labels = frames.map(f => f.label).filter((l, i, a) => i === 0 || l !== a[i - 1]);
  assert.deepEqual(labels, ['Log set 1', 'Log set 2'], 'the button went from set 1 to set 2 once, with no flick back');
  assert.ok(frames.every(f => Math.abs(f.top - Math.round(before)) <= 1), `the Log button stayed under the finger (tops ${[...new Set(frames.map(f => f.top))].join(', ')})`);
  const same = await A.page.evaluate(() => ({btn:document.querySelector('.mscroll[data-sid="work"] [data-act="log"]') === window.__keep.btn, stage:document.querySelector('.stage') === window.__keep.stage, char:document.querySelector('.stage .char') === window.__keep.char, scroll:document.querySelector('.mscroll[data-sid="work"]') === window.__keep.scroll, study:document.querySelector('.mscroll[data-sid="study"]') === window.__keep.study}));
  assert.deepEqual(same, {btn:true, stage:true, char:true, scroll:true, study:true}, 'the same elements are still on the page: nothing was rebuilt');
  assert.match(await toastText(A), /8 pull-ups logged · \+18 XP/);
  /* finishing the mission adds a badge above the button; the button still does not move */
  for(let i = 2; i <= 5; i++){
    await A.setTime(T0 + min(i));
    const y = await topOf(A, btn);
    await A.page.locator(btn).click();
    await until(async () => (await sets(A)).length === i, `set ${i}`);
    await sleep(120);
    assert.ok(Math.abs((await topOf(A, btn)) - y) <= 1, `set ${i}: button stayed in place`);
    assert.equal(await A.page.locator('.mscroll[data-sid="work"]').evaluate(el => el.classList.contains('open')), true);
  }
  assert.equal(await A.page.locator('.mscroll[data-sid="work"] .complete-badge').count(), 1);
  assert.match(await toastText(A), /Mission complete/);
  noErrors();
});

test('a tap on + or − changes one number on the page, not the page', async () => {
  await A.page.evaluate(() => { window.__muts = []; window.__mo = new MutationObserver(l => l.forEach(m => window.__muts.push(m.type + ':' + (m.target.nodeName || '')))); window.__mo.observe(document.getElementById('view'), {subtree:true, childList:true, attributes:true, characterData:true}); });
  await A.page.locator('.mscroll[data-sid="work"] [data-act="step"][data-d="1"]').click();
  await sleep(100);
  const muts = await A.page.evaluate(() => { window.__mo.disconnect(); return window.__muts; });
  assert.ok(muts.length >= 1 && muts.length <= 3, `the stepper tap made ${muts.length} change(s): ${muts.join(', ')}`);
  assert.equal(await A.page.locator('.mscroll[data-sid="work"] .stepper .val b').textContent(), '9');
  await A.page.locator('.mscroll[data-sid="work"] [data-act="step"][data-d="-1"]').click();
  noErrors();
});

test('undo: two taps remove only the most recent set', async () => {
  const before = await sets(A);
  const undo = A.page.locator('.mscroll[data-sid="work"] [data-act="undo"]');
  await undo.click();
  assert.match(await undo.textContent(), /Tap again to remove 8 pull-ups/);
  assert.equal((await sets(A)).length, 5, 'one tap removes nothing');
  await undo.click();
  await until(async () => (await sets(A)).length === 4, 'the last set to go');
  assert.deepEqual(await sets(A), before.slice(0, 4));
  assert.equal(await A.page.locator('.mscroll[data-sid="work"] .complete-badge').count(), 0, 'the mission is open again');
  assert.equal(await A.page.locator('.mscroll[data-sid="work"]').evaluate(el => el.classList.contains('open')), true);
  noErrors();
});

test('the toast sits above the music player, never on top of it', async () => {
  await A.tab('settings');
  await A.page.locator('[data-act="mp-play"]').first().click();
  await A.page.waitForSelector('#player .player-inner');
  await A.tab('mission');
  await A.setTime(T0 + min(8));
  await A.page.locator('.mscroll[data-sid="work"] [data-act="log"]').click();
  await A.page.waitForSelector('#toast:not([hidden])');
  const r = await A.page.evaluate(() => { const t = document.getElementById('toast').getBoundingClientRect(), p = document.querySelector('#player .player-inner').getBoundingClientRect(), n = document.getElementById('tabs').getBoundingClientRect(); return {toastBottom:t.bottom, playerTop:p.top, playerBottom:p.bottom, tabsTop:n.top}; });
  assert.ok(r.toastBottom <= r.playerTop - 4, `toast ends at ${r.toastBottom}, player starts at ${r.playerTop}`);
  assert.ok(r.playerBottom <= r.tabsTop + 1);
  await A.page.locator('[data-act="mp-stop"]').click();
  await A.page.waitForSelector('#toast:not([hidden])');
  const r2 = await A.page.evaluate(() => { const t = document.getElementById('toast').getBoundingClientRect(), n = document.getElementById('tabs').getBoundingClientRect(); return {toastBottom:t.bottom, tabsTop:n.top}; });
  assert.ok(r2.toastBottom <= r2.tabsTop - 4, 'without the player the toast sits just above the tab bar');
  noErrors();
});

test('study timer: start, pause, resume and finish log exactly the minutes studied, and the scroll stays open', async () => {
  const sc = await openScroll(A, 'study');
  const study = async () => ((await A.docs())['leaf/main/study/2026-11-15'] || {entries:[]}).entries;
  await A.setTime(T0 + min(20));
  await sc.locator('[data-act="st-start"]').click();
  await A.page.waitForSelector('.stimer.run');
  await A.setTime(T0 + min(20 + 61));
  await until(async () => (await A.page.locator('[data-timer]').textContent()) === '1:01:00', 'the clock face to show 1:01:00');
  await sc.locator('[data-act="st-pause"]').click();
  await until(async () => (await study()).length === 1, 'the first stretch to be logged');
  assert.equal((await study())[0].min, 61); assert.equal((await study())[0].src, 'timer');
  assert.match(await toastText(A), /Paused · 1h 1m logged/);
  await A.setTime(T0 + min(100));
  await sc.locator('[data-act="st-resume"]').click();
  await A.page.waitForSelector('.stimer.run');
  await A.setTime(T0 + min(100) + 29 * 60000 + 30000);
  await sc.locator('[data-act="st-finish"]').click();
  await until(async () => (await study()).length === 2, 'the second stretch');
  assert.equal((await study())[1].min, 29.5, 'half minutes are kept, not rounded away');
  assert.equal((await A.docs())['leaf/timer'].state, 'idle');
  assert.equal(await sc.evaluate(el => el.classList.contains('open')), true);
  assert.match(await sc.locator('.xp-chip').textContent(), /Study \+60 XP/);
  /* undo removes only the last entry */
  await sc.locator('[data-act="st-undo"]').click(); await sc.locator('[data-act="st-undo"]').click();
  await until(async () => (await study()).length === 1, 'undo');
  assert.equal((await study())[0].min, 61);
  noErrors();
});

test('study timer over midnight: each day gets its own minutes; a page left open cannot write into yesterday', async () => {
  const B = await fresh('night', {now:at('2026-11-15', 23, 30)});
  const sc = await openScroll(B, 'study');
  await sc.locator('[data-act="st-start"]').click();
  await B.page.waitForSelector('.stimer.run');
  await B.setTime(at('2026-11-16', 0, 20));
  await until(async () => /16 November/.test(await B.page.locator('.stage .eyebrow').textContent()), 'the page to turn to the new day by itself');
  await closeScenes(B);
  let docs = await B.docs();
  assert.equal(docs['leaf/main/study/2026-11-15'], undefined, 'nothing is written while the timer runs');
  await B.page.locator('.mscroll[data-sid="study"] [data-act="st-finish"]').click();
  await until(async () => !!(await B.docs())['leaf/main/study/2026-11-16'], 'both days to be saved');
  docs = await B.docs();
  assert.deepEqual(docs['leaf/main/study/2026-11-15'].entries.map(e => [e.min, e.start, e.end]), [[30, new Date(at('2026-11-15', 23, 30)).toISOString(), new Date(at('2026-11-16', 0, 0)).toISOString()]]);
  assert.deepEqual(docs['leaf/main/study/2026-11-16'].entries.map(e => e.min), [20]);
  /* the page shows 16 Nov; the clock jumps past the next midnight and a tap lands before the page has caught up */
  await B.tab('mission');
  const before = clone(await B.docs());
  await B.setTime(at('2026-11-17', 0, 0, 20));
  await B.page.evaluate(() => { const b = document.querySelector('.mscroll[data-sid="study"] [data-act="st-add"][data-min="60"]'); if(b) b.click(); });
  await sleep(400);
  docs = await B.docs();
  assert.deepEqual(docs['leaf/main/study/2026-11-16'], before['leaf/main/study/2026-11-16'], 'the closed day was not touched');
  assert.equal(docs['leaf/main/study/2026-11-17'], undefined, 'and the tap did not silently log into the new day either');
  assert.match(await toastText(B), /A new day has begun/);
  await until(async () => /17 November/.test(await B.page.locator('.stage .eyebrow').textContent()), 'the page to show the new day');
  await closeScenes(B);
  await B.close();
  noErrors();
});

test('the 3-hour "Still studying?" check: answering the next morning cannot add hours to yesterday', async () => {
  const B = await fresh('sleeper', {now:at('2026-11-15', 19, 0)});
  const sc = await openScroll(B, 'study');
  await sc.locator('[data-act="st-start"]').click();
  await B.page.waitForSelector('.stimer.run');
  await B.setTime(at('2026-11-15', 22, 5));
  await B.page.waitForSelector('.stimer.check');
  assert.match(await B.page.locator('.stimer.check').textContent(), /Still studying\?/);
  await B.setTime(at('2026-11-16', 9, 0));
  await until(async () => /16 November/.test(await B.page.locator('.stage .eyebrow').textContent()), 'the new day');
  await closeScenes(B);
  const summaryBefore = await B.page.evaluate(() => document.querySelector('.mscroll[data-sid="study"] .roll-label small').textContent);
  await B.page.locator('[data-act="st-yes"]').click();
  await until(async () => !!(await B.docs())['leaf/main/study/2026-11-15'], 'yesterday to be closed at the check');
  const docs = await B.docs();
  assert.deepEqual(docs['leaf/main/study/2026-11-15'].entries.map(e => e.min), [180], 'yesterday keeps exactly the three hours up to the check');
  assert.equal(docs['leaf/timer'].state, 'running'); assert.equal(docs['leaf/timer'].segStart, at('2026-11-16', 0, 0), 'today counts from midnight');
  assert.ok(summaryBefore.length > 0);
  await B.close();
  noErrors();
});

test('import: files that are not backups, or are too damaged to open, are refused and change nothing', async () => {
  await A.tab('settings');
  const before = await A.docs();
  const bad = [
    ['not-json.json', 'this is not json', /isn't a Leaf Village backup/],
    ['other-app.json', {app:'Something else', settings:{}}, /isn't a Leaf Village backup/],
    ['no-start.json', Object.assign(clone(fixture), {settings:Object.assign(clone(fixture.settings), {startDate:'someday'})}), /damaged, so nothing was imported/],
    ['no-exercises.json', Object.assign(clone(fixture), {settings:Object.assign(clone(fixture.settings), {exercises:[]})}), /damaged, so nothing was imported/]
  ];
  for(const [name, data, msg] of bad){
    await A.page.setInputFiles('#import-file', tmpFile(name, data));
    await until(async () => msg.test(await toastText(A)), `${name} to be refused`);
    assert.equal(await A.page.locator('[data-act="import-yes"]').count(), 0, `${name}: no import offered`);
  }
  assert.deepEqual(await A.docs(), before, 'nothing on the device changed');
  noErrors();
});

test('import: a backup with damaged entries comes in without them, says so, and the app opens normally', async () => {
  const hurt = clone(fixture);
  hurt.days['2026-11-10'].sets.push({ex:'pullups', reps:'lots', t:'x'}, null, {ex:'dips', reps:5});
  hurt.days['2026-11-09'] = {sets:'none'}; hurt.days['not-a-date'] = {sets:[]};
  hurt.study['2026-11-10'].entries.push({min:-5, end:'x'}, {start:'2026-11-10T08:00:00.000Z', end:'2026-11-10T09:00:00.000Z', min:99999, src:'timer'});
  hurt.body['2026-11-08'] = {date:'2026-11-08', weight:'heavy'};
  hurt.settings.examWeeks.push(null, {start:'2026-12-40'});
  hurt.settings.scheduleHistory.push({from:'2026-11-20', plan:'x', gtg:null}, 'junk');
  hurt.settings.themeRank = 99; hurt.timer = {state:'running', segStart:1};
  const B = await rig.device('repair', {now:T0});
  await B.open();
  await B.page.setInputFiles('#import-file', tmpFile('hurt.json', hurt));
  await B.page.waitForSelector('[data-act="import-yes"]');
  assert.match(await B.page.locator('.import-panel').textContent(), /damaged entries in the file were left out/);
  await B.page.evaluate(() => { window.__beforeImport = true; });
  await B.page.click('[data-act="import-yes"]');
  await B.page.waitForFunction(() => !window.__beforeImport && !!document.querySelector('nav a[aria-current="page"]'), null, {timeout:30000});
  const docs = await B.docs();
  assert.deepEqual(docs['leaf/main/days/2026-11-10'].sets, fixture.days['2026-11-10'].sets, 'the good sets of that day are all there');
  assert.deepEqual(docs['leaf/main/days/2026-11-09'].sets, []);
  assert.equal(docs['leaf/main/days/not-a-date'], undefined);
  assert.deepEqual(docs['leaf/main/study/2026-11-10'].entries, fixture.study['2026-11-10'].entries);
  assert.equal(docs['leaf/main/body/2026-11-08'], undefined);
  assert.deepEqual(docs['leaf/main'].examWeeks, fixture.settings.examWeeks);
  assert.equal(docs['leaf/main'].scheduleHistory.length, 3); assert.equal(docs['leaf/main'].themeRank, undefined);
  assert.equal(docs['leaf/timer'].state, 'idle');
  for(const t of ['mission', 'stats', 'plan', 'ninja', 'settings']){ await B.tab(t); assert.equal(await B.page.locator('#rescue').count(), 0, `${t} opens`); assert.ok((await B.page.locator('#view').textContent()).length > 200); }
  await B.close();
  noErrors();
});

test('backup: the download holds everything logged since, in the same format', async () => {
  await A.tab('settings');
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.click('[data-act="backup"]')]);
  const out = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  assert.deepEqual(Object.keys(out).sort(), Object.keys(fixture).sort());
  const docs = await A.docs();
  assert.deepEqual(out.days['2026-11-15'], docs[TODAY]); assert.deepEqual(out.study['2026-11-15'], docs['leaf/main/study/2026-11-15']);
  assert.deepEqual(out.settings, docs['leaf/main']);
  assert.match(await A.page.locator('#view').textContent(), /Last backup: today\./);
  noErrors();
});

test('theme picker: earned ranks can be chosen, locked ones cannot, and the choice is remembered by rank name', async () => {
  await A.tab('settings');
  const sw = A.page.locator('.themes > *');
  assert.equal(await sw.count(), 14);
  assert.equal(await A.page.locator('.themes button.theme-sw').count(), 6, 'ANBU and the five ranks below it');
  assert.equal(await A.page.locator('.themes .theme-sw.locked').count(), 8);
  assert.match(await A.page.locator('.themes .theme-sw.on').textContent(), /ANBU/);
  const paper = () => A.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim());
  const p0 = await paper();
  await A.page.locator('.themes button.theme-sw', {hasText:'Genin'}).click();
  await until(async () => (await A.docs())['leaf/main'].themeRankId === 'genin', 'the choice to be saved');
  assert.equal((await A.docs())['leaf/main'].themeRank, 1);
  assert.match(await A.page.locator('.themes .theme-sw.on').textContent(), /Genin/);
  assert.notEqual(await paper(), p0, 'the colours changed');
  assert.match(await toastText(A), /Genin theme on/);
  noErrors();
});

test('rank wallpapers: every tab shows a picture from the active rank\'s set, and the files exist', async () => {
  const seen = [];
  for(const t of ['mission', 'stats', 'plan', 'ninja', 'settings']){
    await A.tab(t);
    const url = await until(() => A.page.evaluate(() => { const el = document.querySelector('.bgphoto.on'); const m = el && /url\("?([^")]+)"?\)/.exec(el.style.backgroundImage); return m ? m[1] : null; }), `${t} wallpaper`);
    assert.match(url, /^media\/wp-genin-[1-5]\.jpg$/, `${t}: ${url}`);
    assert.equal(await A.page.evaluate(() => document.body.classList.contains('has-bg')), true);
    const ok = await A.page.evaluate(u => fetch(u).then(r => r.ok && /image/.test(r.headers.get('content-type'))), url);
    assert.equal(ok, true, `${url} loads`);
    seen.push(url);
  }
  assert.equal(new Set(seen).size, 5, 'a full set of five gives each tab its own picture');
  /* back to the current rank (ANBU has one picture so far: every tab uses it) */
  await A.tab('settings');
  await A.page.locator('.themes button.theme-sw', {hasText:'ANBU'}).click();
  await until(async () => (await A.docs())['leaf/main'].themeRankId === undefined, 'the theme to go back to the current rank');
  for(const t of ['mission', 'ninja']){ await A.tab(t); await until(() => A.page.evaluate(() => { const el = document.querySelector('.bgphoto.on'); return !!el && /wp-sealed-shrine/.test(el.style.backgroundImage); }), `${t} ANBU wallpaper`); }
  /* the switch turns them off */
  await A.tab('settings');
  await A.page.locator('[data-act="rank-walls"]').click();
  await until(() => A.page.evaluate(() => !document.querySelector('.bgphoto.on') && !document.body.classList.contains('has-bg')), 'wallpapers off');
  await A.page.locator('[data-act="rank-walls"]').click();
  noErrors();
});

test('storage full: the entry is not shown as saved, the app says so where it can be seen, and it recovers', async () => {
  const B = await fresh('full');
  await openScroll(B, 'work');
  await B.page.evaluate(() => {
    const put = IDBObjectStore.prototype.put; window.__full = true;
    IDBObjectStore.prototype.put = function(){ if(window.__full && this.name === 'docs') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return put.apply(this, arguments); };
  });
  await B.setTime(T0 + min(3));
  await B.page.locator('.mscroll[data-sid="work"] [data-act="log"]').click();
  await until(async () => /Storage for this page is full/.test(await toastText(B)), 'the storage message');
  assert.match(await B.page.locator('#banner .banner.err').textContent(), /Storage for this page is full, so that entry was not saved/);
  assert.equal((await B.docs())[TODAY], undefined, 'nothing was saved');
  await until(async () => (await B.page.locator('.mscroll[data-sid="work"] [data-act="log"]').textContent()) === 'Log set 1', 'the page to show the set as not logged');
  assert.equal(await B.page.locator('.mscroll[data-sid="work"] .sets li').count(), 0);
  await B.page.evaluate(() => { window.__full = false; });
  await B.setTime(T0 + min(4));
  await B.page.locator('.mscroll[data-sid="work"] [data-act="log"]').click();
  await until(async () => ((await B.docs())[TODAY] || {sets:[]}).sets.length === 1, 'the next set to save');
  await until(async () => (await B.page.locator('#banner .banner').count()) === 0, 'the banner to clear');
  await B.close();
  rig.errors.length = 0;                     // the browser logs the refused write itself
});

test('a rank remembered from an older ladder is brought back in line, so later promotions still get their ceremony', async () => {
  const old = clone(fixture); old.settings.celebrated = 9; old.settings.themeRank = 3;
  const B = await fresh('ladder', {file:tmpFile('old-ladder.json', old)});
  assert.equal(await B.page.locator('#overlay .promo').count(), 0, 'no promotion to announce');
  await until(async () => (await B.docs())['leaf/main'].celebratedId === 'anbu', 'the stored rank to be corrected', 9000);
  const s = (await B.docs())['leaf/main'];
  assert.equal(s.celebrated, 5); assert.equal(s.themeRankId, 'special-jonin'); assert.equal(s.themeRank, 3);
  assert.equal(await B.page.evaluate(() => document.getElementById('overlay').hidden), true);
  /* and a village that really is one rank ahead of its last ceremony gets that ceremony */
  const behind = clone(fixture); behind.settings.celebrated = 4;
  const C = await fresh('behind', {file:tmpFile('behind.json', behind)});
  await C.page.waitForSelector('#overlay .promo');
  assert.match(await C.page.locator('#promo-title').textContent(), /ANBU/);
  await C.page.locator('[data-act="promo-ok"]').click();
  await until(async () => (await C.docs())['leaf/main'].celebratedId === 'anbu', 'the ceremony to be remembered');
  await B.close(); await C.close();
  noErrors();
});

test('if the saved data cannot be read, the app stops with a way out instead of a blank page', async () => {
  const B = await fresh('stuck');
  await B.page.evaluate(() => { window.__compute = window.LeafEngine.compute; window.LeafEngine.compute = () => { throw new Error('boom'); }; });
  /* the next change to the data makes the engine run again */
  await B.tab('settings');
  await B.page.locator('[data-act="notify"][data-k="weekly"]').click();
  await B.page.waitForSelector('#rescue');
  assert.match(await B.page.locator('#rescue').textContent(), /Your logs are still on this device/);
  assert.equal(await B.page.locator('#rescue [data-act="backup"]').count(), 1); assert.equal(await B.page.locator('#rescue #import-file').count(), 1);
  const [dl] = await Promise.all([B.page.waitForEvent('download'), B.page.click('#rescue [data-act="backup"]')]);
  assert.deepEqual(JSON.parse(readFileSync(await dl.path(), 'utf8')).days, fixture.days, 'the backup still works from here');
  await B.page.evaluate(() => { window.LeafEngine.compute = window.__compute; location.hash = 'mission'; });
  await B.page.waitForSelector('.stage');
  await B.close();
  rig.errors.length = 0;
});

test('a new village: enrollment, the first set, and the study scroll', async () => {
  const B = await rig.device('new', {now:T0});
  await B.open();
  await B.page.fill('#su-name', 'Sharaf'); await B.page.fill('#su-pull', '10'); await B.page.fill('#su-dip', '20'); await B.page.fill('#su-weight', '72');
  await B.page.click('[data-act="setup-save"]');
  await B.page.waitForSelector('.stage');
  const s = await until(async () => (await B.docs())['leaf/main'], 'settings');
  assert.equal(s.startDate, '2026-11-15'); assert.equal(s.studyStart, '2026-11-15'); assert.equal(s.celebratedId, 'academy');
  await B.logSet(5);
  await until(async () => ((await B.docs())[TODAY] || {sets:[]}).sets.length === 1, 'the first set');
  assert.equal(await B.page.locator('.mscroll[data-sid="study"]').count(), 1, 'the study scroll is there from day one');
  await B.tab('plan');
  for(const cb of await B.page.locator('[data-act="test-ex"]').all()) await cb.uncheck();
  await B.page.locator('[data-act="plan-save"]').click();
  assert.match(await toastText(B), /Tick at least one exercise for your test days/);
  assert.equal((await B.docs())['leaf/main'].scheduleHistory.length, 1, 'a plan with an impossible test day is not saved');
  await B.close();
  noErrors();
});

test('monthly mission report: opens from Stats with the month\'s real numbers, pages between months, and saves as an image and a PDF', async () => {
  await A.tab('stats');
  await A.page.locator('#report-card [data-act="report-open"]', {hasText:'October 2026'}).click();
  await A.page.waitForSelector('#overlay .report');
  const text = async () => (await A.page.locator('#overlay .report').textContent()).replace(/\s+/g, ' ');
  let t = await text();
  assert.match(t, /Monthly mission report · chapter 2/); assert.match(t, /October 2026/); assert.match(t, /Rise of the Jonin/);
  assert.match(t, /117h 15m/); assert.match(t, /15 done/); assert.match(t, /1 missed · 8 rest · 7 exam/);
  assert.match(t, /327 pull-ups/); assert.match(t, /523 dips/); assert.match(t, /Pull-ups 11 → 15/); assert.match(t, /Dips 22 → 26/);
  assert.match(t, /\+12,095/); assert.match(t, /Chunin → Jonin/); assert.match(t, /Hundred Hours/); assert.match(t, /Third Hokage/);
  const [png] = await Promise.all([A.page.waitForEvent('download'), A.page.click('[data-act="report-save"][data-fmt="png"]')]);
  assert.equal(png.suggestedFilename(), 'leaf-village-report-2026-10.png');
  const img = readFileSync(await png.path());
  assert.deepEqual([...img.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]); assert.equal(img.readUInt32BE(16), 1240); assert.equal(img.readUInt32BE(20), 1754);
  writeFileSync(TMP + 'report-2026-10.png', img);
  await until(async () => /Report saved/.test(await toastText(A)), 'saved toast');
  const [pdf] = await Promise.all([A.page.waitForEvent('download'), A.page.click('[data-act="report-save"][data-fmt="pdf"]')]);
  assert.equal(pdf.suggestedFilename(), 'leaf-village-report-2026-10.pdf');
  const doc = readFileSync(await pdf.path()), head = doc.subarray(0, 600).toString('latin1'), tail = doc.subarray(-300).toString('latin1');
  assert.match(head, /^%PDF-1\.4/); assert.match(head, /\/Filter \/DCTDecode/); assert.match(head, /\/MediaBox \[0 0 595 842\]/);
  assert.match(tail, /startxref\n(\d+)\n%%EOF\n$/);
  const xref = +/startxref\n(\d+)/.exec(tail)[1]; assert.equal(doc.subarray(xref, xref + 4).toString('latin1'), 'xref', 'the cross-reference table is where the file says it is');
  const off4 = +doc.subarray(xref, xref + 200).toString('latin1').split('\n')[6].slice(0, 10); assert.equal(doc.subarray(off4, off4 + 7).toString('latin1'), '4 0 obj');
  /* paging */
  await A.page.click('[data-act="report-nav"][data-d="-1"]');
  await until(async () => /September 2026/.test(await text()), 'September');
  assert.match(await text(), /Rise of the Chunin/);
  assert.equal(await A.page.locator('[data-act="report-nav"][data-d="-1"]').isDisabled(), true);
  await A.page.click('[data-act="report-nav"][data-d="1"]'); await A.page.click('[data-act="report-nav"][data-d="1"]');
  await until(async () => /November 2026/.test(await text()), 'November');
  assert.match(await text(), /month in progress/);
  await A.page.click('[data-act="report-close"]');
  assert.equal(await A.page.evaluate(() => document.getElementById('overlay').hidden), true);
  noErrors();
});

test('story arcs: on the 1st a recap scene closes the chapter and leads to its report, once; the Ninja tab keeps the story', async () => {
  const B = await rig.device('first', {now:at('2026-12-01', 9, 0)});
  await B.open(); await B.importBackup(FIXTURE);
  await closeScenes(B);
  await B.page.waitForSelector('#overlay .scene.recap');
  const recap = (await B.page.locator('#overlay .scene.recap').textContent()).replace(/\s+/g, ' ');
  assert.match(recap, /Chapter 3 · November 2026/); assert.match(recap, /Rise of the ANBU/); assert.match(recap, /Jonin became ANBU/); assert.match(recap, /Begin chapter 4/);
  assert.match(await B.page.locator('#overlay .scene.recap img').getAttribute('src'), /^media\/wp-sealed-shrine\.jpg$/, 'the rank\'s own wallpaper');
  await B.page.click('[data-act="recap-report"]');
  await B.page.waitForSelector('#overlay .report');
  assert.match(await B.page.locator('#report-title').textContent(), /November 2026/);
  await B.page.click('[data-act="report-close"]');
  await B.page.reload(); await B.page.waitForSelector('.stage');
  await sleep(400);
  assert.equal(await B.page.locator('#overlay .scene.recap, #overlay .report').count(), 0, 'it does not come back');
  /* the story so far */
  await B.tab('ninja');
  const rows = await B.page.locator('#story-card .ladder li').allTextContents();
  assert.equal(rows.length, 4);
  assert.match(rows[0], /Chapter 4 · .*December 2026 · still being written/); assert.match(rows[1], /Chapter 3 · Rise of the ANBUNovember 2026/);
  assert.match(rows[3], /Chapter 1 · Rise of the ChuninSeptember 2026\+6,693 XP/);
  await B.page.locator('#story-card [data-ym="2026-09"]').click();
  await B.page.waitForSelector('#overlay .report');
  assert.match(await B.page.locator('#report-title').textContent(), /September 2026/);
  await B.page.click('[data-act="report-close"]');
  await B.close();
  const Cdev = await rig.device('mid', {now:at('2026-12-09', 9, 0)});
  await Cdev.open(); await Cdev.importBackup(FIXTURE); await sleep(400);
  assert.equal(await Cdev.page.locator('#overlay .scene.recap, #overlay .report').count(), 0, 'after the first week it waits in Stats and the Ninja tab instead');
  await Cdev.close();
  noErrors();
});

test('auto-progression: after the Friday test Kakashi suggests next week\'s settings; Accept saves a plan from tomorrow', async () => {
  const B = await fresh('friday', {now:at('2026-11-13', 17, 0)});
  await closeScenes(B);
  assert.equal(await B.page.locator('#prog-card').count(), 0, 'no card before the test is done');
  let n = 0;
  for(const reps of [14, 12, 26, 24]){ await B.setTime(at('2026-11-13', 17, 5 + 5 * n)); await B.logSet(reps); n++; await until(async () => ((await B.docs())['leaf/main/days/2026-11-13'] || {sets:[]}).sets.length === n, `test set ${n}`); }
  await B.page.waitForSelector('#prog-card');
  const card = (await B.page.locator('#prog-card').textContent()).replace(/\s+/g, ' ');
  assert.match(card, /Kakashi · after your test on 13 Nov/); assert.match(card, /A max slipped on the test/); assert.match(card, /Share of your max\s*45% was 50%/); assert.match(card, /Pull-ups, reps a set\s*6 was 8/); assert.match(card, /Dips, reps a set\s*12 was 13/);
  const before = (await B.docs())['leaf/main'];
  await B.page.locator('[data-act="prog-accept"]').click();
  const s = await until(async () => { const x = (await B.docs())['leaf/main']; return x.progression ? x : null; }, 'the choice to be saved');
  assert.equal(s.progression.test, '2026-11-13'); assert.equal(s.progression.choice, 'accepted');
  assert.equal(s.scheduleHistory.length, before.scheduleHistory.length + 1);
  const e = s.scheduleHistory[s.scheduleHistory.length - 1], prev = before.scheduleHistory[before.scheduleHistory.length - 1];
  assert.equal(e.from, '2026-11-14'); assert.deepEqual(e.gtg, {sets:6, minSets:5, pct:45});
  assert.deepEqual(e.plan, prev.plan); assert.deepEqual(e.test, prev.test); assert.deepEqual(e.study, prev.study); assert.deepEqual(e.combo, prev.combo);
  assert.deepEqual(s.scheduleHistory.slice(0, -1), before.scheduleHistory, 'earlier plans are untouched');
  assert.equal(await B.page.locator('#prog-card').count(), 0, 'the card is gone once answered');
  assert.match(await toastText(B), /Plan updated\. It starts 14 Nov/);
  await B.tab('plan');
  assert.match(await B.page.locator('#view').textContent(), /A plan change starts Saturday 14 November/);
  await B.close();
  /* Keep mine changes nothing but remembers the answer */
  const K = await fresh('friday-keep', {now:at('2026-11-13', 17, 0)});
  await closeScenes(K); n = 0;
  for(const reps of [14, 12, 26, 24]){ await K.setTime(at('2026-11-13', 17, 5 + 5 * n)); await K.logSet(reps); n++; await until(async () => ((await K.docs())['leaf/main/days/2026-11-13'] || {sets:[]}).sets.length === n, `test set ${n}`); }
  await K.page.locator('[data-act="prog-keep"]').click();
  const k = await until(async () => { const x = (await K.docs())['leaf/main']; return x.progression ? x : null; }, 'kept');
  assert.equal(k.progression.choice, 'kept'); assert.deepEqual(k.scheduleHistory, fixture.settings.scheduleHistory);
  await K.close();
  noErrors();
});

test('exam countdown: set in Settings, shown on the Mission tab with banked hours, and the Third Hokage speaks to it', async () => {
  const B = await fresh('exam');
  assert.equal(await B.page.locator('#exam-count').count(), 0);
  await B.tab('settings');
  await B.page.fill('#examc-name', 'Finals'); await B.page.fill('#examc-date', '2026-11-10');
  await B.page.locator('[data-act="examc-save"]').click();
  assert.match(await toastText(B), /has to be today or later/);
  await B.page.fill('#examc-date', '2026-11-21');
  await B.page.locator('[data-act="examc-save"]').click();
  const s = await until(async () => { const x = (await B.docs())['leaf/main']; return x.exam ? x : null; }, 'the exam to be saved');
  assert.deepEqual(s.exam, {name:'Finals', date:'2026-11-21', since:'2026-11-15'});
  assert.match(await toastText(B), /Finals: 6 days to go/);
  await B.tab('mission');
  let card = (await B.page.locator('#exam-count').textContent()).replace(/\s+/g, ' ');
  assert.match(card, /6\s*days left/); assert.match(card, /Finals · Saturday 21 November/); assert.match(card, /0m of study banked since 15 Nov/);
  assert.match(card, /An exam-week pass would freeze both streaks/);
  await openScroll(B, 'study');
  assert.match(await B.page.locator('.mscroll.study .hokage-line').textContent(), /Finals/);
  await B.setTime(T0 + min(5));
  await B.page.locator('.mscroll.study [data-act="st-add"][data-min="60"]').click();
  await until(async () => /1h of study banked/.test(await B.page.locator('#exam-count').textContent()), 'the banked hours to grow');
  /* changing the date keeps the hours already banked; clearing removes the card */
  await B.tab('settings');
  await B.page.fill('#examc-date', '2026-12-20');
  await B.page.locator('[data-act="examc-save"]').click();
  await until(async () => (await B.docs())['leaf/main'].exam.date === '2026-12-20', 'the new date');
  assert.equal((await B.docs())['leaf/main'].exam.since, '2026-11-15');
  await B.tab('mission');
  card = (await B.page.locator('#exam-count').textContent()).replace(/\s+/g, ' ');
  assert.match(card, /35\s*days left/); assert.doesNotMatch(card, /exam-week pass/);
  assert.doesNotMatch(await B.page.locator('.mscroll.study .hokage-line').textContent(), /Finals/, 'outside the last two weeks the usual lines return');
  await B.tab('settings');
  await B.page.locator('[data-act="examc-clear"]').click();
  await until(async () => (await B.docs())['leaf/main'].exam === undefined, 'cleared');
  await B.tab('mission'); assert.equal(await B.page.locator('#exam-count').count(), 0);
  assert.deepEqual((await B.docs())['leaf/main'].examWeeks, fixture.settings.examWeeks, 'the exam-week pass is a separate thing and was not touched');
  await B.close();
  noErrors();
});

test('achievements wall: every scroll with its date, hidden ones masked, and a moment when one is earned', async () => {
  const B = await fresh('dawn', {now:at('2026-11-15', 5, 0)});
  await B.tab('ninja');
  const wall = B.page.locator('#ach-wall');
  assert.equal(await wall.locator('.sc').count(), 33);
  assert.match(await wall.locator('.section-head').textContent(), /18 \/ 33/);
  assert.equal(await wall.locator('.sc:not(.locked)').count(), 18);
  const text = (await wall.textContent()).replace(/\s+/g, ' ');
  assert.match(text, /First MissionComplete your first missionEarned 6 Sep/); assert.match(text, /Four Teachers/, 'a secret scroll that was earned shows its name');
  assert.doesNotMatch(text, /Dawn Patrol|Thursday Scholar|The Hat/, 'secret scrolls not yet earned stay hidden');
  assert.equal(await wall.locator('.sc.secret').count(), 4);
  assert.match(text, /Secret · 2 \/ 6/); assert.match(text, /Streaks · 4 \/ 6/);
  assert.equal(await B.page.evaluate(() => document.getElementById('achpop').hidden), true, 'nothing pops for scrolls earned long ago');
  await sleep(2300);
  assert.equal(await B.page.evaluate(() => JSON.parse(localStorage.getItem('leaf-ach-seen')).length), 18);
  assert.equal(await B.page.evaluate(() => document.getElementById('achpop').hidden), true);
  await B.setTime(at('2026-11-15', 5, 10));
  await B.logSet(8);
  await B.page.waitForSelector('#achpop:not([hidden])');
  assert.match(await B.page.locator('#achpop').textContent(), /Scroll earned.*Dawn Patrol.*Log a set between 4 and 6 in the morning/);
  assert.equal(await B.page.evaluate(() => JSON.parse(localStorage.getItem('leaf-ach-seen')).includes('dawn')), true);
  await B.tab('ninja');
  assert.match(await B.page.locator('#ach-wall [data-ach="dawn"]').textContent(), /Dawn Patrol.*Earned 15 Nov/);
  assert.match(await B.page.locator('#ach-wall .section-head').textContent(), /19 \/ 33/);
  await B.page.waitForSelector('#achpop', {state:'hidden', timeout:6000});
  await B.page.reload(); await B.page.waitForSelector('#ach-wall'); await sleep(2500);
  assert.equal(await B.page.evaluate(() => document.getElementById('achpop').hidden), true, 'it is announced once');
  await B.close();
  noErrors();
});

test('shadow clone race: the Mission tab compares this week with four weeks ago, and Sunday brings the result', async () => {
  const B = await fresh('rival');
  const card = async () => (await B.page.locator('#rival-card').textContent()).replace(/\s+/g, ' ');
  assert.match(await card(), /Shadow clone race/); assert.match(await card(), /week of 18 Oct/);
  assert.equal(await B.page.locator('#rival-line').textContent(), 'Your shadow clone had 438 XP by Sunday. You have 0 XP.');
  assert.match(await card(), /The clone leads 3–0 so far\. Win two of the three by Saturday night for \+50 XP/);
  assert.equal(await B.page.locator('#rival-last').count(), 0, 'the week before the race began has no result');
  /* study past the clone's Sunday and log more reps: two of three now lead */
  await B.setTime(T0 + min(2));
  for(let i = 0; i < 5; i++) await B.page.evaluate(() => document.querySelector('.mscroll.study [data-act="st-add"][data-min="60"]').click());
  await until(async () => ((await B.docs())['leaf/main/study/2026-11-15'] || {entries:[]}).entries.length === 5, 'five study hours');
  for(let i = 0; i < 6; i++){ await B.setTime(T0 + min(3 + i)); await B.logSet(8); await until(async () => ((await B.docs())[TODAY] || {sets:[]}).sets.length === i + 1, `set ${i + 1}`); }
  await until(async () => /You lead (2–1|3–0) so far/.test(await card()), 'the lead to show');
  assert.match(await card(), /Study\s*5h\s*4h by Sun/); assert.match(await card(), /Reps\s*48 reps\s*43 reps by Sun/);
  await B.close();
  /* the next Sunday: last week's result (nothing was logged after the import, so the clone won) */
  const S = await fresh('rival-sunday', {now:at('2026-11-22', 9, 0)});
  await closeScenes(S);
  assert.equal(await S.page.locator('#rival-last').textContent(), 'Last week your shadow clone won 3–0. A new race starts today.');
  await S.close();
  noErrors();
});

test('focus cycles: 50 minutes of work, a 10-minute break that is not counted, and the 3-hour check still works', async () => {
  const B = await fresh('focus');
  const sc = await openScroll(B, 'study');
  const entries = async () => ((await B.docs())['leaf/main/study/2026-11-15'] || {entries:[]}).entries.map(e => e.min);
  assert.match(await sc.locator('[data-act="st-start"]').textContent(), /Start study timer/);
  await sc.locator('[data-act="st-focus"]').click();
  assert.match(await sc.locator('[data-act="st-start"]').textContent(), /Start focus cycle/);
  assert.equal(await sc.locator('[data-act="st-focus"]').getAttribute('aria-pressed'), 'true');
  await sc.locator('[data-act="st-start"]').click();
  await B.page.waitForSelector('.stimer.run');
  assert.equal((await B.docs())['leaf/timer'].focus, true);
  await B.setTime(T0 + min(20));
  await until(async () => /Break in 30:00/.test(await sc.locator('[data-phase]').textContent()), 'the countdown to the break');
  assert.match(await sc.locator('.stimer .eyebrow').textContent(), /Focus · cycle 1/);
  await B.setTime(T0 + min(55));
  await B.page.waitForSelector('.stimer.rest');
  assert.match(await sc.locator('.stimer .eyebrow').textContent(), /Chakra recovery · cycle 1/);
  assert.match(await sc.locator('[data-phase]').textContent(), /Work starts again in 5:00\. This break is not counted/);
  assert.equal(await sc.locator('[data-timer]').textContent(), '0:50:00', 'the clock face stops at 50 minutes during the break');
  await until(async () => /Chakra recovery: 10 minutes/.test(await toastText(B)), 'the break to be announced');
  assert.match(await sc.locator('.roll-label small').textContent(), /50m of 4h/, 'only the work is counted');
  await B.setTime(T0 + min(75));
  await until(async () => /Focus · cycle 2/.test(await sc.locator('.stimer .eyebrow').textContent()), 'the second cycle');
  assert.equal(await B.page.locator('.stimer.rest').count(), 0);
  await sc.locator('[data-act="st-finish"]').click();
  await until(async () => (await entries()).length === 2, 'both work stretches to be logged');
  assert.deepEqual(await entries(), [50, 15]);
  assert.match(await toastText(B), /Session done · 1h 5m studied/);
  /* left running: the 3-hour check, then stop at the mark = three work stretches of 50 minutes */
  await B.setTime(T0 + min(100));
  await sc.locator('[data-act="st-start"]').click();
  await B.page.waitForSelector('.stimer.run');
  await B.setTime(T0 + min(100 + 185));
  await B.page.waitForSelector('.stimer.check');
  await sc.locator('[data-act="st-stopcheck"]').click();
  await until(async () => (await entries()).length === 5, 'three more stretches');
  assert.deepEqual(await entries(), [50, 15, 50, 50, 50]);
  assert.equal((await B.docs())['leaf/timer'].state, 'idle');
  /* turning it off gives the plain timer back */
  await sc.locator('[data-act="st-focus"]').click();
  await B.setTime(T0 + min(300));
  await sc.locator('[data-act="st-start"]').click();
  await B.page.waitForSelector('.stimer.run');
  assert.equal((await B.docs())['leaf/timer'].focus, undefined);
  await B.setTime(T0 + min(355));
  await sc.locator('[data-act="st-finish"]').click();
  await until(async () => (await entries()).length === 6, 'the plain stretch');
  assert.equal((await entries())[5], 55);
  await B.close();
  noErrors();
});

test('jutsu unlocks: available at a rank, learned through its own baseline test, and only in the plan if it is added there', async () => {
  const B = await fresh('jutsu');
  await B.tab('ninja');
  const card = B.page.locator('#jutsu-card');
  assert.match(await card.locator('.section-head').textContent(), /5 \/ 10 unlocked/);
  assert.equal(await card.locator('li.open').count(), 5); assert.equal(await card.locator('li.locked').count(), 5);
  assert.match(await card.locator('[data-jutsu="weighted-pullups"]').textContent(), /Unlocks at Akatsuki/);
  assert.equal(await card.locator('li.locked button').count(), 0, 'a locked jutsu cannot be started');
  await card.locator('[data-act="jutsu-open"][data-id="archer-pullups"]').click();
  await card.locator('[data-act="jutsu-learn"]').click();
  assert.match(await toastText(B), /Enter the reps from your baseline set/);
  await B.page.fill('#jutsu-max', '4');
  await card.locator('[data-act="jutsu-learn"]').click();
  const s = await until(async () => { const x = (await B.docs())['leaf/main']; return x.exercises['archer-pullups'] ? x : null; }, 'the jutsu to be saved');
  assert.deepEqual(s.exercises['archer-pullups'], {name:'Archer pull-ups', jutsu:true});
  assert.deepEqual(s.baseline['archer-pullups'], {max:4, date:'2026-11-15'});
  assert.deepEqual(s.scheduleHistory, fixture.settings.scheduleHistory, 'the plan is untouched');
  assert.match(await card.locator('[data-jutsu="archer-pullups"]').textContent(), /Learned.*Baseline 4 on 15 Nov.*Choose it for a day in the Plan tab/);
  assert.equal(await card.locator('li.learned').count(), 1);
  await B.tab('mission');
  assert.match(await B.page.locator('.mscroll[data-sid="work"] .roll-label b').textContent(), /Pull-up Groove/, 'today\'s mission is the same');
  /* it can now be chosen in the Plan tab, and starts tomorrow like any plan change */
  await B.tab('plan');
  const options = await B.page.locator('#plan-day-2 option').allTextContents();
  assert.ok(options.includes('Archer pull-ups groove'), options.join(' | '));
  assert.equal(await B.page.locator('[data-act="test-ex"][data-ex="archer-pullups"]').isChecked(), false, 'not on test days unless ticked');
  await B.page.selectOption('#plan-day-2', 'gtg:archer-pullups');
  await B.page.locator('[data-act="plan-save"]').click();
  const s2 = await until(async () => { const x = (await B.docs())['leaf/main']; return x.scheduleHistory.length === 3 ? x : null; }, 'the plan to be saved');
  assert.equal(s2.scheduleHistory[2].from, '2026-11-16'); assert.deepEqual(s2.scheduleHistory[2].plan[2], {type:'gtg', ex:'archer-pullups'});
  await B.setTime(at('2026-11-17', 9, 0));
  await until(async () => /17 November/.test(await B.page.evaluate(() => { location.hash = 'mission'; const e = document.querySelector('.stage .eyebrow'); return e ? e.textContent : ''; })), 'Tuesday');
  await closeScenes(B);
  assert.match(await B.page.locator('.mscroll[data-sid="work"] .roll-label b').textContent(), /Archer pull-up Groove/);
  await openScroll(B, 'work');
  assert.match(await B.page.locator('.mscroll[data-sid="work"] .mission-sub').textContent(), /6 mini-sets of 2 strict archer pull-ups/);
  await B.close();
  /* a promotion names the jutsu it unlocks */
  const behind = clone(fixture); behind.settings.celebrated = 4;
  const P = await fresh('jutsu-promo', {file:tmpFile('behind2.json', behind)});
  await P.page.waitForSelector('#overlay .promo');
  assert.match(await P.page.locator('#promo-jutsu').textContent(), /New jutsu unlocked: Ring dips\. Its scroll is in the Ninja tab/);
  await P.close();
  noErrors();
});

test('iPad screenshots of every tab, landscape and portrait (looked at by hand)', async () => {
  for(const [name, viewport] of [['landscape', {width:1148, height:802}], ['portrait', {width:820, height:1180}]]){
    const B = await rig.device('shots-' + name, {now:T0 + min(30), viewport});
    await B.open(); await B.importBackup(FIXTURE);
    await B.logSet(8);
    await sleep(900);
    for(const t of ['mission', 'stats', 'plan', 'ninja', 'settings']){
      await B.tab(t); await sleep(700);
      await B.page.screenshot({path:`${TMP}ui-${name}-${t}.png`});
      const over = await B.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, `${name} ${t}: no sideways scrolling (${over}px)`);
    }
    await B.close();
  }
  noErrors();
});
