/* a short run of the random-data parity check (the long run: npm run test:fuzz) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
test('fuzz: 40 random villages agree between the app and the server, also after a checkpoint', () => {
  const out = execFileSync(process.execPath, [new URL('../fuzz/parity.mjs', import.meta.url).pathname, '40', '3'], {encoding:'utf8'});
  assert.match(out, /40 runs checked, 0 with problems/);
});
