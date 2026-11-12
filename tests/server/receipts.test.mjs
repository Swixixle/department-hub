// The receipt chain, under the conditions that break a chain: a clock that does not move, and a clock that goes
// backwards. Each receipt names the one before it, so if "the one before it" is chosen wrongly the chain forks and
// the tamper evidence is worth nothing. A test that writes receipts a few milliseconds apart proves nothing about
// that, which is why the first version of this file did not exist and the bug survived.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open, receiptBody, recordReceipt, sha256, verifyReceipts } from '../../server/db.mjs';

let dir, db;
const RealDate = Date;
const freeze = ms => { globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [ms])); }
  static now() { return ms; }
}; };
const release = () => { globalThis.Date = RealDate; };

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'department-hub-receipts-'));
  db = open(join(dir, 'hub.sqlite'));
  db.prepare('INSERT INTO departments (id, name) VALUES (?,?)').run('d', 'Receipts (synthetic)');
  db.prepare('INSERT INTO departments (id, name) VALUES (?,?)').run('e', 'Other (synthetic)');
});
after(() => { release(); db?.close(); rmSync(dir, { recursive: true, force: true }); });

const chainOf = departmentId => db.prepare('SELECT * FROM receipts WHERE department_id = ? ORDER BY seq').all(departmentId);

// Every receipt's stored hash is recomputed from its own fields, and its previous_hash is the hash of the receipt
// written before it. Checking that the fields are merely present is not checking a chain.
function verify(rows) {
  let previous = null;
  for (const [index, row] of rows.entries()) {
    assert.equal(row.seq, index + 1, 'receipt ' + index + ' is out of sequence');
    assert.equal(row.previous_hash, previous, 'receipt ' + index + ' points at the wrong one');
    assert.equal(row.hash, sha256(receiptBody({ ...row, previous_hash: previous })), 'receipt ' + index + ' does not hash to its stored hash');
    previous = row.hash;
  }
  return rows.length;
}

describe('the receipt chain holds whatever the clock does', { concurrency: false }, () => {
  test('thirty receipts written in the same millisecond form one chain, not a bush', () => {
    freeze(RealDate.parse('2026-11-12T08:00:00.000Z'));
    const written = [];
    for (let index = 0; index < 30; index++) written.push(recordReceipt(db, { departmentId: 'd', actorId: 'a', type: 'Board update', details: { index }, build: 'test' }));
    release();
    const rows = chainOf('d');
    assert.equal(rows.length, 30);
    assert.deepEqual(rows.map(row => row.id), written.map(entry => entry.id), 'the stored order is the order they were written');
    assert.equal(verify(rows), 30);
  });

  test('a clock that jumps backwards does not fork it either', () => {
    const base = RealDate.parse('2026-11-12T09:00:00.000Z');
    for (const offset of [0, 5000, -9000, 1, -1, 60000, -120000, 0]) {
      freeze(base + offset);
      recordReceipt(db, { departmentId: 'd', actorId: 'a', type: 'Roles changed', details: { offset }, build: 'test' });
    }
    release();
    const rows = chainOf('d');
    assert.equal(rows.length, 38);
    assert.equal(verify(rows), 38);
  });

  test('two departments keep two separate chains', () => {
    freeze(RealDate.parse('2026-11-12T10:00:00.000Z'));
    for (let index = 0; index < 5; index++) {
      recordReceipt(db, { departmentId: 'e', actorId: 'b', type: 'Board update', details: { index }, build: 'test' });
      recordReceipt(db, { departmentId: 'd', actorId: 'a', type: 'Board update', details: { index }, build: 'test' });
    }
    release();
    assert.equal(verify(chainOf('e')), 5);
    assert.equal(verify(chainOf('d')), 43);
    assert.equal(chainOf('e')[0].previous_hash, null, 'the other department starts its own chain');
  });

  test('the server’s own verification agrees, and notices a single altered word', () => {
    assert.deepEqual(verifyReceipts(db, 'd'), { ok: true, checked: 43, broken: [] });
    assert.deepEqual(verifyReceipts(db, 'e'), { ok: true, checked: 5, broken: [] });
    db.prepare("UPDATE receipts SET type = 'Quietly edited' WHERE department_id = 'd' AND seq = 20").run();
    const after = verifyReceipts(db, 'd');
    assert.equal(after.ok, false);
    assert.equal(after.checked, 43);
    // The edited receipt no longer hashes to its stored hash, and the one after it no longer points at the right one.
    assert.deepEqual(after.broken.map(item => item.seq).sort((x, y) => x - y), [20]);
    assert.match(after.broken[0].why, /does not hash/);
  });

  test('the hashed body is pinned to a stated field list', () => {
    // receiptBody is used by both the writer and the verifier, so a field dropped from it would be dropped from
    // both and the chain would still appear to verify. This recomputes the hash independently, naming every field,
    // so removing one from the hashed body fails here.
    const row = db.prepare('SELECT * FROM receipts WHERE department_id = ? AND seq = 1').get('e');
    const expected = sha256(JSON.stringify({
      id: row.id, departmentId: row.department_id, seq: row.seq, actorId: row.actor_id, type: row.type,
      details: JSON.parse(row.details), previousHash: row.previous_hash, at: row.at, build: row.build
    }));
    assert.equal(row.hash, expected, 'the hashed body is not the nine fields this test names');
    // And the position is part of it: the same receipt at another position hashes differently.
    assert.notEqual(expected, sha256(JSON.stringify({
      id: row.id, departmentId: row.department_id, seq: row.seq + 1, actorId: row.actor_id, type: row.type,
      details: JSON.parse(row.details), previousHash: row.previous_hash, at: row.at, build: row.build
    })));
  });
});
