/* Runs the real Worker code in Node for tests: same fetch handler, same SQL, an in-memory database.
   startWorker() also serves it over HTTP so a browser (Playwright) can sync against it. */
import http from 'node:http';
import worker, { keyToken, runSlot } from '../worker/src/index.js';
import { makeD1 } from './lib-d1.mjs';

export { keyToken, runSlot };
export function makeEnv(over){ return Object.assign({DB:makeD1(), LEAF_SYNC_KEY:'test-key-for-the-village', ALLOWED_ORIGIN:'https://allamisharafaldeen-cloud.github.io', APP_URL:'https://allamisharafaldeen-cloud.github.io/Leaf-village/'}, over || {}); }
/* call the Worker directly, like a device would */
export async function call(env, method, path, body, opts){
  const o = opts || {}, headers = Object.assign({}, o.headers || {});
  if(o.key !== null) headers.Authorization = 'Bearer ' + await keyToken(o.key || env.LEAF_SYNC_KEY);
  if(body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request('https://worker.test' + path, {method, headers, body:body === undefined ? undefined : JSON.stringify(body)}), env);
  let json = null; const text = await res.text(); try{ json = JSON.parse(text); }catch(e){}
  return {status:res.status, json, headers:res.headers};
}
export async function startWorker(env, port){
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const init = {method:req.method, headers:req.headers};
    if(req.method !== 'GET' && req.method !== 'HEAD') init.body = Buffer.concat(chunks);
    try{
      if(server.offline){ req.socket.destroy(); return; }
      server.requests.push({method:req.method, path:req.url});
      const out = await worker.fetch(new Request(`http://127.0.0.1:${port}${req.url}`, init), env);
      const headers = {}; out.headers.forEach((v, k) => { headers[k] = v; });
      res.writeHead(out.status, headers); res.end(Buffer.from(await out.arrayBuffer()));
    }catch(e){ res.writeHead(500); res.end(String(e && e.message)); }
  });
  server.requests = []; server.offline = false;
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return server;
}
