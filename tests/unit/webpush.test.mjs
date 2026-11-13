/* Web Push: a message encrypted by the Worker's code can be read by a subscriber, and the VAPID token verifies.
   The subscriber side is written with Node's own crypto (a separate implementation of RFC 8291). */
import test from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import { generateVapid, vapidHeader, encryptPayload, sendPush, b64u, unb64u, validEndpoint } from '../../worker/src/webpush.js';

function subscriber(){
  const ecdh = nodeCrypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  return {ecdh, auth, p256dh:b64u(ecdh.getPublicKey()), authB64:b64u(auth)};
}
const hkdf = (salt, ikm, info, len) => Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, info, len));
function decrypt(sub, body){
  const buf = Buffer.from(body), salt = buf.subarray(0, 16), rs = buf.readUInt32BE(16), idlen = buf[20];
  const asPublic = buf.subarray(21, 21 + idlen), cipher = buf.subarray(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const secret = sub.ecdh.computeSecret(asPublic);
  const ikm = hkdf(sub.auth, secret, Buffer.concat([Buffer.from('WebPush: info\0'), sub.ecdh.getPublicKey(), asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = nodeCrypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'last-record marker');
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

test('an encrypted notification can be read by the device it was meant for, and by no one else', async () => {
  const sub = subscriber(), other = subscriber();
  const text = JSON.stringify({title:'Morning briefing', body:'Kakashi: 5 × 6 pull-ups. Strict reps.\nThird Hokage: 4h at least.'});
  const body = await encryptPayload(new TextEncoder().encode(text), sub.p256dh, sub.authB64);
  assert.equal(decrypt(sub, body), text);
  assert.throws(() => decrypt(other, body));
});

test('the VAPID token is a valid ES256 signature over the right audience', async () => {
  const vapid = await generateVapid();
  assert.equal(unb64u(vapid.publicKey).length, 65);
  const header = await vapidHeader(vapid, 'https://web.push.apple.com/abc123', 'https://example.github.io/app/', Date.parse('2026-11-13T02:40:00Z'));
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header); assert.ok(m);
  assert.equal(m[2], vapid.publicKey);
  const [h, c, s] = m[1].split('.');
  assert.deepEqual(JSON.parse(Buffer.from(unb64u(h))), {typ:'JWT', alg:'ES256'});
  const claims = JSON.parse(Buffer.from(unb64u(c)));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'https://example.github.io/app/');
  assert.ok(claims.exp - Date.parse('2026-11-13T02:40:00Z') / 1000 <= 24 * 3600, 'expires within a day, as Apple requires');
  const key = await crypto.subtle.importKey('raw', unb64u(vapid.publicKey), {name:'ECDSA', namedCurve:'P-256'}, false, ['verify']);
  assert.ok(await crypto.subtle.verify({name:'ECDSA', hash:'SHA-256'}, key, unb64u(s), new TextEncoder().encode(`${h}.${c}`)));
});

test('sendPush posts an encrypted body with the headers push services expect', async () => {
  const sub = subscriber(), vapid = await generateVapid(); let seen = null;
  const status = await sendPush({endpoint:'https://web.push.apple.com/xyz', p256dh:sub.p256dh, auth:sub.authB64}, {notification:{title:'t', body:'b'}}, vapid,
    {subject:'https://example.github.io/app/', ttl:600, fetch:async (url, init) => { seen = {url, init}; return {status:201}; }});
  assert.equal(status, 201);
  assert.equal(seen.url, 'https://web.push.apple.com/xyz');
  assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(seen.init.headers.TTL, '600');
  assert.match(seen.init.headers.Authorization, /^vapid t=/);
  assert.deepEqual(JSON.parse(decrypt(sub, seen.init.body)), {notification:{title:'t', body:'b'}});
});

test('only real push services are accepted as subscription addresses', () => {
  assert.ok(validEndpoint('https://web.push.apple.com/QGz...'));
  assert.ok(validEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'));
  assert.ok(!validEndpoint('https://evil.example.com/hook'));
  assert.ok(!validEndpoint('http://web.push.apple.com/x'));
  assert.ok(!validEndpoint('not a url'));
  assert.ok(validEndpoint('http://127.0.0.1:9999/push', ['127.0.0.1:9999']));
});
