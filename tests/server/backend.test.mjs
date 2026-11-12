// Implementation tests for the shared server. They cover what the reviewed permission contract leaves untested, and
// the parts of the brief that the contract does not reach: a refused write leaving nothing behind, who may
// administer a membership, whose acceptance an acceptance is, header-forged identity, and real persistence.
//
// Four of these exist because a mutation run found the reviewed contract did not catch the corresponding fault.
// They are additions, not replacements: tests/shared/permissions.test.mjs still runs unchanged as the gate.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, route } from './harness.mjs';

let h, a, b;
before(async () => { h = await boot(); a = h.s.member.departmentId; b = h.s.foreign.departmentId; });
after(() => h?.stop());

const denied = result => assert.ok([401, 403, 404].includes(result.status), 'expected a denial, got ' + result.status);
const posts = async session => (await h.request(session, route(a, 'posts'))).json;

describe('a refused write leaves nothing behind', { concurrency: false }, () => {
  test('a create refused for forged authorship saves no row', async () => {
    const before = await posts(h.s.member);
    const marker = 'forged-authorship-' + h.fixture.runId;
    const refused = await h.request(h.s.member, route(a, 'posts'), { method: 'POST', body: { body: marker, authorId: h.s.partner.personId } });
    assert.ok([400, 403].includes(refused.status), 'forged authorship is refused, got ' + refused.status);
    const after = await posts(h.s.member);
    assert.deepEqual(after, before);
    assert.equal(JSON.stringify(after).includes(marker), false, 'the refused text must not be on the board');
  });

  test('a create refused for a forged department saves no row in either department', async () => {
    const marker = 'forged-department-' + h.fixture.runId;
    const refused = await h.request(h.s.member, route(a, 'posts'), { method: 'POST', body: { body: marker, departmentId: b } });
    assert.ok([400, 403].includes(refused.status));
    for (const [session, dept] of [[h.s.member, a], [h.s.foreign, b]])
      assert.equal(JSON.stringify((await h.request(session, route(dept, 'posts'))).json).includes(marker), false);
  });

  test('a create refused for an empty body saves no row', async () => {
    const before = await posts(h.s.member);
    assert.equal((await h.request(h.s.member, route(a, 'posts'), { method: 'POST', body: { body: '   ' } })).status, 400);
    assert.deepEqual(await posts(h.s.member), before);
  });

  test('an edit refused because the caller does not own the post leaves the words alone', async () => {
    const mine = await h.request(h.s.member, route(a, 'posts'), { method: 'POST', body: { body: 'ownership control ' + h.fixture.runId } });
    assert.equal(mine.status, 201);
    denied(await h.request(h.s.partner, route(a, 'posts', mine.json.id), { method: 'PATCH', body: { body: 'rewritten by somebody else' } }));
    denied(await h.request(h.s.partner, route(a, 'posts', mine.json.id), { method: 'DELETE' }));
    const after = await h.request(h.s.member, route(a, 'posts', mine.json.id));
    assert.deepEqual(after.json, mine.json);
  });
});

describe('membership administration is not open to every member', { concurrency: false }, () => {
  test('a member, a custodian and the person themselves cannot change roles or revoke', async () => {
    const target = h.s.revocable.membershipId;
    for (const session of [h.s.member, h.s.keeper, h.s.outsider, h.s.revocable]) {
      denied(await h.request(session, route(a, 'memberships', target), { method: 'PATCH', body: { roles: ['member', 'admin'] } }));
      denied(await h.request(session, route(a, 'memberships', target), { method: 'DELETE' }));
    }
    // Still a working member with the roles the fixture gave them.
    assert.equal((await h.request(h.s.revocable, '/api/session')).json.roles.join(','), 'member');
  });

  test('a custodian cannot promote themselves, and an administrator is not a custodian', async () => {
    denied(await h.request(h.s.keeper, route(a, 'memberships', h.s.keeper.membershipId), { method: 'PATCH', body: { roles: ['member', 'admin'] } }));
    denied(await h.request(h.s.admin, route(a, 'fairness', h.s.partner.personId)));
    denied(await h.request(h.s.admin, route(a, 'exports/fairness')));
  });

  test('an administrator of one department cannot touch the other department’s memberships', async () => {
    denied(await h.request(h.s.admin, route(b, 'memberships', h.s.foreign.membershipId), { method: 'DELETE' }));
    denied(await h.request(h.s.admin, route(a, 'memberships', h.s.foreign.membershipId), { method: 'DELETE' }));
    assert.equal((await h.request(h.s.foreign, '/api/session')).status, 200);
  });
});

describe('an acceptance belongs to whoever sent it', { concurrency: false }, () => {
  test('a participant cannot accept in the other participant’s name', async () => {
    const path = route(a, 'exchanges', h.r.conversation.exchangeId);
    const refused = await h.request(h.s.member, path + '/accept', { method: 'POST', body: { personId: h.s.partner.personId } });
    assert.ok([400, 403].includes(refused.status), 'naming another person is refused, got ' + refused.status);
    const exchange = (await h.request(h.s.member, path)).json;
    assert.deepEqual(exchange.acceptedBy, [], 'nothing was recorded for either person');
  });

  test('each person’s own acceptance is recorded, and the shift moves only when both have agreed', async () => {
    const path = route(a, 'exchanges', h.r.conversation.exchangeId);
    // The fixture dates its shifts from today, so read the offered one from the proposal rather than naming a date.
    const offered = (await h.request(h.s.member, path)).json.moves[0];
    const shift = (await h.request(h.s.member, route(a, 'assignments'))).json.find(row => row.id === offered.assignmentId);
    assert.equal(shift.personId, h.s.member.personId);
    const first = await h.request(h.s.member, path + '/accept', { method: 'POST', body: {} });
    assert.equal(first.status, 200);
    assert.deepEqual(first.json.acceptedBy, [h.s.member.personId]);
    assert.equal(first.json.status, 'Waiting');
    assert.equal((await h.request(h.s.member, route(a, 'assignments'))).json.find(row => row.id === shift.id).personId, h.s.member.personId);
    const second = await h.request(h.s.partner, path + '/accept', { method: 'POST', body: {} });
    assert.equal(second.status, 200);
    assert.equal(second.json.status, 'Agreed');
    assert.deepEqual(second.json.acceptedBy.sort(), [h.s.member.personId, h.s.partner.personId].sort());
    assert.equal((await h.request(h.s.member, route(a, 'assignments'))).json.find(row => row.id === shift.id).personId, h.s.partner.personId);
  });

  test('a settled exchange cannot be accepted again', async () => {
    const path = route(a, 'exchanges', h.r.conversation.exchangeId);
    const again = await h.request(h.s.partner, path + '/accept', { method: 'POST', body: {} });
    assert.equal(again.status, 409);
    const exchange = (await h.request(h.s.member, path)).json;
    assert.equal(exchange.status, 'Agreed');
  });
});

describe('identity comes from the session, not from a header', { concurrency: false }, () => {
  test('authorship ignores every actor hint a request can carry', async () => {
    const headers = { 'X-Actor': h.s.partner.personId, 'X-Role': 'custodian', 'X-Department-ID': b,
      'X-Person-Id': h.s.partner.personId, 'X-On-Behalf-Of': h.s.keeper.personId };
    const created = await h.request(h.s.member, route(a, 'posts'), { method: 'POST', body: { body: 'header identity control ' + h.fixture.runId }, headers });
    assert.equal(created.status, 201);
    assert.equal(created.json.authorId, h.s.member.personId);
    assert.equal(created.json.departmentId, a);
    const message = await h.request(h.s.member, route(a, 'conversations', h.r.conversation.id) + '/messages', { method: 'POST', body: { body: 'header message control ' + h.fixture.runId }, headers });
    assert.equal(message.status, 201);
    assert.equal(message.json.authorId, h.s.member.personId);
    assert.equal((await h.request(h.s.member, '/api/session', { headers })).json.personId, h.s.member.personId);
  });

  test('a role hint grants nothing', async () => {
    for (const headers of [{ 'X-Role': 'custodian' }, { 'X-Roles': 'admin,custodian' }, { 'X-Keeper': 'true' }])
      denied(await h.request(h.s.member, route(a, 'fairness', h.s.partner.personId), { headers }));
  });
});

describe('tokens are bearer secrets with one purpose each', { concurrency: false }, () => {
  test('a session token works in the header or the cookie, and nothing else does', async () => {
    const token = h.s.member.headers.Authorization.replace(/^Bearer\s+/, '');
    assert.equal((await h.request(null, '/api/session', { headers: { Cookie: 'department_hub_session=' + token } })).status, 200);
    for (const headers of [{ Authorization: 'Bearer ' + token + 'x' }, { Authorization: 'Basic ' + token }, { Cookie: 'department_hub_session=' + token + 'x' }, {}])
      assert.equal((await h.request(null, '/api/session', { headers })).status, 401);
  });

  test('no raw token appears in a receipt, and the receipt chain holds', async () => {
    const receipts = (await h.request(h.s.member, route(a, 'receipts'))).json;
    assert.ok(receipts.length, 'the writes above left receipts');
    const tokens = Object.values(h.s).map(session => (session.headers?.Authorization || '').replace(/^Bearer\s+/, '')).filter(Boolean);
    const text = JSON.stringify(receipts);
    for (const token of tokens) assert.equal(text.includes(token), false, 'a raw session token reached a receipt');
    for (const phone of Object.values(h.fixture.contacts).map(contact => contact.phone)) assert.equal(text.replace(/\D/g, '').includes(phone), false, 'a phone number reached a receipt');
    let previous = null;
    for (const receipt of receipts) { assert.equal(receipt.previousHash, previous); previous = receipt.hash; }
  });
});

describe('records and attachment bytes survive a restart', { concurrency: false }, () => {
  test('a post, a message and a file are all still there after the process is restarted', async () => {
    const marker = 'persistence control ' + h.fixture.runId;
    const created = await h.request(h.s.member, route(a, 'posts'), { method: 'POST', body: { body: marker } });
    assert.equal(created.status, 201);
    const again = await h.reopen();
    try {
      const get = async (session, path) => {
        const response = await fetch(new URL(path, again.url), { headers: session.headers, signal: AbortSignal.timeout(10000) });
        return { status: response.status, text: await response.text() };
      };
      const board = await get(h.s.member, route(a, 'posts'));
      assert.equal(board.status, 200);
      assert.ok(board.text.includes(marker), 'the post is still on the board after a restart');
      const file = await get(h.s.member, route(a, 'files', h.r.file.id));
      assert.equal(file.status, 200);
      assert.ok(file.text.includes(h.r.file.marker), 'the attachment bytes came back, not a placeholder');
      const privateFile = await get(h.s.outsider, route(a, 'files', h.r.privateFile.id));
      assert.ok([401, 403, 404].includes(privateFile.status), 'a restart does not reopen a private attachment');
      const thread = await get(h.s.partner, route(a, 'conversations', h.r.conversation.id));
      assert.ok(thread.text.includes('header message control ' + h.fixture.runId), 'the message written earlier is still in the thread');
    } finally { again.stop(); h = null; }
  });
});
