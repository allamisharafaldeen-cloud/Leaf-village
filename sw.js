/* The Leaf Village · offline support.
   Keeps a copy of the app, your photos and your music on the phone so it opens without internet.
   The app page itself is always checked online first, so updates show up the next time you open it.
   Bump VERSION whenever files change. */
const VERSION = 'e30e35b272';
const CACHE = 'leaf-' + VERSION;
const FONT_CACHE = 'leaf-fonts';
const FILES = [
 "./",
 "index.html",
 "platform.js",
 "manifest.webmanifest",
 "media/04baf85978a90d901be411fd8aabf43e.jpg",
 "media/0cf141c4617406724f4fc4d2148c5a4b.jpg",
 "media/106315c3656e4822e889983fd281af4f.jpg",
 "media/1cf51ee0bdafbad96d967453c6e449db.mp4",
 "media/236748730ea6df4f87634613c0a186fb.mp4",
 "media/5e47551e43ecb539f92386566fd875dc.mp4",
 "media/61086f82549a63c7b6d2767a929e318b.jpg",
 "media/63c736ee956cf8a8da6048a07a464365.mp4",
 "media/6b1b25ac0ecf14f8469fa1edbefe782e.jpg",
 "media/7e50605ef8db59e51500cdbd09e4bad1.jpg",
 "media/7e675d801254c215cf318e4f1a7f659a.mp4",
 "media/80d85646aab54c9d54290196def1811f.mp4",
 "media/95dfb73fc94beca212496f6c476d51f2.jpg",
 "media/9d8ad0fc80a43ead43677fac144839ba.mp4",
 "media/9f018bf25b7328a533dad4843d0836a0.jpg",
 "media/b04a0e695aca0f3f48c232eed209448e.jpg",
 "media/c279c8d56915fbd9ff1076c1508e448c.jpg",
 "media/e72ce34a5db7454f91710c3f1731f89b.mp4",
 "media/fb4f2ca55fffb735fc8fab1a38b273b1.mp4",
 "ranks/academy-cut-v2.webp",
 "ranks/academy-cut.webp",
 "ranks/academy-face.jpg",
 "ranks/academy.jpg",
 "ranks/anbu-cut.webp",
 "ranks/anbu-face.jpg",
 "ranks/anbu.jpg",
 "ranks/chunin-cut.webp",
 "ranks/chunin-face.jpg",
 "ranks/chunin.jpg",
 "ranks/genin-cut.webp",
 "ranks/genin-face.jpg",
 "ranks/genin.jpg",
 "ranks/hokage-cut.webp",
 "ranks/hokage-face.jpg",
 "ranks/hokage.jpg",
 "ranks/jonin-cut.webp",
 "ranks/jonin-face.jpg",
 "ranks/jonin.jpg",
 "ranks/kage-cut.webp",
 "ranks/kage-face.jpg",
 "ranks/kage.jpg",
 "ranks/sage-cut.webp",
 "ranks/sage-face.jpg",
 "ranks/sage.jpg",
 "ranks/sannin-cut.webp",
 "ranks/sannin-face.jpg",
 "ranks/sannin.jpg",
 "ranks/six-paths-cut-v2.webp",
 "ranks/six-paths-cut.webp",
 "ranks/six-paths-face.jpg",
 "ranks/six-paths.jpg",
 "ranks/special-jonin-cut.webp",
 "ranks/special-jonin-face.jpg",
 "ranks/special-jonin.jpg",
 "ranks/tailed-beast-cut.webp",
 "ranks/tailed-beast-face.jpg",
 "ranks/tailed-beast.jpg",
 "icons/icon-180.png",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "ranks/akatsuki-cut.webp",
 "ranks/akatsuki-face.jpg",
 "ranks/akatsuki.jpg",
 "ranks/byakugan-cut.webp",
 "ranks/byakugan-face.jpg",
 "ranks/byakugan.jpg",
 "ranks/comeback-face.jpg",
 "ranks/comeback.jpg",
 "ranks/genin-cut-v2.webp",
 "ranks/susanoo-cut.webp",
 "ranks/susanoo-face.jpg",
 "ranks/susanoo.jpg",
 "media/comeback.jpg",
 "media/wp-akatsuki.jpg",
 "media/wp-arena.jpg",
 "media/wp-byakugan.jpg",
 "media/wp-funeral.jpg",
 "media/wp-ichiraku.jpg",
 "media/wp-myoboku.jpg",
 "media/wp-pain.jpg",
 "media/wp-uchiha.jpg",
 "media/wp-valley.jpg",
 "ranks/eight-gates-cut.webp",
 "ranks/eight-gates-face.jpg",
 "ranks/eight-gates.jpg",
 "media/wp-forest-death.jpg",
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
 "ranks/chunin-cut-v2.webp",
 "ranks/special-jonin-cut-v2.webp",
 "ranks/chunin-aura.webp",
 "ranks/genin-aura.webp",
 "ranks/jonin-aura.webp",
 "ranks/jonin-cut-v2.webp",
 "ranks/special-jonin-aura.webp"
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(f=>new Request(f, {cache:'reload'})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('leaf-') && k!==CACHE && k!==FONT_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
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

  if(req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')){
    e.respondWith(fetch(req).then(r=>{ if(r.ok){ const cp=r.clone(); caches.open(CACHE).then(c=>c.put('index.html', cp)); } return r; })
      .catch(()=>caches.match('index.html')));
    return;
  }

  e.respondWith((async ()=>{
    const c = await caches.open(CACHE);
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
