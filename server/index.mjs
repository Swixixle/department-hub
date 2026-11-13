// The shared department server.
//
// Run it locally:
//   DEPARTMENT_HUB_DB=./local-data/hub.sqlite node server/index.mjs --port 18080
//
// Configuration, all non-secret:
//   DEPARTMENT_HUB_DB        the SQLite file (default ./local-data/hub.sqlite; ':memory:' for a throwaway run)
//   DEPARTMENT_HUB_PORT      the port (default 18080), or --port
//   DEPARTMENT_HUB_HOST      the interface (default 127.0.0.1); it listens on the loopback unless told otherwise
//   DEPARTMENT_HUB_ORIGIN    an allowed browser origin for the app during development, repeatable, comma separated
//   DEPARTMENT_HUB_BUILD     a build label written into receipts
//   DEPARTMENT_HUB_STATIC    a folder holding the built app (dist/); when set, the server also serves the app itself,
//                            so the page and its passkeys share one address, which passkeys require
//
// This is a local development and test service. It is not a deployment, it selects no hosting provider, and a
// passkey registered against localhost proves nothing about a production relying party.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { Refused, handle } from './api.mjs';
import { handlePasskey } from './passkeys.mjs';
import { open } from './db.mjs';
import { resolveSession } from './auth.mjs';

const argv = process.argv.slice(2);
const flag = name => { const at = argv.indexOf('--' + name); return at >= 0 ? argv[at + 1] : null; };

export const config = () => ({
  db: flag('db') || process.env.DEPARTMENT_HUB_DB || './local-data/hub.sqlite',
  port: Number(flag('port') || process.env.DEPARTMENT_HUB_PORT || 18080),
  host: flag('host') || process.env.DEPARTMENT_HUB_HOST || '127.0.0.1',
  origins: String(process.env.DEPARTMENT_HUB_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean),
  build: process.env.DEPARTMENT_HUB_BUILD || 'local-server',
  staticDir: flag('static') || process.env.DEPARTMENT_HUB_STATIC || null,
  rpId: process.env.DEPARTMENT_HUB_RP_ID || 'localhost',
  rpName: process.env.DEPARTMENT_HUB_RP_NAME || 'Department Hub (local)',
  rpOrigin: process.env.DEPARTMENT_HUB_RP_ORIGIN || 'http://localhost:5173'
});

const MAX_BODY = 2 * 1024 * 1024;              // a request that is only words or ids
const MAX_UPLOAD = 25 * 1024 * 1024;           // an attachment, sent as its own bytes rather than inflated into JSON
async function readBody(request) {
  const limit = /^application\/json\b/.test(request.headers['content-type'] || '') ? MAX_BODY : MAX_UPLOAD;
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Refused(413, 'too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return undefined;
  const bytes = Buffer.concat(chunks);
  if (/^application\/json\b/.test(request.headers['content-type'] || '')) {
    try { return JSON.parse(bytes.toString('utf8')); } catch { throw new Refused(400, 'expected JSON'); }
  }
  // Anything else is treated as the bytes it is, for an upload. Nothing inspects what is inside them.
  return { bytes, contentType: String(request.headers['content-type'] || 'application/octet-stream') };
}

// The built app, served from the same address as the API. Files under assets/ carry the build's hash in their names
// and never change; everything else is checked for a newer copy on every load, so an update shows up right away.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.gz': 'application/gzip', '.traineddata': 'application/octet-stream' };
async function serveApp(root, pathname, request, response) {
  const base = resolve(root);
  let file = normalize(join(base, decodeURIComponent(pathname)));
  if (file !== base && !file.startsWith(base + '/')) { response.writeHead(404).end(); return; }
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) { file = join(file, 'index.html'); info = await stat(file).catch(() => null); }
  if (!info) { response.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
  let bytes = await readFile(file);
  // The page says it came from the department server, so the app looks for sign-in here and nowhere else. Opened from
  // serve.py or the public demo the mark is absent and the app makes no request to find a server.
  if (extname(file).toLowerCase() === '.html') bytes = Buffer.from(bytes.toString('utf8').replace('</head>', '<meta name="department-hub-server" content="1"></head>'));
  response.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': String(bytes.length),
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY'
  });
  response.end(request.method === 'HEAD' ? undefined : bytes);
}

export function createApp(db, settings) {
  return async (request, response) => {
    const send = (status, value, { bytes = null, contentType = null, name = null } = {}) => {
      const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
      const origin = request.headers.origin;
      if (origin && settings.origins.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Credentials'] = 'true';
        headers['Vary'] = 'Origin';
      }
      if (bytes) {
        headers['Content-Type'] = contentType || 'application/octet-stream';
        headers['Content-Length'] = String(bytes.length);
        // The stored name is not put in a header: a private thread's attachment name is part of the thread.
        if (name) headers['Content-Disposition'] = 'attachment';
        response.writeHead(status, headers);
        if (request.method === 'HEAD') return response.end();
        return response.end(bytes);
      }
      if (value === null || status === 204) { response.writeHead(status, headers); return response.end(); }
      const text = JSON.stringify(value);
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = String(Buffer.byteLength(text));
      response.writeHead(status, headers);
      if (request.method === 'HEAD') return response.end();
      return response.end(text);
    };

    try {
      const url = new URL(request.url, 'http://' + (request.headers.host || 'localhost'));
      const query = Object.fromEntries(url.searchParams);
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const method = request.method === 'HEAD' ? 'GET' : request.method;

      if (request.method === 'OPTIONS') return send(204, null);
      if (segments[0] !== 'api') {
        if (settings.staticDir && (request.method === 'GET' || request.method === 'HEAD')) return await serveApp(settings.staticDir, url.pathname, request, response);
        throw new Refused(404, 'not found');
      }

      if (segments[1] === 'health' && segments.length === 2) return send(200, { ok: true });

      // Enrollment, authentication and recovery. These run before a session exists, so they authenticate themselves.
      if (segments[1] === 'passkeys' || segments[1] === 'invitations' || segments[1] === 'claims') {
        const body = method === 'GET' ? undefined : await readBody(request);
        const result = await handlePasskey(db, { segments: segments.slice(1), method, query, body, settings,
          session: resolveSession(db, request.headers), headers: request.headers });
        return send(result.status, result.body ?? null);
      }

      const session = resolveSession(db, request.headers);
      if (segments[1] === 'session' && segments.length === 2) {
        if (!session) throw new Refused(401, 'not signed in');
        return send(200, { personId: session.personId, departmentId: session.departmentId, membershipId: session.membershipId, roles: session.roles });
      }

      if (segments[1] !== 'departments' || !segments[2]) throw new Refused(404, 'not found');
      // A caller with no live session, or one belonging to another department, is told the same thing as a caller
      // asking for something that does not exist.
      if (!session) throw new Refused(401, 'not signed in');
      if (segments[2] !== session.departmentId) throw new Refused(404, 'not found');

      const body = method === 'GET' ? undefined : await readBody(request);
      const result = handle(db, { session, departmentId: segments[2], parts: segments.slice(3), method, query, body: body || {}, build: settings.build });
      if (result.bytes) return send(result.status, null, result);
      return send(result.status, result.body ?? null);
    } catch (error) {
      if (error instanceof Refused) return send(error.status, { error: error.message });
      console.error('[server]', error?.stack || error);
      return send(500, { error: 'server error' });
    }
  };
}

export function start(settings = config()) {
  const db = open(settings.db);
  const server = createServer(createApp(db, settings));
  return new Promise(resolve => server.listen(settings.port, settings.host, () => {
    const { port } = server.address();
    resolve({ server, db, settings: { ...settings, port }, url: 'http://' + settings.host + ':' + port });
  }));
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const settings = config();
  const { url } = await start(settings);
  console.log('Department Hub server on ' + url + ' · database ' + settings.db + ' · RP ID ' + settings.rpId + (settings.staticDir ? ' · app from ' + settings.staticDir : ''));
  console.log('This is a local service. It is not a deployment and selects no hosting provider.');
}
