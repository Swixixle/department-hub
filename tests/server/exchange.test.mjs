// Shift exchanges, against the conditions that change between a proposal and the moment somebody agrees to it.
//
// All three of the faults these cover were found by review, not by me, and the tests I already had went green while
// each was present. The common shape of my mistake: I checked the thing being moved and the person doing the
// clicking, and not the people and shifts around them.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, route } from './harness.mjs';
import { open } from '../../server/db.mjs';

let h, a;
before(async () => { h = await boot(); a = h.s.member.departmentId; });
after(() => h?.stop());

const exchangePath = () => route(a, 'exchanges', h.r.conversation.exchangeId);
const exchange = async session => (await h.request(session, exchangePath())).json;
const assignments = async session => (await h.request(session, route(a, 'assignments'))).json;
const receipts = async () => (await h.request(h.s.keeper, route(a, 'receipts'))).json;
// The offered shift, as the seeder set it up: the member's, moving to the partner.
const offered = async () => {
  const moves = (await exchange(h.s.member)).moves;
  return (await assignments(h.s.member)).find(row => row.id === moves[0].assignmentId);
};
const withDb = work => { const db = open(h.dbPath); try { return work(db); } finally { db.close(); } };

describe('a change to a participant’s other shifts invalidates the proposal', { concurrency: false }, () => {
  test('a recipient who has since picked up the same night cannot be given a second one', async () => {
    const shift = await offered();
    const before = await receipts();
    // Another assignment appears for the recipient, on the same date and shift as the one being offered to them.
    // Nothing about the offered assignment changes, so checking only that is not enough.
    withDb(db => db.prepare('INSERT INTO assignments (id, department_id, date, shift, person_id, revision) VALUES (?,?,?,?,?,1)')
      .run('clash-shift', a, shift.date, shift.shift, h.s.partner.personId));

    const first = await h.request(h.s.member, exchangePath() + '/accept', { method: 'POST', body: {} });
    const second = await h.request(h.s.partner, exchangePath() + '/accept', { method: 'POST', body: {} });
    assert.ok([409, 403].includes(first.status), 'the proposal is stale the moment that shift appeared; got ' + first.status);
    assert.ok([409, 403].includes(second.status), 'got ' + second.status);

    const now = await exchange(h.s.member);
    assert.notEqual(now.status, 'Agreed');
    assert.deepEqual(now.acceptedBy, [], 'a refused acceptance is not recorded');
    const after = await assignments(h.s.member);
    assert.equal(after.filter(row => row.personId === h.s.partner.personId && row.date === shift.date && row.shift === shift.shift).length, 1,
      'the recipient must not end up on the same night twice');
    assert.equal(after.find(row => row.id === shift.id).personId, h.s.member.personId, 'nothing moved');
    assert.deepEqual(await receipts(), before, 'a refused operation writes no receipt');
    withDb(db => db.prepare('DELETE FROM assignments WHERE id = ?').run('clash-shift'));
  });

  test('a recipient who would be left without enough rest is refused', async () => {
    const shift = await offered();
    const dayBefore = new Date(Date.parse(shift.date + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
    // A day shift the day before a night shift leaves a gap under the recorded minimum rest.
    withDb(db => db.prepare('INSERT INTO assignments (id, department_id, date, shift, person_id, hours, revision) VALUES (?,?,?,?,?,?,1)')
      .run('rest-shift', a, dayBefore, 'D', h.s.partner.personId, '7-19'));
    const tried = await h.request(h.s.member, exchangePath() + '/accept', { method: 'POST', body: {} });
    assert.ok([409, 403].includes(tried.status), 'got ' + tried.status);
    assert.deepEqual((await exchange(h.s.member)).acceptedBy, []);
    withDb(db => db.prepare('DELETE FROM assignments WHERE id = ?').run('rest-shift'));
  });

  test('a trade elsewhere in the department does not invalidate this one', async () => {
    // The distinction that matters: somebody unrelated changing shifts is not a reason to refuse this proposal.
    withDb(db => db.prepare('INSERT INTO assignments (id, department_id, date, shift, person_id, revision) VALUES (?,?,?,?,?,7)')
      .run('unrelated-shift', a, '2027-03-01', 'D', h.s.outsider.personId));
    const accepted = await h.request(h.s.member, exchangePath() + '/accept', { method: 'POST', body: {} });
    assert.equal(accepted.status, 200, 'an unrelated shift elsewhere must not block this');
    assert.deepEqual(accepted.json.acceptedBy, [h.s.member.personId]);
    withDb(db => { db.prepare('DELETE FROM assignments WHERE id = ?').run('unrelated-shift');
      db.prepare('UPDATE exchange_people SET accepted_at = NULL WHERE exchange_id = ?').run(h.r.conversation.exchangeId); });
  });

  test('a shift that has already started cannot be traded', async () => {
    const shift = await offered();
    // Move the offered shift into the past rather than waiting for the clock.
    withDb(db => db.prepare('UPDATE assignments SET date = ? WHERE id = ?').run('2020-01-04', shift.id));
    const tried = await h.request(h.s.member, exchangePath() + '/accept', { method: 'POST', body: {} });
    assert.ok([409, 403].includes(tried.status), 'got ' + tried.status);
    assert.deepEqual((await exchange(h.s.member)).acceptedBy, []);
    withDb(db => db.prepare('UPDATE assignments SET date = ? WHERE id = ?').run(shift.date, shift.id));
  });
});

describe('every participant has to still be a member, not only the one clicking', { concurrency: false }, () => {
  test('an acceptance is refused once another participant has been removed', async () => {
    const membershipId = h.s.partner.membershipId;
    assert.ok([200, 204].includes((await h.request(h.s.admin, route(a, 'memberships', membershipId), { method: 'DELETE' })).status));
    // Snapshot after the revocation, which legitimately writes its own receipt; what must add nothing is the
    // refused acceptance that follows.
    const before = await receipts();
    const tried = await h.request(h.s.member, exchangePath() + '/accept', { method: 'POST', body: {} });
    assert.ok([409, 403, 404].includes(tried.status), 'the other side of this trade is no longer here; got ' + tried.status);
    const now = await exchange(h.s.member);
    assert.deepEqual(now.acceptedBy, [], 'no acceptance is recorded for a proposal that cannot settle');
    assert.notEqual(now.status, 'Agreed');
    assert.deepEqual(await receipts(), before, 'and no receipt');
  });

  test('the same proposal cannot settle later either', async () => {
    const tried = await h.request(h.s.member, exchangePath() + '/accept', { method: 'POST', body: {} });
    assert.ok([409, 403, 404].includes(tried.status));
    const shift = await offered();
    assert.equal(shift.personId, h.s.member.personId, 'the shift stayed where it was');
  });
});

describe('a participant removed between the first agreement and the last', { concurrency: false }, () => {
  let second, shiftId;
  before(async () => {
    // A fresh pair: the keeper gives a shift to the outsider, both still members.
    second = await (async () => {
      const id = 'between-exchange';
      shiftId = 'between-shift';
      withDb(db => {
        const at = new Date().toISOString();
        const date = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
        db.prepare('INSERT INTO assignments (id, department_id, date, shift, person_id, revision) VALUES (?,?,?,?,?,1)').run(shiftId, a, date, 'N', h.s.keeper.personId);
        db.prepare('INSERT INTO exchanges (id, department_id, moves, basis, status, created_at) VALUES (?,?,?,?,?,?)')
          .run(id, a, JSON.stringify([{ assignmentId: shiftId, fromPersonId: h.s.keeper.personId, toPersonId: h.s.outsider.personId, date, shift: 'N' }]),
            JSON.stringify({ assignments: { [shiftId]: 1 }, rulesRevision: 'pilot-3' }), 'Waiting', at);
        for (const person of [h.s.keeper.personId, h.s.outsider.personId])
          db.prepare('INSERT INTO exchange_people (exchange_id, person_id) VALUES (?,?)').run(id, person);
      });
      return id;
    })();
  });

  test('the first agreement is recorded, the second is refused, and nothing moves', async () => {
    const path = route(a, 'exchanges', second) + '/accept';
    const first = await h.request(h.s.keeper, path, { method: 'POST', body: {} });
    assert.equal(first.status, 200, 'got ' + first.status + ' ' + first.text.slice(0, 120));
    assert.deepEqual(first.json.acceptedBy, [h.s.keeper.personId]);
    assert.ok([200, 204].includes((await h.request(h.s.admin, route(a, 'memberships', h.s.outsider.membershipId), { method: 'DELETE' })).status));
    const last = await h.request(h.s.outsider, path, { method: 'POST', body: {} });
    assert.ok([401, 403, 404, 409].includes(last.status), 'a removed member cannot agree to anything; got ' + last.status);
    const still = (await h.request(h.s.keeper, route(a, 'exchanges', second))).json;
    assert.notEqual(still.status, 'Agreed');
    assert.equal((await assignments(h.s.keeper)).find(row => row.id === shiftId).personId, h.s.keeper.personId);
  });
});

describe('what the refusals say, and what the receipt route returns', { concurrency: false }, () => {
  test('a removed participant is refused by name of the reason, not by a general staleness message', async () => {
    // Two things could refuse this: the explicit membership recheck, and the proposal basis, which binds the
    // participants' recorded profiles. Asserting the message keeps the explicit check from being quietly dropped
    // on the grounds that something else happens to catch it.
    const fresh = await boot();
    try {
      const path = route(fresh.s.member.departmentId, 'exchanges', fresh.r.conversation.exchangeId) + '/accept';
      assert.ok([200, 204].includes((await fresh.request(fresh.s.admin, route(fresh.s.member.departmentId, 'memberships', fresh.s.partner.membershipId), { method: 'DELETE' })).status));
      const tried = await fresh.request(fresh.s.member, path, { method: 'POST', body: {} });
      assert.equal(tried.status, 409);
      assert.match(tried.json.error, /no longer a member of this department/);
    } finally { fresh.stop(); }
  });

  test('receipts come back in chain order even when their timestamps do not agree', async () => {
    // The chain is ordered by seq. A route that reads them back by time would hand out a list whose links do not
    // line up, and verifying that list would be verifying the wrong order.
    const rows = (await receipts());
    assert.ok(rows.length >= 3);
    withDb(db => {
      // Make the stored times disagree with the order: the second receipt is given the latest time of all.
      db.prepare("UPDATE receipts SET at = '2030-01-01T00:00:00.000Z' WHERE department_id = ? AND seq = 2").run(a);
      db.prepare("UPDATE receipts SET at = '2001-01-01T00:00:00.000Z' WHERE department_id = ? AND seq = 3").run(a);
    });
    const after = await receipts();
    assert.deepEqual(after.map(row => row.seq), rows.map(row => row.seq), 'the order is unchanged by the timestamps');
    let previous = null;
    for (const row of after) { assert.equal(row.previousHash, previous, 'receipt ' + row.seq + ' is out of place'); previous = row.hash; }
    // The server's own verification reads the same order and still agrees about the links.
    const verified = (await h.request(h.s.keeper, route(a, 'receipts', 'verify'))).json;
    assert.equal(verified.checked, after.length);
    assert.deepEqual(verified.broken.filter(item => /points at the wrong|out of sequence/.test(item.why)), []);
  });
});
