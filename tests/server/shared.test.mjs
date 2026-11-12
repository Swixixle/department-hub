// The shared experience, exercised through the same adapter the app would use (src/backend.js sharedBoard) against
// the real server, with two members who each signed in with their own passkey.
//
// This is the two-session sync exercise the brief asks for, and it is not the two-phone exercise. There are no
// phones here, no browser, and both sessions run in one process; what it shows is that two independently
// authenticated members share one department's records through the real HTTP boundary, and that a third person does
// not. A real pilot still needs two people holding two devices.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, route } from './harness.mjs';
import { authenticator } from './authenticator.mjs';
import { bootstrapAdministrator } from '../../server/bootstrap.mjs';
import { open } from '../../server/db.mjs';
import { sharedBoard } from '../../src/backend.js';

let h, dept, admin;
const member = {}, mate = {};

const signIn = async (phone, credentialId) => {
  const options = await h.request(null, '/api/passkeys/authentication/options', { method: 'POST', body: {} });
  return h.request(null, '/api/passkeys/authentication',
    { method: 'POST', body: { challengeId: options.json.challengeId, response: phone.authenticate(options.json.authentication, { credentialId }) } });
};
const asSession = result => ({ headers: { Authorization: 'Bearer ' + result.json.token } });
const freshCheck = async (session, phone, credentialId) => {
  const options = await h.request(session, '/api/passkeys/verification/options', { method: 'POST', body: {} });
  const done = await h.request(session, '/api/passkeys/verification',
    { method: 'POST', body: { challengeId: options.json.challengeId, response: phone.authenticate(options.json.authentication, { credentialId }) } });
  assert.equal(done.status, 200);
  return done.json.verification;
};

// Invite somebody, have them register a passkey, have the administrator confirm it, and sign them in.
async function enrol(name, credentialId) {
  const invited = await h.request(admin.session, '/api/invitations',
    { method: 'POST', body: { purpose: 'enrollment', name, verification: await freshCheck(admin.session, admin.phone, admin.credentialId) } });
  assert.equal(invited.status, 201);
  const phone = authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin });
  const claim = await h.request(null, '/api/claims', { method: 'POST', body: { token: invited.json.token } });
  await h.request(null, '/api/claims/' + claim.json.claimId + '/register',
    { method: 'POST', body: { response: phone.register(claim.json.registration, { credentialId }) } });
  const approved = await h.request(admin.session, '/api/claims/' + claim.json.claimId + '/approve',
    { method: 'POST', body: { code: claim.json.code, method: 'known-number', verification: await freshCheck(admin.session, admin.phone, admin.credentialId) } });
  assert.equal(approved.status, 200);
  const signedIn = await signIn(phone, credentialId);
  assert.equal(signedIn.status, 200);
  return { personId: invited.json.personId, phone, credentialId, token: signedIn.json.token, session: asSession(signedIn) };
}

before(async () => {
  h = await boot();
  dept = 'test-shared-dept';
  const db = open(h.dbPath);
  const made = bootstrapAdministrator(db, { departmentId: dept, departmentName: 'Shared (synthetic)', name: 'Keeper' });
  db.close();
  admin = { personId: made.personId, phone: authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin }), credentialId: 'keeper-phone' };
  const claim = await h.request(null, '/api/claims', { method: 'POST', body: { token: made.token } });
  await h.request(null, '/api/claims/' + claim.json.claimId + '/register',
    { method: 'POST', body: { response: admin.phone.register(claim.json.registration, { credentialId: admin.credentialId }) } });
  const signedIn = await signIn(admin.phone, admin.credentialId);
  admin.session = asSession(signedIn);
  admin.token = signedIn.json.token;
  Object.assign(member, await enrol('Sawyer', 'sawyer-phone'));
  Object.assign(mate, await enrol('Linden', 'linden-phone'));
});
after(() => h?.stop());

const boardFor = (who, overrides = {}) => sharedBoard({ baseUrl: h.url, departmentId: dept, token: who.token, ...overrides });

describe('two signed-in members, one department board', { concurrency: false }, () => {
  test('one member publishes and the other receives it', async () => {
    const mine = boardFor(member), theirs = boardFor(mate);
    assert.equal(mine.shared, true);
    assert.equal(mine.where, 'the department server');
    assert.deepEqual(await theirs.list(), []);
    const published = await mine.publish({ id: 'client-post-1', body: 'Filters arrived, they are in the supply room.' });
    assert.ok(published.id);
    assert.equal(published.author, member.personId, 'the author is the session, not anything the phone said');
    const received = await theirs.list();
    assert.equal(received.length, 1);
    assert.equal(received[0].body, 'Filters arrived, they are in the supply room.');
    assert.equal(received[0].author, member.personId);
    assert.equal(theirs.state, 'ready');
  });

  test('a member of another department cannot retrieve it, by the board or by asking', async () => {
    const other = h.s.foreign;
    assert.equal((await h.request(other, route(dept, 'posts'))).status, 404);
    assert.equal((await h.request(other, route(other.departmentId, 'posts'))).status, 200);
    const search = await h.request(other, route(other.departmentId, 'search') + '?q=' + encodeURIComponent('supply room'));
    assert.equal(search.status, 200);
    assert.equal(search.text.includes('Filters arrived'), false);
    const asked = await h.request(other, route(other.departmentId, 'ask'), { method: 'POST', body: { question: 'What is new on the board?' } });
    assert.equal(asked.status, 200);
    assert.equal(asked.text.includes('Filters arrived'), false);
    // And the same board read with no session at all.
    assert.equal((await h.request(null, route(dept, 'posts'))).status, 401);
  });

  test('a revoked member stops receiving it on the next read', async () => {
    const membershipId = (await h.request(mate.session, '/api/session')).json.membershipId;
    const theirs = boardFor(mate);
    assert.equal((await theirs.list()).length, 1);
    assert.ok([200, 204].includes((await h.request(admin.session, route(dept, 'memberships', membershipId), { method: 'DELETE' })).status));
    const after = await theirs.list();
    assert.equal(theirs.state, 'failed', 'there is nothing to show, and it says so rather than showing the old copy as current');
    assert.deepEqual(after, []);
  });
});

describe('what the screen can honestly say', { concurrency: false }, () => {
  test('a read that fails keeps the last posts but marks them stale', async () => {
    const seen = [];
    const flaky = boardFor(member, { onState: report => seen.push(report.state) });
    assert.equal((await flaky.list()).length, 1);
    assert.equal(flaky.state, 'ready');
    const offline = boardFor(member, { fetch: async () => { throw new Error('no connection'); } });
    assert.deepEqual(await offline.list(), [], 'with nothing read yet there is nothing to keep');
    assert.equal(offline.state, 'failed');
    // A board that had read something keeps it, and says it is old.
    let working = true;
    const intermittent = boardFor(member, { fetch: async (...args) => { if (!working) throw new Error('no connection'); return globalThis.fetch(...args); } });
    assert.equal((await intermittent.list()).length, 1);
    working = false;
    const kept = await intermittent.list();
    assert.equal(kept.length, 1, 'the posts already on screen stay on screen');
    assert.equal(intermittent.state, 'stale');
    assert.match(intermittent.lastError, /no connection/);
    assert.ok(seen.includes('ready'));
  });

  test('a publish that fails says unsent, and puts nothing on the board', async () => {
    const before = (await boardFor(member).list()).length;
    const broken = boardFor(member, { fetch: async () => { throw new Error('dropped'); } });
    await assert.rejects(() => broken.publish({ id: 'client-post-never', body: 'this never arrived' }), /dropped/);
    assert.equal(broken.state, 'unsent');
    const after = await boardFor(member).list();
    assert.equal(after.length, before);
    assert.equal(JSON.stringify(after).includes('this never arrived'), false);
  });

  test('a retry of a post that already arrived does not post it twice', async () => {
    const board = boardFor(member);
    const first = await board.publish({ id: 'client-post-retry', body: 'Staff meeting moved to Thursday.' });
    const again = await board.publish({ id: 'client-post-retry', body: 'Staff meeting moved to Thursday.' });
    assert.equal(again.id, first.id);
    assert.equal(again.duplicate, true);
    const posts = await board.list();
    assert.equal(posts.filter(post => post.body === 'Staff meeting moved to Thursday.').length, 1);
  });

  test('clearing this device does not empty the department', async () => {
    const board = boardFor(member);
    const before = (await board.list()).length;
    assert.ok(before > 0);
    await board.clear();
    assert.equal((await boardFor(admin).list()).length, before);
  });
});

describe('attachments go through the authorized path', { concurrency: false }, () => {
  let posted;
  test('bytes uploaded with a post come back to a coworker', async () => {
    const board = boardFor(member);
    const bytes = Buffer.from('a synthetic photo of a flowmeter, as bytes');
    posted = await board.publish({ id: 'client-post-with-file', body: 'Here is the new flowmeter.' },
      [['flowmeter.txt', new Blob([bytes], { type: 'text/plain' })]]);
    assert.equal(posted.media.length, 1);
    const coworker = boardFor(admin);
    const seen = (await coworker.list()).find(post => post.id === posted.id);
    assert.equal(seen.media.length, 1);
    const blob = await coworker.file(seen.media[0].id);
    assert.ok(blob, 'the coworker can download it');
    assert.equal(Buffer.from(await blob.arrayBuffer()).toString('utf8'), bytes.toString('utf8'));
  });

  test('somebody outside the department gets nothing, by any request shape', async () => {
    const mediaId = posted.media[0].id;
    for (const options of [{}, { method: 'HEAD' }, { headers: { Range: 'bytes=0-8' } }, { headers: { 'If-None-Match': '*' } }]) {
      const tried = await h.request(h.s.foreign, route(dept, 'files', mediaId), options);
      assert.ok([401, 403, 404].includes(tried.status), 'got ' + tried.status);
      assert.equal(tried.text.includes('flowmeter'), false);
    }
    assert.equal((await boardFor(mate).file(mediaId)), null, 'and not the member whose membership was revoked');
  });

  test('an attachment cannot be attached to somebody else’s post', async () => {
    const uploaded = await h.request(member.session, route(dept, 'files') + '?name=mine.txt',
      { method: 'POST', body: undefined, headers: { 'Content-Type': 'text/plain' } });
    assert.equal(uploaded.status, 400, 'an upload with no bytes is not an attachment');
    const real = await fetch(new URL(route(dept, 'files') + '?name=mine.txt', h.url), { method: 'POST',
      headers: { ...member.session.headers, 'Content-Type': 'text/plain' }, body: 'bytes of mine' });
    assert.equal(real.status, 201);
    const { id } = await real.json();
    const stolen = await h.request(admin.session, route(dept, 'posts'), { method: 'POST', body: { body: 'not my file', media: [id] } });
    assert.equal(stolen.status, 403);
    const mine = await h.request(member.session, route(dept, 'posts'), { method: 'POST', body: { body: 'my file', media: [id] } });
    assert.equal(mine.status, 201);
    const twice = await h.request(member.session, route(dept, 'posts'), { method: 'POST', body: { body: 'again', media: [id] } });
    assert.equal(twice.status, 400, 'an attachment already on a post cannot be reused');
  });

  test('removing a post takes its attachments with it and nothing else', async () => {
    const board = boardFor(member);
    const others = (await board.list()).flatMap(post => post.media.map(item => item.id)).filter(id => id !== posted.media[0].id);
    await board.remove(posted.id);
    assert.equal((await board.list()).some(post => post.id === posted.id), false);
    assert.equal(await board.file(posted.media[0].id), null);
    for (const id of others) assert.ok(await boardFor(admin).file(id), 'another post’s attachment is untouched');
  });
});

describe('an exchange commits once or not at all', { concurrency: false }, () => {
  let exchangeId, shiftId, people;
  before(() => {
    // Three people, a three-way move, checked against the roster revision it was built on.
    const db = open(h.dbPath);
    people = [member.personId, admin.personId];
    const extra = db.prepare('SELECT person_id FROM memberships WHERE department_id = ? AND revoked_at IS NULL AND activated_at IS NOT NULL AND person_id NOT IN (?,?)')
      .get(dept, member.personId, admin.personId);
    if (extra) people.push(extra.person_id);
    const at = new Date().toISOString();
    shiftId = 'shared-shift-1';
    db.prepare('INSERT INTO assignments (id, department_id, date, shift, person_id, revision) VALUES (?,?,?,?,?,1)')
      .run(shiftId, dept, '2026-12-04', 'N', member.personId);
    exchangeId = 'shared-exchange-1';
    db.prepare('INSERT INTO exchanges (id, department_id, moves, basis, status, created_at) VALUES (?,?,?,?,?,?)')
      .run(exchangeId, dept, JSON.stringify([{ assignmentId: shiftId, fromPersonId: member.personId, toPersonId: admin.personId, date: '2026-12-04', shift: 'N' }]),
        JSON.stringify({ assignments: { [shiftId]: 1 }, rulesRevision: 'pilot-3', proposedBy: member.personId }), 'Waiting', at);
    for (const person of people) db.prepare('INSERT INTO exchange_people (exchange_id, person_id) VALUES (?,?)').run(exchangeId, person);
    db.close();
  });

  test('each person confirms from their own session, and the shift moves only at the end', async () => {
    const path = route(dept, 'exchanges', exchangeId);
    const shiftNow = async () => (await h.request(member.session, route(dept, 'assignments'))).json.find(row => row.id === shiftId).personId;
    assert.equal(await shiftNow(), member.personId);
    const first = await h.request(member.session, path + '/accept', { method: 'POST', body: {} });
    assert.equal(first.status, 200);
    assert.equal(await shiftNow(), member.personId, 'one acceptance moves nothing');
    const rest = people.filter(person => person !== member.personId)
      .map(person => person === admin.personId ? admin.session : null).filter(Boolean);
    for (const session of rest) assert.equal((await h.request(session, path + '/accept', { method: 'POST', body: {} })).status, 200);
    const settled = (await h.request(member.session, path)).json;
    if (settled.people.length === settled.acceptedBy.length) {
      assert.equal(settled.status, 'Agreed');
      assert.equal(await shiftNow(), admin.personId);
    } else {
      assert.equal(settled.status, 'Waiting', 'with somebody still to agree, nothing has moved');
      assert.equal(await shiftNow(), member.personId);
    }
  });

  test('concurrent acceptances cannot settle it twice', async () => {
    // One process, one SQLite file: writes serialize here, so what this shows is that the transaction holds and the
    // second request is refused, not that a multi-process deployment is safe. That needs its own test when there is
    // more than one process.
    const db = open(h.dbPath);
    const at = new Date().toISOString();
    db.prepare('INSERT INTO assignments (id, department_id, date, shift, person_id, revision) VALUES (?,?,?,?,?,1)')
      .run('shared-shift-2', dept, '2026-12-11', 'N', member.personId);
    db.prepare('INSERT INTO exchanges (id, department_id, moves, basis, status, created_at) VALUES (?,?,?,?,?,?)')
      .run('shared-exchange-2', dept, JSON.stringify([{ assignmentId: 'shared-shift-2', fromPersonId: member.personId, toPersonId: admin.personId, date: '2026-12-11', shift: 'N' }]),
        JSON.stringify({ assignments: { 'shared-shift-2': 1 }, rulesRevision: 'pilot-3' }), 'Waiting', at);
    db.prepare('INSERT INTO exchange_people (exchange_id, person_id) VALUES (?,?)').run('shared-exchange-2', member.personId);
    db.close();
    const path = route(dept, 'exchanges', 'shared-exchange-2') + '/accept';
    const both = await Promise.all([h.request(member.session, path, { method: 'POST', body: {} }), h.request(member.session, path, { method: 'POST', body: {} })]);
    const settled = both.filter(result => result.status === 200), refused = both.filter(result => result.status === 409);
    assert.equal(settled.length + refused.length, 2, 'both requests were answered, with no server error');
    assert.equal(settled.length, 1, 'exactly one of them settled it');
    const shift = (await h.request(member.session, route(dept, 'assignments'))).json.find(row => row.id === 'shared-shift-2');
    assert.equal(shift.personId, admin.personId);
    assert.equal(shift.revision, 2, 'the shift moved once');
  });

  test('a proposal built on an older version of its own shift is refused rather than committed', async () => {
    const db = open(h.dbPath);
    const at = new Date().toISOString();
    db.prepare('INSERT INTO assignments (id, department_id, date, shift, person_id, revision) VALUES (?,?,?,?,?,1)')
      .run('shared-shift-3', dept, '2026-12-18', 'N', member.personId);
    db.prepare('INSERT INTO exchanges (id, department_id, moves, basis, status, created_at) VALUES (?,?,?,?,?,?)')
      .run('shared-exchange-3', dept, JSON.stringify([{ assignmentId: 'shared-shift-3', fromPersonId: member.personId, toPersonId: admin.personId }]),
        JSON.stringify({ assignments: { 'shared-shift-3': 0 }, rulesRevision: 'pilot-3' }), 'Waiting', at);
    db.prepare('INSERT INTO exchange_people (exchange_id, person_id) VALUES (?,?)').run('shared-exchange-3', member.personId);
    db.close();
    // The proposal says this shift was at revision 0 when it was built. It is at 1, so it is out of date. A trade
    // elsewhere in the department would not have invalidated it; a change to this shift does.
    const tried = await h.request(member.session, route(dept, 'exchanges', 'shared-exchange-3') + '/accept', { method: 'POST', body: {} });
    assert.equal(tried.status, 409);
    const shift = (await h.request(member.session, route(dept, 'assignments'))).json.find(row => row.id === 'shared-shift-3');
    assert.equal(shift.personId, member.personId, 'nothing moved');
    assert.equal(shift.revision, 1);
  });
});

describe('receipts record the changes and nothing about browsing', { concurrency: false }, () => {
  test('every state change has a receipt with the build identity, and the chain holds', async () => {
    const receipts = (await h.request(admin.session, route(dept, 'receipts'))).json;
    const kinds = new Set(receipts.map(row => row.type));
    for (const expected of ['Board update', 'Board post removed', 'Exchange agreed', 'Invitation issued', 'Membership revoked'])
      assert.ok(kinds.has(expected), 'a receipt for: ' + expected);
    for (const row of receipts) assert.ok(row.build, 'every receipt names the build that wrote it');
    let previous = null;
    for (const row of receipts) { assert.equal(row.previousHash, previous); previous = row.hash; }
  });

  test('reading things leaves no named record of who read what', async () => {
    const before = (await h.request(admin.session, route(dept, 'receipts'))).json.length;
    const board = boardFor(member);
    await board.list();
    await h.request(member.session, route(dept, 'search') + '?q=flowmeter');
    await h.request(member.session, route(dept, 'ask'), { method: 'POST', body: { question: 'When do I work next?' } });
    await h.request(member.session, route(dept, 'directory'));
    const after = (await h.request(admin.session, route(dept, 'receipts'))).json;
    assert.equal(after.length, before, 'browsing, searching and asking add nothing');
    assert.equal(JSON.stringify(after).includes('When do I work next'), false, 'no question text is kept');
    assert.equal(JSON.stringify(after).toLowerCase().includes('fingerprint'), false, 'and no question fingerprint');
  });
});
