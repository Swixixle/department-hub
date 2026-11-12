// Boots the real server in this process against a throwaway database, seeded with the same synthetic fixture the
// permission gate uses. These are implementation tests: real HTTP, real SQLite, no stubs standing in for either.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../../server/index.mjs';
import { seed } from '../../server/seed.mjs';

export async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'department-hub-test-'));
  const dbPath = join(dir, 'hub.sqlite');
  const running = await start({ db: dbPath, port: 0, host: '127.0.0.1', origins: [], build: 'server-test',
    rpId: 'localhost', rpName: 'Department Hub (test)', rpOrigin: 'http://localhost:5173' });
  const fixture = seed({ dbPath, baseUrl: running.url });
  const request = async (session, path, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(new URL(path, running.url), { method, redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { ...session?.headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not every response is JSON */ }
    return { status: response.status, text, json, headers: Object.fromEntries(response.headers) };
  };
  const stop = () => { running.server.close(); running.db.close(); rmSync(dir, { recursive: true, force: true }); };
  const reopen = async () => {
    running.server.close(); running.db.close();
    const again = await start({ db: dbPath, port: 0, host: '127.0.0.1', origins: [], build: 'server-test',
      rpId: 'localhost', rpName: 'Department Hub (test)', rpOrigin: 'http://localhost:5173' });
    return { url: again.url, stop: () => { again.server.close(); again.db.close(); rmSync(dir, { recursive: true, force: true }); } };
  };
  return { fixture, s: fixture.sessions, r: fixture.records, request, stop, reopen, dbPath, url: running.url, settings: running.settings };
}

export const route = (dept, kind, id = '') => '/api/departments/' + encodeURIComponent(dept) + '/' + kind + (id ? '/' + encodeURIComponent(id) : '');
