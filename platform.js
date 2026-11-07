/* The Leaf Village · phone-only platform layer.
   The app was first built inside Claude, where saving, file storage and downloads came from
   Claude's artifact features. This file provides the same three features on the phone itself:
   - db:        your logs, settings and preferences, kept in this phone's IndexedDB
   - assets:    photos and sounds you add later, kept in IndexedDB as files
   - downloads: the backup file, offered through the share sheet (Save to Files) or a download
   Files that came with the app (your photos, music and sounds from the Claude version) live in
   the media/ folder and are listed in BUNDLED below. To add sync later, replace this file. */
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

const isChild = (key, col) => key.length > col.length + 1 && key.slice(0, col.length + 1) === col + '/' && key.indexOf('/', col.length + 1) === -1;
const docSnap = path => { const v = docs[path]; return { id:path.split('/').pop(), exists: v !== undefined, data: ()=>clone(v), metadata: meta }; };
const colSnap = col => ({ metadata: meta, docs: Object.keys(docs).filter(k=>isChild(k, col)).sort().map(k=>({ id:k.slice(col.length+1), data: ()=>clone(docs[k]) })) });

function notify(path){
  const later = fn => setTimeout(fn, 0);
  (docListeners[path]||[]).forEach(l=>later(()=>l.cb(docSnap(path))));
  const col = path.slice(0, path.lastIndexOf('/'));
  (colListeners[col]||[]).forEach(l=>later(()=>l.cb(colSnap(col))));
}

const dbApi = Object.freeze({
  doc(path){
    return {
      onSnapshot(cb, err){
        const l = {cb, err}; (docListeners[path] = docListeners[path] || []).push(l);
        ready.then(()=>cb(docSnap(path))).catch(e=>err && err(e));
        return ()=>{ docListeners[path] = (docListeners[path]||[]).filter(x=>x!==l); };
      },
      async get(){ await ready; return docSnap(path); },
      async set(data){
        await ready;
        const v = clone(data);
        try{ await tx('docs', 'readwrite', st=>st.put(v, path)); }
        catch(e){ throw { code: (e && e.name === 'QuotaExceededError') ? 'quota_exceeded' : 'unavailable', message: String(e && e.message || e) }; }
        docs[path] = v; notify(path);
      },
      async delete(){ await ready; await tx('docs', 'readwrite', st=>st.delete(path)); delete docs[path]; notify(path); }
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
const MIME = { json:'application/json', csv:'text/csv', txt:'text/plain', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg' };
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

/* used by Import backup: swaps everything saved on this phone for the backup's contents */
window.LeafLocal = Object.freeze({
  async replaceAll(map){
    await ready;
    await openDb().then(d=>new Promise((res, rej)=>{
      const t = d.transaction('docs', 'readwrite'), st = t.objectStore('docs');
      st.clear();
      Object.keys(map).forEach(k=>{ if(map[k] != null) st.put(clone(map[k]), k); });
      t.oncomplete = res; t.onerror = ()=>rej(t.error); t.onabort = ()=>rej(t.error || new Error('aborted'));
    }));
  },
  hasData(){ return ready.then(()=>Object.keys(docs).some(k=>k.indexOf('leaf/main/days/')===0 || k.indexOf('leaf/main/study/')===0)); }
});

const caps = { db: dbApi, assets: assetsApi, downloads: downloadsApi };
window.claude = Object.freeze({
  use(name){
    if(!caps[name]) return Promise.resolve(null);
    if(name === 'db') return ready.then(()=>caps.db, ()=>null);
    return Promise.resolve(caps[name]);
  }
});
})();
