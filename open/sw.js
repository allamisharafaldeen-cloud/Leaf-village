/* The Leaf Village · offline support and notifications.
   Keeps a copy of the app, your photos and your music on the phone so it opens without internet.
   The app page itself is always checked online first, so updates show up the next time you open it.
   It also shows the senseis' reminders when the sync Worker pushes one (see the end of this file).
   Bump VERSION whenever files change. */
const VERSION = '10d5f6f65b';
const CACHE = 'leafopen-' + VERSION;
const CINE_CACHE = 'leafopen-cine';  /* rank-up scenes: kept across versions, filled ahead of each promotion */
const FONT_CACHE = 'leafopen-fonts';
const FILES = [
"./",
"index.html",
"platform.js",
"leaf-merge.js",
"leaf-engine.js",
"manifest.webmanifest",
"ranks/academy-cut-v2.webp",
"ranks/academy-cut.webp",
"ranks/academy-face.jpg",
"ranks/academy.jpg",
"ranks/anbu-face.jpg",
"ranks/anbu.jpg",
"ranks/chunin-cut.webp",
"ranks/chunin-face.jpg",
"ranks/chunin.jpg",
"ranks/genin-cut.webp",
"ranks/genin-face.jpg",
"ranks/genin.jpg",
"ranks/hokage-face.jpg",
"ranks/hokage.jpg",
"ranks/jonin-cut.webp",
"ranks/jonin-face.jpg",
"ranks/jonin.jpg",
"ranks/kage-face.jpg",
"ranks/kage.jpg",
"ranks/sage-face.jpg",
"ranks/sage.jpg",
"ranks/sannin-face.jpg",
"ranks/sannin.jpg",
"ranks/six-paths-cut-v2.webp",
"ranks/six-paths-cut.webp",
"ranks/six-paths-face.jpg",
"ranks/six-paths.jpg",
"ranks/special-jonin-cut.webp",
"ranks/special-jonin-face.jpg",
"ranks/special-jonin.jpg",
"ranks/tailed-beast-face.jpg",
"ranks/tailed-beast.jpg",
"icons/icon-180.png",
"icons/icon-192.png",
"icons/icon-512.png",
"ranks/akatsuki-face.jpg",
"ranks/akatsuki.jpg",
"ranks/byakugan-cut.webp",
"ranks/byakugan-face.jpg",
"ranks/byakugan.jpg",
"ranks/comeback-face.jpg",
"ranks/comeback.jpg",
"ranks/genin-cut-v2.webp",
"ranks/susanoo-face.jpg",
"ranks/susanoo.jpg",
"media/comeback.jpg",
"media/wp-akatsuki.jpg",
"media/wp-funeral.jpg",
"media/wp-ichiraku.jpg",
"media/wp-myoboku.jpg",
"media/wp-pain.jpg",
"media/wp-uchiha.jpg",
"media/wp-valley.jpg",
"ranks/eight-gates-face.jpg",
"ranks/eight-gates.jpg",
"media/wp-iron.jpg",
"media/wp-konoha-classic.jpg",
"media/wp-konoha-dusk.jpg",
"media/wp-konoha-monument.jpg",
"media/wp-konoha-naruto.jpg",
"media/wp-konoha-roof.jpg",
"media/wp-konoha-street.jpg",
"media/wp-myoboku2.jpg",
"media/wp-rain.jpg",
"media/wp-rock.jpg",
"media/wp-sand.jpg",
"media/wp-sealed-shrine.jpg",
"media/wp-uchiha-ruins.jpg",
"media/wp-valley-tall.jpg",
"media/wp-genin-1.jpg",
"media/wp-genin-2.jpg",
"media/wp-genin-3.jpg",
"media/wp-genin-4.jpg",
"media/wp-genin-5.jpg",
"ranks/genin-cut-v3.webp",
"ranks/chunin-aura.webp",
"ranks/genin-aura.webp",
"ranks/jonin-aura.webp",
"ranks/special-jonin-aura.webp",
"ranks/chunin-cut-v3.webp",
"ranks/jonin-cut-v3.webp",
"ranks/special-jonin-cut-v3.webp",
"ranks/anbu-cut-v2.webp",
"ranks/anbu-aura.webp",
"ranks/akatsuki-cut-v2.webp",
"ranks/akatsuki-aura.webp",
"ranks/sannin-cut-v2.webp",
"ranks/sannin-aura.webp",
"ranks/tailed-beast-cut-v2.webp",
"ranks/tailed-beast-aura.webp",
"ranks/eight-gates-cut-v2.webp",
"ranks/eight-gates-aura.webp",
"ranks/kage-cut-v2.webp",
"ranks/kage-aura.webp",
"ranks/hokage-cut-v2.webp",
"ranks/hokage-aura.webp",
"ranks/sage-cut-v2.webp",
"ranks/sage-aura.webp",
"ranks/susanoo-cut-v2.webp",
"ranks/susanoo-aura.webp",
"media/wp-chunin-1.jpg",
"media/wp-chunin-2.jpg",
"media/wp-chunin-3.jpg",
"media/wp-chunin-4.jpg",
"media/wp-chunin-5.jpg",
"senseis/kakashi-1.webp",
"senseis/kakashi-2.webp",
"senseis/kakashi-face.jpg",
"senseis/guy-1.webp",
"senseis/guy-2.webp",
"senseis/guy-face.jpg",
"senseis/jiraiya-1.webp",
"senseis/jiraiya-2.webp",
"senseis/jiraiya-face.jpg",
"senseis/hiruzen-1.webp",
"senseis/hiruzen-2.webp",
"senseis/hiruzen-face.jpg",
"senseis/tsunade-1.webp"
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(f=>new Request(f, {cache:'reload'})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('leafopen-') && k!==CACHE && k!==FONT_CACHE && k!==CINE_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

/* Safari asks for music in pieces (Range requests); answer those from the stored copy */
async function rangeResponse(req, res){
  const buf = await res.arrayBuffer(), size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  let start = m && m[1] ? +m[1] : 0, end = m && m[2] ? +m[2] : size - 1;
  if(m && !m[1] && m[2]){ start = Math.max(0, size - +m[2]); end = size - 1; }
  end = Math.min(end, size - 1);
  if(start >= size || start > end) return new Response(null, {status:416, headers:{'Content-Range':`bytes */${size}`}});
  return new Response(buf.slice(start, end + 1), {status:206, headers:{
    'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
    'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges':'bytes'
  }});
}

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    e.respondWith(caches.open(FONT_CACHE).then(async c=>{
      const hit = await c.match(req);
      const net = fetch(req).then(r=>{ if(r && (r.ok || r.type==='opaque')) c.put(req, r.clone()); return r; }).catch(()=>hit);
      return hit || net;
    }));
    return;
  }
  if(url.origin !== self.location.origin) return;

  /* the page and its three scripts always come from the same version: online, take them fresh (offline, the saved copy) */
  if(/\/(platform|leaf-merge|leaf-engine)\.js$/.test(url.pathname)){
    const clean = url.origin + url.pathname;
    e.respondWith(fetch(clean, {cache:'no-cache'}).then(r=>{ if(r.ok){ const cp=r.clone(); caches.open(CACHE).then(c=>c.put(clean, cp)); } return r; })
      .catch(()=>caches.open(CACHE).then(c=>c.match(clean)).then(hit=>hit || new Response('', {status:504}))));
    return;
  }
  if(req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')){
    e.respondWith(fetch(req).then(r=>{ if(r.ok){ const cp=r.clone(); caches.open(CACHE).then(c=>c.put('index.html', cp)); } return r; })
      .catch(()=>caches.match('index.html')));
    return;
  }

  e.respondWith((async ()=>{
    const c = await caches.open(/\/media\/cine-[^/]+$/.test(url.pathname) ? CINE_CACHE : CACHE);
    const clean = url.origin + url.pathname;
    let hit = await c.match(clean);
    if(!hit){
      try{
        const r = await fetch(clean);
        if(r.ok){ await c.put(clean, r.clone()); hit = r; }
        else return r;
      }catch(err){ return new Response('', {status:504}); }
    }
    if(req.headers.has('range')) return rangeResponse(req, hit.clone());
    return hit;
  })());
});

/* ---------- reminders ----------
   The sync Worker sends {web_push:8030, notification:{title, body, navigate, tag}}. Newer iPadOS shows that by
   itself; everywhere else this handler shows it. Every push must show a notification, or the system stops them. */
self.addEventListener('push', e=>{
  let d = {};
  try{ d = e.data ? e.data.json() : {}; }catch(err){ try{ d = {notification:{body:e.data.text()}}; }catch(e2){} }
  const n = (d && d.notification) || d || {};
  e.waitUntil(self.registration.showNotification(n.title || 'The Leaf Village', {
    body: n.body || 'Your senseis are waiting.', tag: n.tag || 'leaf', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    data: {url: n.navigate || './'}
  }));
});
/* tapping a reminder opens the village (or brings it to the front if it is already open) */
self.addEventListener('notificationclick', e=>{
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(list=>{
    const open = list.find(c=>c.url.indexOf(self.registration.scope) === 0);
    if(open && open.focus) return open.focus();
    return self.clients.openWindow(target);
  }));
});
