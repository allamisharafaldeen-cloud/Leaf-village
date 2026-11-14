/* The Leaf Village · platform layer: saving on the device, plus background sync.
   The app was first built inside Claude, where saving, file storage and downloads came from
   Claude's artifact features. This file provides the same three features on the device itself:
   - db:        your logs, settings and preferences, kept in this device's IndexedDB
   - assets:    photos and sounds you add later, kept in IndexedDB as files
   - downloads: the backup file, offered through the share sheet (Save to Files) or a download
   Files that came with the app (your photos, music and sounds from the Claude version) live in
   the media/ folder and are listed in BUNDLED below.

   Sync (window.LeafSync, further down) is a background extra. Every log is saved on the device
   first, exactly as before; if a sync key is set, changes are then copied to your own small online
   database and merged with what other devices saved (rules in leaf-merge.js). If the server can't
   be reached, nothing in the app waits for it or shows an error. Added photos and music stay on
   the device and are not synced. */
(function(){
'use strict';

/* files shipped with the app: asset id -> file in media/ */
const BUNDLED = { "04baf85978a90d901be411fd8aabf43e": "04baf85978a90d901be411fd8aabf43e.jpg", "0cf141c4617406724f4fc4d2148c5a4b": "0cf141c4617406724f4fc4d2148c5a4b.jpg", "106315c3656e4822e889983fd281af4f": "106315c3656e4822e889983fd281af4f.jpg", "1cf51ee0bdafbad96d967453c6e449db": "1cf51ee0bdafbad96d967453c6e449db.mp4", "236748730ea6df4f87634613c0a186fb": "236748730ea6df4f87634613c0a186fb.mp4", "5e47551e43ecb539f92386566fd875dc": "5e47551e43ecb539f92386566fd875dc.mp4", "61086f82549a63c7b6d2767a929e318b": "61086f82549a63c7b6d2767a929e318b.jpg", "63c736ee956cf8a8da6048a07a464365": "63c736ee956cf8a8da6048a07a464365.mp4", "6b1b25ac0ecf14f8469fa1edbefe782e": "6b1b25ac0ecf14f8469fa1edbefe782e.jpg", "7e50605ef8db59e51500cdbd09e4bad1": "7e50605ef8db59e51500cdbd09e4bad1.jpg", "7e675d801254c215cf318e4f1a7f659a": "7e675d801254c215cf318e4f1a7f659a.mp4", "80d85646aab54c9d54290196def1811f": "80d85646aab54c9d54290196def1811f.mp4", "95dfb73fc94beca212496f6c476d51f2": "95dfb73fc94beca212496f6c476d51f2.jpg", "9d8ad0fc80a43ead43677fac144839ba": "9d8ad0fc80a43ead43677fac144839ba.mp4", "9f018bf25b7328a533dad4843d0836a0": "9f018bf25b7328a533dad4843d0836a0.jpg", "b04a0e695aca0f3f48c232eed209448e": "b04a0e695aca0f3f48c232eed209448e.jpg", "c279c8d56915fbd9ff1076c1508e448c": "c279c8d56915fbd9ff1076c1508e448c.jpg", "e72ce34a5db7454f91710c3f1731f89b": "e72ce34a5db7454f91710c3f1731f89b.mp4", "fb4f2ca55fffb735fc8fab1a38b273b1": "fb4f2ca55fffb735fc8fab1a38b273b1.mp4" };

const DB_NAME = 'leaf-village-local';
let dbp = null;
function openDb(){
  if(dbp) return dbp;
  dbp = new Promise((res, rej)=>{
    try{
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = ()=>{ const d=r.result; if(!d.objectStoreNames.contains('docs')) d.createObjectStore('docs'); if(!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs'); };
      r.onsuccess = ()=>res(r.result);
      r.onerror = ()=>rej(r.error);
      r.onblocked = ()=>rej(new Error('blocked'));
    }catch(e){ rej(e); }
  });
  return dbp;
}
function tx(store, mode, fn){
  return openDb().then(d=>new Promise((res, rej)=>{
    const t = d.transaction(store, mode), st = t.objectStore(store);
    let out; const rq = fn(st);
    if(rq) rq.onsuccess = ()=>{ out = rq.result; };
    t.oncomplete = ()=>res(out);
    t.onerror = ()=>rej(t.error);
    t.onabort = ()=>rej(t.error || new Error('aborted'));
  }));
}
function allEntries(store){
  return openDb().then(d=>new Promise((res, rej)=>{
    const t = d.transaction(store, 'readonly'), st = t.objectStore(store), out = {};
    const rq = st.openCursor();
    rq.onsuccess = ()=>{ const c = rq.result; if(c){ out[c.key] = c.value; c.continue(); } };
    t.oncomplete = ()=>res(out);
    t.onerror = ()=>rej(t.error);
  }));
}
const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));

/* ---------- documents ---------- */
const docs = {};            // full path -> data
const docListeners = {};    // path -> [fn]
const colListeners = {};    // collection path -> [fn]
const meta = { fromCache:false, hasPendingWrites:false };
let ready = null;
const M = window.LeafMerge || null;      // merge rules (leaf-merge.js); without them the app still saves locally

/* everything that changes a document goes through this queue, one at a time, so a save from the app
   and a merge from sync can never overwrite each other */
let chain = Promise.resolve();
const lock = fn => { const p = chain.then(fn, fn); chain = p.catch(()=>{}); return p; };

const isChild = (key, col) => key.length > col.length + 1 && key.slice(0, col.length + 1) === col + '/' && key.indexOf('/', col.length + 1) === -1;
const colOf = path => path.slice(0, path.lastIndexOf('/'));
/* seen[path] = the copy of a document the app last looked at (or last saved). When the app saves a day,
   the entries it had seen but left out are the ones it removed on purpose (Undo). */
const seen = {};
const docSnap = path => { const v = docs[path]; seen[path] = v; return { id:path.split('/').pop(), exists: v !== undefined, data: ()=>clone(v), metadata: meta }; };
const colSnap = col => ({ metadata: meta, docs: Object.keys(docs).filter(k=>isChild(k, col)).sort().map(k=>{ seen[k] = docs[k]; return { id:k.slice(col.length+1), data: ()=>clone(docs[k]) }; }) });

/* tell the app about changed documents: each listener hears once, however many documents changed */
function notifyMany(paths){
  const later = fn => setTimeout(fn, 0), cols = {};
  paths.forEach(path=>{
    (docListeners[path]||[]).forEach(l=>later(()=>l.cb(docSnap(path))));
    cols[colOf(path)] = 1;
  });
  Object.keys(cols).forEach(col=>{ (colListeners[col]||[]).forEach(l=>later(()=>l.cb(colSnap(col)))); });
}
const notify = path => notifyMany([path]);
const syncable = path => !!M && !!M.kindOf(path) && path !== 'leaf/summary';

const dbApi = Object.freeze({
  doc(path){
    return {
      onSnapshot(cb, err){
        const l = {cb, err}; (docListeners[path] = docListeners[path] || []).push(l);
        ready.then(()=>cb(docSnap(path))).catch(e=>err && err(e));
        return ()=>{ docListeners[path] = (docListeners[path]||[]).filter(x=>x!==l); };
      },
      async get(){ await ready; return docSnap(path); },
      set(data){
        const v = clone(data), base = seen[path];
        seen[path] = v;
        return ready.then(()=>lock(async ()=>{
          let next = v; const prevRemoved = sm.removed[path], prevDirty = sm.dirty[path];
          if(syncable(path)){
            if(M.isEntries(path)){
              /* keep anything sync merged in that the app hasn't seen yet; drop only what the app itself removed */
              const removed = M.unionKeys(prevRemoved, M.removedKeys(path, base, v));
              next = M.mergeEntries(path, docs[path] || {}, v, removed);
              if(removed.length) sm.removed[path] = removed;
            }
            if(docs[path] === undefined || !M.same(next, docs[path])){ sm.dirty[path] = Date.now(); saveMeta(); }
          }
          try{ await tx('docs', 'readwrite', st=>st.put(next, path)); }
          catch(e){
            seen[path] = docs[path];
            if(prevRemoved) sm.removed[path] = prevRemoved; else delete sm.removed[path];
            if(prevDirty !== undefined) sm.dirty[path] = prevDirty; else delete sm.dirty[path];
            saveMeta();
            throw { code: (e && e.name === 'QuotaExceededError') ? 'quota_exceeded' : 'unavailable', message: String(e && e.message || e) };
          }
          docs[path] = next; ver[path] = (ver[path] || 0) + 1; notify(path);
          if(sm.dirty[path] !== undefined) kick(2500);
        }));
      },
      async delete(){ await ready; await lock(async ()=>{ await tx('docs', 'readwrite', st=>st.delete(path)); delete docs[path]; delete sm.dirty[path]; delete sm.removed[path]; saveMeta(); notify(path); }); }
    };
  },
  collection(col){
    return {
      onSnapshot(cb, err){
        const l = {cb, err}; (colListeners[col] = colListeners[col] || []).push(l);
        ready.then(()=>cb(colSnap(col))).catch(e=>err && err(e));
        return ()=>{ colListeners[col] = (colListeners[col]||[]).filter(x=>x!==l); };
      }
    };
  }
});

/* ---------- files ---------- */
const objectUrls = {};
function hex(n){ const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b=>b.toString(16).padStart(2,'0')).join(''); }
const assetsApi = Object.freeze({
  async upload(blob, opts){
    await ready;
    const type = (opts && opts.type) || blob.type || 'application/octet-stream';
    const b = blob.type === type ? blob : new Blob([blob], {type});
    if(b.size > 20*1024*1024) throw { code:'too_large' };
    const id = hex(16);
    try{ await tx('blobs', 'readwrite', st=>st.put(b, id)); }
    catch(e){ throw { code: (e && e.name === 'QuotaExceededError') ? 'quota_or_state' : 'unavailable' }; }
    objectUrls[id] = URL.createObjectURL(b);
    return { id, url: objectUrls[id], type, size: b.size };
  },
  async delete(id){
    if(BUNDLED[id]) return;
    await tx('blobs', 'readwrite', st=>st.delete(id));
    if(objectUrls[id]){ URL.revokeObjectURL(objectUrls[id]); delete objectUrls[id]; }
  }
});
/* the app asks for a file's address by id */
window.blobUrl = id => !id ? '' : BUNDLED[id] ? 'media/' + BUNDLED[id] : (objectUrls[id] || 'media/missing');

/* ---------- downloads ---------- */
const MIME = { json:'application/json', csv:'text/csv', txt:'text/plain', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', pdf:'application/pdf' };
const downloadsApi = Object.freeze({
  async save({filename, data}){
    const ext = (String(filename).split('.').pop() || '').toLowerCase();
    const blob = data instanceof Blob ? data : new Blob([data], {type: MIME[ext] || 'application/octet-stream'});
    const file = (()=>{ try{ return new File([blob], filename, {type: blob.type}); }catch(e){ return null; } })();
    const touch = matchMedia('(pointer: coarse)').matches;
    if(touch && file && navigator.canShare && navigator.canShare({files:[file]})){
      try{ await navigator.share({files:[file], title:filename}); return {status:'saved'}; }
      catch(e){ if(e && e.name === 'AbortError') throw {code:'declined'}; }
    }
    const a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(u), 30000);
    return {status:'saved'};
  }
});

/* ---------- start-up ---------- */
ready = (async ()=>{
  const all = await allEntries('docs');
  Object.keys(all).forEach(k=>{ docs[k] = all[k]; });
  try{
    const blobs = await allEntries('blobs');
    Object.keys(blobs).forEach(id=>{ if(blobs[id] instanceof Blob) objectUrls[id] = URL.createObjectURL(blobs[id]); });
  }catch(e){}
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
})();
ready.catch(()=>{});

/* used by Import backup: swaps everything saved on this device for the backup's contents */
window.LeafLocal = Object.freeze({
  async replaceAll(map){
    await ready;
    await lock(()=>openDb().then(d=>new Promise((res, rej)=>{
      const t = d.transaction('docs', 'readwrite'), st = t.objectStore('docs');
      st.clear();
      Object.keys(map).forEach(k=>{ if(map[k] != null) st.put(clone(map[k]), k); });
      t.oncomplete = res; t.onerror = ()=>rej(t.error); t.onabort = ()=>rej(t.error || new Error('aborted'));
    })).then(()=>{
      /* with sync on, the import is uploaded and then merged with the online copy: its settings win,
         and logs are joined, so nothing logged elsewhere is lost */
      const now = Date.now();
      sm.dirty = {}; sm.removed = {}; sm.cursor = 0;
      Object.keys(map).forEach(k=>{ if(map[k] != null && syncable(k)) sm.dirty[k] = now; });
      saveMeta();
    }));
  },
  hasData(){ return ready.then(()=>Object.keys(docs).some(k=>k.indexOf('leaf/main/days/')===0 || k.indexOf('leaf/main/study/')===0)); }
});

/* ---------- sync ---------- */
/* where the online copy lives (a Cloudflare Worker owned by Sharaf; see worker/) */
const SYNC_URL = 'https://leaf-village-sync.allamisharafaldeen.workers.dev';
const LS = { get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }, set(k, v){ try{ if(v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); }catch(e){} } };
const syncUrl = () => (LS.get('leaf-sync-url') || SYNC_URL).replace(/\/+$/, '');
/* what this device remembers about syncing: which documents still need uploading (dirty), what Undo removed,
   and how far it has read the online copy (cursor) */
const sm = (()=>{ let o = {}; try{ o = JSON.parse(LS.get('leaf-sync') || '{}') || {}; }catch(e){}
  return { cursor:+o.cursor || 0, gen:o.gen || null, last:+o.last || 0, err:o.err || null, skew:+o.skew || 0, vapid:o.vapid || null,
    dirty:(o.dirty && typeof o.dirty === 'object') ? o.dirty : {}, removed:(o.removed && typeof o.removed === 'object') ? o.removed : {} }; })();
function saveMeta(){ LS.set('leaf-sync', JSON.stringify(sm)); }
const ver = {};                       // path -> how many times the app has saved it since the page opened
const getKey = () => (LS.get('leaf-sync-key') || '').trim();
const sync = { state:'idle', running:null, again:false, timer:null, retry:0, listeners:[], lastTry:0, note:null };
function changed(){ sync.listeners.slice().forEach(fn=>{ try{ fn(); }catch(e){} }); }

let tokenFor = null;
async function token(){
  const key = getKey();
  if(tokenFor && tokenFor.key === key) return tokenFor.token;
  if(!(window.crypto && crypto.subtle)) throw {code:'unsupported'};
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('leaf-village|' + key));
  tokenFor = {key, token:Array.from(new Uint8Array(buf), b=>b.toString(16).padStart(2,'0')).join('')};
  return tokenFor.token;
}
/* one call to the Worker. Any failure becomes a plain code: offline · key · server */
async function request(path, method, body){
  const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
  const timer = setTimeout(()=>{ if(ctl) ctl.abort(); }, 25000);
  try{
    const res = await fetch(syncUrl() + path, { method, headers:{ 'Authorization':'Bearer ' + await token(), 'Content-Type':'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: ctl ? ctl.signal : undefined, cache:'no-store', credentials:'omit' });
    if(res.status === 401) throw {code:'key'};
    if(!res.ok) throw {code:'server', status:res.status};
    const json = await res.json();
    if(json && typeof json.now === 'number') sm.skew = json.now - Date.now();
    if(json && typeof json.vapid === 'string') sm.vapid = json.vapid;
    return json;
  }catch(e){ if(e && e.code) throw e; throw {code:'offline'}; }
  finally{ clearTimeout(timer); }
}

function putMany(pairs){
  return openDb().then(d=>new Promise((res, rej)=>{
    const t = d.transaction('docs', 'readwrite'), st = t.objectStore('docs');
    pairs.forEach(([k, v])=>st.put(v, k));
    t.oncomplete = res; t.onerror = ()=>rej(t.error); t.onabort = ()=>rej(t.error || new Error('aborted'));
  }));
}
/* merge documents that came from the online copy into this device.
   first: this device has never synced before. pushed: {path: version we sent} for documents we just uploaded. */
function applyRemote(list, first, pushed){
  return lock(async ()=>{
    const writes = [];
    let localWins = false;
    if(first){
      /* two villages meeting for the first time: the one with the longer history keeps its settings */
      const R = list.find(d=>d && d.path === 'leaf/main'), L = docs['leaf/main'];
      localWins = !!(L && R && R.data && L.startDate && R.data.startDate && L.startDate < R.data.startDate);
    }
    list.forEach(d=>{
      if(!d || !syncable(d.path) || !d.data || typeof d.data !== 'object') return;
      const path = d.path, local = docs[path];
      if(M.isEntries(path)){
        const removed = M.unionKeys(sm.removed[path], d.removed);
        const merged = M.mergeEntries(path, d.data, local || {}, removed);
        if(local === undefined || !M.same(merged, local)) writes.push([path, merged]);
        const theirs = M.mergeEntries(path, d.data, {}, d.removed || []);
        const told = new Set(d.removed || []), allTold = (sm.removed[path] || []).every(k=>told.has(k));
        if(M.same(merged, theirs) && allTold){ delete sm.dirty[path]; delete sm.removed[path]; }      // the online copy has everything we have
        else if(sm.dirty[path] === undefined) sm.dirty[path] = Date.now();                          // we hold something it lacks: upload
      } else {
        const mine = sm.dirty[path];
        let keep;
        if(local === undefined || mine === undefined) keep = false;                                  // nothing unsent here: take theirs
        else if(pushed && pushed[path] !== undefined && pushed[path] === (ver[path] || 0)) keep = false; // the server has judged the copy we sent
        else if(first) keep = localWins;
        else keep = mine + sm.skew > (d.mtime || 0);                                                 // our edit is the later one
        if(keep){ if(first) sm.dirty[path] = Date.now(); return; }
        delete sm.dirty[path];
        if(local === undefined || !M.same(local, d.data)) writes.push([path, d.data]);
      }
    });
    if(writes.length){
      await putMany(writes);
      writes.forEach(([k, v])=>{ docs[k] = v; });
      notifyMany(writes.map(w=>w[0]));
    }
    saveMeta();
  });
}

const BATCH = 20, BATCH_BYTES = 300000;
function nextBatch(tries){
  const out = []; let bytes = 0;
  Object.keys(sm.dirty).sort().some(path=>{
    if(docs[path] === undefined || !syncable(path)){ delete sm.dirty[path]; delete sm.removed[path]; return false; }
    if((tries[path] || 0) >= 3) return false;
    const size = JSON.stringify(docs[path]).length;
    if(out.length && bytes + size > BATCH_BYTES) return true;
    out.push(path); bytes += size;
    return out.length >= BATCH;
  });
  return out;
}
async function runSync(depth){
  await ready;
  const first = !sm.gen;
  if(first) await lock(async ()=>{ Object.keys(docs).forEach(p=>{ if(syncable(p) && sm.dirty[p] === undefined) sm.dirty[p] = 0; }); saveMeta(); });
  let since = first ? 0 : sm.cursor, gen = sm.gen, more = true;
  if(first){
    /* read the whole online copy before deciding anything */
    const all = [];
    for(let i = 0; more && i < 400; i++){
      const res = await request('/sync', 'POST', {since, docs:[]});
      (res.docs || []).forEach(d=>all.push(d)); since = res.cursor; more = !!res.more; gen = res.gen;
    }
    await applyRemote(all, true, null);
  }
  const tries = {};
  for(let round = 0; round < 600; round++){
    const batch = nextBatch(tries);
    if(!batch.length && !more) break;
    const pushed = {};
    const payload = batch.map(path=>{ pushed[path] = ver[path] || 0; tries[path] = (tries[path] || 0) + 1;
      return { path, data:docs[path], mtime: sm.dirty[path] ? sm.dirty[path] + sm.skew : 0, removed: sm.removed[path] || [] }; });
    const res = await request('/sync', 'POST', {since, docs:payload});
    if(!first && gen && res.gen !== gen){
      /* the online database was replaced by a new, empty one: start over and upload everything */
      if(depth) throw {code:'server'};
      sm.gen = null; sm.cursor = 0; saveMeta();
      return runSync(1);
    }
    gen = res.gen;
    await applyRemote(res.docs || [], false, pushed);
    /* anything we sent that did not come back was refused by the server: stop offering it */
    const back = new Set((res.docs || []).map(d=>d && d.path));
    batch.forEach(path=>{ if(!back.has(path) && pushed[path] === (ver[path] || 0)){ delete sm.dirty[path]; delete sm.removed[path]; } });
    since = res.cursor; more = !!res.more;
  }
  sm.cursor = since; sm.gen = gen; sm.last = Date.now(); sm.err = null; saveMeta();
}
/* start a sync unless one is running; never throws, never blocks the app */
function syncNow(){
  if(!M || !getKey()) return Promise.resolve(false);
  if(sync.running){ sync.again = true; return sync.running; }
  clearTimeout(sync.timer); sync.timer = null;
  sync.state = 'syncing'; sync.lastTry = Date.now(); changed();
  sync.running = runSync(0).then(()=>{ sync.state = 'idle'; sync.retry = 0; return true; }, e=>{
    sm.err = (e && e.code) || 'server'; saveMeta(); sync.state = 'error';
    if(sm.err !== 'key'){ sync.retry = Math.min(sync.retry + 1, 6); kick(Math.min(600000, 15000 * Math.pow(2, sync.retry - 1))); }
    return false;
  }).then(ok=>{
    sync.running = null; changed();
    if(sync.again){ sync.again = false; kick(500); }
    else if(ok && Object.keys(sm.dirty).length) kick(60000);
    if(ok) refreshPush();
    return ok;
  });
  return sync.running;
}
function kick(ms){
  if(!M || !getKey()) return;
  if(sync.running){ sync.again = true; return; }
  clearTimeout(sync.timer);
  sync.timer = setTimeout(()=>{ sync.timer = null; syncNow(); }, ms);
}

/* ---------- notifications (Web Push) ---------- */
const b64uToBytes = str => { const t = String(str).replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '==='.slice((t.length + 3) % 4)); const a = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
const bytesToB64u = buf => { let t = ''; const a = new Uint8Array(buf); for(let i = 0; i < a.length; i++) t += String.fromCharCode(a[i]); return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const pushSupported = () => ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
const deviceName = () => { const ua = navigator.userAgent || ''; return /iPhone/.test(ua) ? 'iPhone' : (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : 'Browser'; };
async function subscribePush(){
  const reg = await navigator.serviceWorker.ready;
  if(!sm.vapid){ await request('/sync', 'POST', {since:2147483647, docs:[]}); saveMeta(); }
  if(!sm.vapid) throw {code:'server'};
  let sub = await reg.pushManager.getSubscription();
  if(sub && sub.options && sub.options.applicationServerKey && bytesToB64u(sub.options.applicationServerKey) !== sm.vapid){ try{ await sub.unsubscribe(); }catch(e){} sub = null; }
  if(!sub) sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64uToBytes(sm.vapid)});
  const old = LS.get('leaf-push-endpoint');
  await request('/push/subscribe', 'POST', {subscription:sub.toJSON(), device:deviceName(), replaces: old && old !== sub.endpoint ? old : undefined});
  LS.set('leaf-push-endpoint', sub.endpoint); LS.set('leaf-push-checked', String(Date.now()));
  return sub;
}
/* once a day, make sure the server still has this device's current push address */
function refreshPush(){
  if(!pushSupported() || !LS.get('leaf-push-endpoint') || Notification.permission !== 'granted') return;
  if(Date.now() - (+LS.get('leaf-push-checked') || 0) < 20 * 3600000) return;
  LS.set('leaf-push-checked', String(Date.now()));
  subscribePush().then(changed, ()=>{});
}
const pushApi = {
  status(){
    const supported = pushSupported();
    return { supported, permission: supported ? Notification.permission : 'unsupported', on: supported && Notification.permission === 'granted' && !!LS.get('leaf-push-endpoint') };
  },
  /* must be called straight from a tap: iPadOS only shows the permission question then */
  async enable(){
    if(!pushSupported()) throw {code:'unsupported'};
    if(!getKey()) throw {code:'nosync'};
    const perm = await new Promise(res=>{ let r; try{ r = Notification.requestPermission(res); }catch(e){ res('denied'); return; } if(r && r.then) r.then(res, ()=>res('denied')); });
    if(perm !== 'granted'){ changed(); throw {code:'denied'}; }
    try{ await subscribePush(); }
    catch(e){ throw (e && e.code) ? e : {code:'subscribe', message:String(e && e.message || e)}; }
    finally{ changed(); }
    return true;
  },
  async disable(){
    const endpoint = LS.get('leaf-push-endpoint'); LS.set('leaf-push-endpoint', null);
    try{ const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if(sub) await sub.unsubscribe(); }catch(e){}
    try{ if(endpoint) await request('/push/unsubscribe', 'POST', {endpoint}); }catch(e){}
    changed();
  },
  test(){ return request('/push/test', 'POST', {}); }
};

window.LeafSync = Object.freeze({
  available: !!M,
  status(){ return { on: !!getKey(), state: sync.state, last: sm.last, error: sync.state === 'error' ? sm.err : null, waiting: Object.keys(sm.dirty).length, everSynced: !!sm.gen }; },
  hasKey(){ return !!getKey(); },
  /* save the key on this device and sync straight away; resolves true when the first sync worked */
  setKey(key){
    const k = String(key || '').trim(); if(!k) return Promise.resolve(false);
    if(k !== getKey()){ LS.set('leaf-sync-key', k); tokenFor = null; sm.err = null; saveMeta(); }
    sync.retry = 0;
    return (sync.running || Promise.resolve()).then(()=>syncNow());
  },
  clearKey(){ LS.set('leaf-sync-key', null); tokenFor = null; clearTimeout(sync.timer); sync.state = 'idle'; sm.err = null; saveMeta(); changed(); },
  syncNow(){ sync.retry = 0; return syncNow(); },
  onChange(fn){ sync.listeners.push(fn); return ()=>{ sync.listeners = sync.listeners.filter(x=>x!==fn); }; },
  push: Object.freeze(pushApi)
});
/* sync when the app opens, when it comes back to the front, when the internet returns, and every few minutes while open */
ready.then(()=>{ kick(1500); }, ()=>{});
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden && (Date.now() - sync.lastTry > 30000 || Object.keys(sm.dirty).length)) kick(800); });
window.addEventListener('online', ()=>{ sync.retry = 0; kick(800); });
setInterval(()=>{ if(!document.hidden && Date.now() - sync.lastTry > 4 * 60000) kick(0); }, 60000);

const caps = { db: dbApi, assets: assetsApi, downloads: downloadsApi };
window.claude = Object.freeze({
  use(name){
    if(!caps[name]) return Promise.resolve(null);
    if(name === 'db') return ready.then(()=>caps.db, ()=>null);
    return Promise.resolve(caps[name]);
  }
});
})();
