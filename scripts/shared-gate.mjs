// The shared permission gate, start to finish, in one command:
//
//   npm run gate:shared
//
// It starts the real server on an ephemeral port against a database file of its own, seeds a fresh synthetic
// fixture, runs the HTTP permission contract against it, and exits with the contract's own status. Nothing is
// skipped and nothing is turned green: a missing route, a rejected credential or a failed assertion is a failure.
//
// Each run gets its own database because the contract changes the records it tests — it creates and deletes a
// control post, records an acceptance, changes contact sharing, removes a role and revokes a membership. Re-running
// against a used fixture tests the leftovers, so the gate never reuses one.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { start } from '../server/index.mjs';
import { seed } from '../server/seed.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
const flag = name => { const at = argv.indexOf('--' + name); return at >= 0 ? argv[at + 1] : null; };
const keep = argv.includes('--keep');
const stamp = Date.now().toString(36);
const dir = resolve(root, 'local-data');
const dbPath = flag('db') || resolve(dir, 'gate-' + stamp + '.sqlite');
const manifest = flag('out') || resolve(dir, 'gate-' + stamp + '.json');
mkdirSync(dir, { recursive: true });

const sweep = () => { if (keep) return; for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true }); rmSync(manifest, { force: true }); };

let running;
try {
  running = await start({ db: dbPath, port: Number(flag('port') || 0), host: '127.0.0.1', origins: [], build: 'shared-gate',
    rpId: 'localhost', rpName: 'Department Hub (gate)', rpOrigin: 'http://localhost:5173' });
  const fixture = seed({ dbPath, baseUrl: running.url });
  writeFileSync(manifest, JSON.stringify(fixture, null, 2) + '\n');
  console.log('Gate: server ' + running.url + ' · fixture ' + fixture.runId + ' · database ' + dbPath);
  // spawn, not spawnSync: the server runs in this process, so its event loop has to keep turning while the
  // contract makes its requests. A synchronous child would block the very server it is testing.
  const status = await new Promise(done => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', resolve(root, 'tests/shared/permissions.test.mjs')],
      { stdio: 'inherit', env: { ...process.env, DEPARTMENT_HUB_TEST_FIXTURE: manifest, NODE_TEST_CONTEXT: undefined } });
    child.on('error', error => { console.error(error.message); done(2); });
    child.on('exit', code => done(code ?? 2));
  });
  console.log(status === 0
    ? 'PASS: the shared permission contract ran against the real server and a fresh synthetic fixture.'
    : 'FAIL: the shared permission gate has NOT passed (exit ' + status + ').');
  running.server.close(); running.db.close(); sweep();
  process.exit(status);
} catch (error) {
  console.error('FAIL: the shared permission gate could not run. ' + (error?.stack || error));
  try { running?.server.close(); running?.db.close(); } catch { /* already down */ }
  sweep();
  process.exit(2);
}
