/* Browser test rig: serves this repository under /Leaf-village/ (like GitHub Pages), runs the real Worker
   code next to it, and opens the app in Chromium as one or more "devices" with separate storage. */
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeEnv, startWorker } from './lib-worker.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript', '.json':'application/json', '.webmanifest':'application/manifest+json',
  '.jpg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.mp4':'video/mp4', '.css':'text/css', '.md':'text/markdown'};

export async function startSite(port){
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if(!url.pathname.startsWith('/Leaf-village/')){ res.writeHead(404); res.end('not found'); return; }
    let rel = decodeURIComponent(url.pathname.slice('/Leaf-village/'.length)) || 'index.html';
    const file = path.join(ROOT, rel);
    if(!file.startsWith(ROOT) || /(^|\/)(node_modules|\.git)\//.test(rel)){ res.writeHead(403); res.end(); return; }
    try{
      const st = await stat(file); if(st.isDirectory()) throw new Error('dir');
      res.writeHead(200, {'Content-Type':TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache'});
      res.end(await readFile(file));
    }catch(e){ res.writeHead(404); res.end('not found'); }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return server;
}

export const KEY = 'test-key-for-the-village';
/* everything a browser test needs: the site, the Worker, and a Chromium that cannot reach the internet */
export async function startRig(basePort){
  const sitePort = basePort, workerPort = basePort + 1;
  const origin = `http://127.0.0.1:${sitePort}`;
  const env = makeEnv({LEAF_SYNC_KEY:KEY, ALLOWED_ORIGIN:origin, APP_URL:origin + '/Leaf-village/', PUSH_TEST_HOSTS:`127.0.0.1:${workerPort + 1}`});
  const site = await startSite(sitePort), worker = await startWorker(env, workerPort);
  const browser = await chromium.launch({args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
  const errors = [];
  const rig = {
    env, site, worker, browser, errors, origin, appUrl:origin + '/Leaf-village/', workerUrl:`http://127.0.0.1:${workerPort}`, pushPort:workerPort + 1,
    /* a device = its own storage. opts.now fixes the clock (Baghdad time zone always). */
    async device(name, opts){
      const o = opts || {};
      const ctx = await browser.newContext({viewport:o.viewport || {width:820, height:1180}, timezoneId:'Asia/Baghdad', locale:'en-GB', serviceWorkers:o.serviceWorkers || 'block', acceptDownloads:true, permissions:o.permissions || []});
      await ctx.addInitScript(url => { try{ localStorage.setItem('leaf-sync-url', url); }catch(e){} }, o.syncUrl || rig.workerUrl);
      const page = await ctx.newPage();
      if(o.now) await page.clock.setFixedTime(new Date(o.now));
      page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
      page.on('console', m => { if(m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
      const dev = {name, ctx, page,
        async open(hash){ await page.goto(rig.appUrl + (hash || ''), {waitUntil:'domcontentloaded'}); await page.waitForFunction(() => !document.querySelector('.loading')); return dev; },
        async tab(t){ await page.evaluate(h => { location.hash = h; }, t); await page.waitForSelector(`nav a[data-tab="${t}"][aria-current="page"]`); },
        /* every saved document on this device */
        docs(){ return page.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('leaf-village-local'); r.onerror = () => rej(r.error); r.onsuccess = () => { const out = {}; const t = r.result.transaction('docs', 'readonly'); const c = t.objectStore('docs').openCursor(); c.onsuccess = () => { const cur = c.result; if(cur){ out[cur.key] = cur.value; cur.continue(); } }; t.oncomplete = () => { r.result.close(); res(out); }; }; })); },
        sync(){ return page.evaluate(() => window.LeafSync.syncNow()); },
        status(){ return page.evaluate(() => window.LeafSync.status()); },
        async setTime(t){ await page.clock.setFixedTime(new Date(t)); },
        async importBackup(file){
          await page.setInputFiles('#import-file', file);
          await page.waitForSelector('[data-act="import-yes"]');
          /* the app reloads itself after importing: wait for the new page, not the old one */
          await page.evaluate(() => { window.__beforeImport = true; });
          await page.click('[data-act="import-yes"]');
          await page.waitForFunction(() => !window.__beforeImport && !document.querySelector('.loading') && !!document.querySelector('nav a[aria-current="page"]'), null, {timeout:30000});
        },
        /* turn on sync through the Settings card, the way Sharaf will */
        async turnOnSync(key){
          await dev.tab('settings');
          await page.fill('#sync-key', key || KEY);
          await page.click('[data-act="sync-on"]');
          await page.waitForFunction(() => { const s = window.LeafSync.status(); return s.state !== 'syncing' && (s.last > 0 || !!s.error); });
        },
        async logSet(reps){
          await dev.tab('mission');
          await page.evaluate(() => { const b = document.querySelector('.mscroll[data-sid="work"] [data-act="scroll-toggle"]'); const sc = document.querySelector('.mscroll[data-sid="work"]'); if(b && sc && !sc.classList.contains('open')) b.click(); });
          const key = await page.evaluate(() => document.querySelector('[data-act="log"]').dataset.key);
          const cur = await page.evaluate(k => Number(document.querySelector(`[data-act="step"][data-key="${k}"]`).closest('.stepper').querySelector('.val b').textContent), key);
          for(let i = cur; i < reps; i++) await page.evaluate(k => document.querySelector(`[data-act="step"][data-key="${k}"][data-d="1"]`).click(), key);
          for(let i = cur; i > reps; i--) await page.evaluate(k => document.querySelector(`[data-act="step"][data-key="${k}"][data-d="-1"]`).click(), key);
          await page.evaluate(() => document.querySelector('[data-act="log"]').click());
        },
        async close(){ await ctx.close(); }
      };
      return dev;
    },
    async stop(){ await browser.close(); await new Promise(r => site.close(r)); await new Promise(r => worker.close(r)); }
  };
  return rig;
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function until(fn, what, ms = 8000){
  const t0 = Date.now(); let last;
  while(Date.now() - t0 < ms){ last = await fn(); if(last) return last; await sleep(60); }
  throw new Error(`timed out waiting for: ${what}`);
}
