/* The Leaf Village · Web Push, written against WebCrypto so it runs in a Cloudflare Worker with no libraries.
   - VAPID (RFC 8292): a short-lived ES256 token that tells the push service who is sending.
   - Message encryption (RFC 8291, aes128gcm): only the iPad that subscribed can read the notification. */

const enc = new TextEncoder();
export const b64u = bytes => { let s = ''; const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); for(let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const unb64u = str => { const s = String(str).replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(s + '==='.slice((s.length + 3) % 4)); const a = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; }); return out; };

/* make the key pair once; the private half is kept in the database and never leaves the Worker */
export async function generateVapid(){
  const pair = await crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return {publicKey:b64u(pub), privateJwk:{kty:jwk.kty, crv:jwk.crv, x:jwk.x, y:jwk.y, d:jwk.d}};
}

export async function vapidHeader(vapid, endpoint, subject, nowMs){
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({typ:'JWT', alg:'ES256'})));
  const claims = b64u(enc.encode(JSON.stringify({aud, exp:Math.floor((nowMs || Date.now()) / 1000) + 12 * 3600, sub:subject})));
  const key = await crypto.subtle.importKey('jwk', Object.assign({ext:true}, vapid.privateJwk), {name:'ECDSA', namedCurve:'P-256'}, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({name:'ECDSA', hash:'SHA-256'}, key, enc.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

async function hkdf(salt, ikm, info, len){
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF', hash:'SHA-256', salt, info}, key, len * 8));
}

/* encrypt `plain` (bytes) for one subscription; `test` lets the unit test pin the random parts */
export async function encryptPayload(plain, p256dh, auth, test){
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth);
  const pair = (test && test.pair) || await crypto.subtle.generateKey({name:'ECDH', namedCurve:'P-256'}, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, {name:'ECDH', namedCurve:'P-256'}, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH', public:uaKey}, pair.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = (test && test.salt) || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv:nonce}, key, concat(plain, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);                       // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, body);
}

/* send one notification; returns the push service's HTTP status (201 = accepted, 404/410 = subscription is gone) */
export async function sendPush(sub, payload, vapid, opts){
  const o = opts || {};
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), sub.p256dh, sub.auth);
  const headers = {
    'Authorization': await vapidHeader(vapid, sub.endpoint, o.subject, o.nowMs),
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    'TTL': String(o.ttl || 3 * 3600), 'Urgency': o.urgency || 'high'
  };
  if(o.topic) headers.Topic = o.topic;
  const res = await (o.fetch || fetch)(sub.endpoint, {method:'POST', headers, body});
  return res.status;
}

/* only real push services, so a made-up subscription can't make the Worker call arbitrary addresses */
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];
export function validEndpoint(endpoint, extraHosts){
  try{
    const u = new URL(endpoint);
    if((extraHosts || []).indexOf(u.host) >= 0) return true;
    return u.protocol === 'https:' && PUSH_HOSTS.some(re => re.test(u.hostname));
  }catch(e){ return false; }
}
