// The app's own sign-in and board code (src/shared.js, src/backend.js) against the real server, with a software
// authenticator standing in for each phone. It signs genuinely and the server's real verification checks it, so a pass
// means the server accepted the app's own requests. It cannot show a real phone, Face ID or a browser's passkey sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../../server/index.mjs';
import { open } from '../../server/db.mjs';
import { bootstrapAdministrator } from '../../server/bootstrap.mjs';
import { sharedClient, joinLink, joinTokenFrom } from '../../src/shared.js';
import { sharedBoard } from '../../src/backend.js';
import { authenticator } from './authenticator.mjs';

const ORIGIN = 'http://localhost:5173';
const memory = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) }; };

async function department() {
  const dir = mkdtempSync(join(tmpdir(), 'department-hub-client-'));
  const dbPath = join(dir, 'hub.sqlite');
  const running = await start({ db: dbPath, port: 0, host: '127.0.0.1', origins: [], build: 'client-test', staticDir: null,
    rpId: 'localhost', rpName: 'Department Hub (test)', rpOrigin: ORIGIN });
  const setup = open(dbPath);
  const first = bootstrapAdministrator(setup, { departmentId: 'unit', departmentName: 'Test Respiratory', name: 'Admin One' });
  setup.close();
  // Each "phone" is its own authenticator and its own storage, as two real phones would be.
  const phone = () => {
    const keys = authenticator({ rpId: 'localhost', origin: ORIGIN });
    const client = sharedClient({ base: running.url, storage: memory(), passkeys: {
      startRegistration: async ({ optionsJSON }) => keys.register(optionsJSON),
      startAuthentication: async ({ optionsJSON }) => keys.authenticate(optionsJSON) } });
    return { keys, client };
  };
  return { running, first, phone, stop: () => { running.server.close(); running.db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('the first administrator joins from the machine-made link, invites a coworker, confirms them by code, and both sign in', async () => {
  const unit = await department();
  try {
    const admin = unit.phone();
    assert.equal(await admin.client.available(), true, 'the server answers its health check');
    const joined = await admin.client.join(unit.first.token);
    assert.equal(joined.activated, true, 'a first-administrator link activates at once');
    const me = await admin.client.signIn();
    assert.equal(me.name, 'Admin One');
    assert.ok(me.roles.includes('admin'));

    const invite = await admin.client.invite('Jordan Test');
    assert.match(invite.link, /#join=/);
    assert.equal(joinTokenFrom(new URL(invite.link, 'http://x').hash), invite.token, 'the link carries the token after the #');

    const jordan = unit.phone();
    const claim = await jordan.client.join(invite.token);
    assert.equal(claim.activated, false, 'an ordinary invitation waits for an administrator');
    assert.match(claim.code, /^[A-Z2-9]{6}$/);
    await assert.rejects(() => jordan.client.signIn(), error => error.status === 401, 'nothing opens before confirmation: the passkey is not a credential yet');
    assert.equal(jordan.client.session, null);
    await assert.rejects(() => jordan.client.join(invite.token), error => error.status === 404, 'the link works once');

    const waiting = await admin.client.waiting();
    assert.deepEqual(waiting.map(entry => [entry.name, entry.registered]), [['Jordan Test', true]]);
    await assert.rejects(() => admin.client.approve(claim.claimId, 'WRONG1', 'in-person'), error => error.status === 403, 'a wrong code is refused');
    await admin.client.approve(claim.claimId, claim.code.toLowerCase(), 'in-person');
    const signedIn = await jordan.client.signIn();
    assert.equal(signedIn.name, 'Jordan Test');
    assert.deepEqual(signedIn.roles, ['member']);
    await assert.rejects(() => jordan.client.invite('Someone'), error => error.status === 403, 'a member cannot invite');
  } finally { unit.stop(); }
});

test('a post from one phone reaches the other with its kind intact, a voice message needs no words, and a removed member is cut off', async () => {
  const unit = await department();
  try {
    const admin = unit.phone();
    await admin.client.join(unit.first.token);
    await admin.client.signIn();
    const invite = await admin.client.invite('Jordan Test');
    const jordan = unit.phone();
    const claim = await jordan.client.join(invite.token);
    await admin.client.approve(claim.claimId, claim.code, 'known-number');
    await jordan.client.signIn();

    const names = new Map((await admin.client.directory()).map(person => [person.personId, person.name]));
    const board = who => sharedBoard({ baseUrl: unit.running.url, departmentId: who.client.session.departmentId, token: who.client.session.token, names: id => names.get(id) || 'Member' });
    const sent = await board(jordan).publish({ id: 'client-1', body: 'Staff meeting Tuesday', learning: true, when: { kind: 'meeting', date: '2026-11-17' }, media: [] });
    assert.equal(sent.author, 'Jordan Test');
    const voice = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' });
    await board(jordan).publish({ id: 'client-2', body: '', voice: true, media: [{ id: 'local-a', name: 'Voice message.webm', seconds: 4.2 }] }, [['local-a', voice]]);

    const seen = await board(admin).list();
    assert.deepEqual(seen.map(post => [post.author, post.body, Boolean(post.learning), post.when?.kind ?? null, Boolean(post.voice)]),
      [['Jordan Test', 'Staff meeting Tuesday', true, 'meeting', false], ['Jordan Test', '', false, null, true]]);
    const recording = seen[1].media[0];
    assert.deepEqual([recording.name, recording.kind, recording.seconds], ['Voice message.webm', 'audio', 4.2]);
    assert.deepEqual([...new Uint8Array(await (await board(admin).file(recording.id)).arrayBuffer())], [1, 2, 3, 4], 'the recording\'s bytes arrive intact');
    const again = await board(jordan).publish({ id: 'client-1', body: 'Staff meeting Tuesday', media: [] });
    assert.equal(again.duplicate, true, 'a retry does not post twice');
    assert.equal((await board(admin).list()).length, 2);

    // Removal: the administrator revokes Jordan's membership, and Jordan's next read gets nothing.
    const jordanEntry = (await admin.client.directory()).find(person => person.name === 'Jordan Test');
    assert.ok(jordanEntry.membershipId, 'an administrator sees the membership id');
    const membersView = await jordan.client.directory();
    assert.equal(membersView.some(person => 'membershipId' in person), false, 'a member does not');
    const removed = await fetch(unit.running.url + '/api/departments/unit/memberships/' + jordanEntry.membershipId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + admin.client.session.token } });
    assert.equal(removed.status, 204);
    const cut = board(jordan);
    assert.deepEqual(await cut.list(), []);
    assert.equal(cut.state, 'failed');
    assert.equal(await jordan.client.refresh(), null, 'the phone forgets a session the server no longer honours');
    assert.equal(jordan.client.session, null);
  } finally { unit.stop(); }
});

test('the server serves the built app from the same address, checking for a newer page each load and keeping hashed files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'department-hub-static-'));
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(dir, 'app', 'assets'), { recursive: true });
  writeFileSync(join(dir, 'app', 'index.html'), '<title>Department Hub</title>');
  writeFileSync(join(dir, 'app', 'assets', 'index-abc.js'), 'console.log(1)');
  const running = await start({ db: ':memory:', port: 0, host: '127.0.0.1', origins: [], build: 't', staticDir: join(dir, 'app'), rpId: 'localhost', rpName: 't', rpOrigin: ORIGIN });
  try {
    const page = await fetch(running.url + '/');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    const html = await page.text();
    assert.match(html, /Department Hub/);
    writeFileSync(join(dir, 'app', 'plain.html'), '<html><head></head></html>');
    assert.match(await (await fetch(running.url + '/plain.html')).text(), /<meta name="department-hub-server" content="1"><\/head>/, 'served pages carry the mark the app looks for');
    const script = await fetch(running.url + '/assets/index-abc.js');
    assert.equal(script.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await fetch(running.url + '/../../etc/passwd')).status, 404, 'nothing outside the app folder');
    assert.equal((await fetch(running.url + '/api/health')).status, 200, 'the API still answers beside it');
    assert.equal(joinLink('a b', 'https://hub.example'), 'https://hub.example/#join=a%20b');
  } finally { running.server.close(); running.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('reactions are safe to repeat and show counts, never names; captions only on a contest, removable only by their author', async () => {
  const unit = await department();
  try {
    const admin = unit.phone();
    await admin.client.join(unit.first.token);
    await admin.client.signIn();
    const invite = await admin.client.invite('Jordan Test');
    const jordan = unit.phone();
    const claim = await jordan.client.join(invite.token);
    await admin.client.approve(claim.claimId, claim.code, 'in-person');
    await jordan.client.signIn();
    const board = who => sharedBoard({ baseUrl: unit.running.url, departmentId: who.client.session.departmentId, token: who.client.session.token });
    const plain = await board(jordan).publish({ id: 'fun-1', body: 'tanks again', media: [] });
    const picture = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    const contest = await board(jordan).publish({ id: 'fun-2', body: 'Caption this', contest: true, media: [{ id: 'l', name: 'meme.png' }] }, [['l', picture]]);
    assert.equal(contest.contest, true);

    await board(admin).react(plain.id, 'laugh', null, true);
    await board(admin).react(plain.id, 'laugh', null, true);          // a repeat on a bad signal changes nothing
    let seen = (await board(jordan).list()).find(post => post.id === plain.id);
    assert.deepEqual(seen.reactions.laugh, { count: 1, mine: false }, 'a count and whether it is mine, not who');
    assert.equal(JSON.stringify(seen.reactions).includes('Admin'), false);
    await board(admin).react(plain.id, 'laugh', null, false);
    seen = (await board(jordan).list()).find(post => post.id === plain.id);
    assert.equal(seen.reactions.laugh.count, 0);
    await assert.rejects(() => board(admin).react(plain.id, 'angry', null, true), error => error.status === 404, 'only the two kinds exist');

    await assert.rejects(() => board(admin).caption(plain.id, 'not a contest'), error => error.status === 400);
    await board(admin).caption(contest.id, 'me finding the last full tank');
    const withCaption = (await board(jordan).list()).find(post => post.id === contest.id);
    assert.deepEqual(withCaption.captions.map(caption => caption.text), ['me finding the last full tank']);
    const captionId = withCaption.captions[0].id;
    await board(jordan).laughCaption(contest.id, captionId, null, true);
    assert.deepEqual((await board(admin).list()).find(post => post.id === contest.id).captions[0].reactions.laugh, { count: 1, mine: false });
    await assert.rejects(() => board(jordan).uncaption(contest.id, captionId), error => error.status === 403, 'only the caption\'s author removes it');
    await board(admin).uncaption(contest.id, captionId);
    assert.deepEqual((await board(jordan).list()).find(post => post.id === contest.id).captions, []);
  } finally { unit.stop(); }
});
