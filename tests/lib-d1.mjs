/* A stand-in for Cloudflare D1 built on Node's own SQLite, so the Worker's real SQL runs in tests. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function makeD1(){
  const db = new DatabaseSync(':memory:');
  const dir = fileURLToPath(new URL('../worker/migrations/', import.meta.url));
  readdirSync(dir).filter(f => f.endsWith('.sql')).sort().forEach(f => db.exec(readFileSync(dir + f, 'utf8')));
  const rows = (sql, args) => db.prepare(sql).all(...args);
  const stmt = (sql, args) => ({
    bind:(...a) => stmt(sql, a),
    async first(){ return rows(sql, args)[0] ?? null; },
    async all(){ return {success:true, results:rows(sql, args)}; },
    async run(){ return {success:true, results:rows(sql, args)}; },
    _now(){ return {success:true, results:rows(sql, args)}; }
  });
  return {
    prepare:sql => stmt(sql, []),
    async batch(list){
      db.exec('BEGIN');
      try{ const out = list.map(s => s._now()); db.exec('COMMIT'); return out; }
      catch(e){ db.exec('ROLLBACK'); throw e; }
    },
    raw:db
  };
}
