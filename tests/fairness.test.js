import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holidays, isWeekendTurn, ledger, releaseOrder, statSheet } from '../src/fairness.js';

const row = (date, shift, person, role) => ({ date, shift, person, ...(role ? { role } : {}) });
// Two weeks of nights starting Sunday 2026-11-29. Taylor works every weekend night and nothing else.
function nights() {
  const rows = [];
  const pattern = { Jordan: [0, 1, 5], Morgan: [0, 2, 3], Parker: [1, 2, 4], Quinn: [3, 4, 6] };   // day of week, 0 = Sunday
  for (let week = 0; week < 2; week++) {
    for (const [person, days] of Object.entries(pattern)) for (const day of days) rows.push(row(date(week * 7 + day), 'N', person, day === 0 ? 'charge' : undefined));
    for (const day of [0, 5, 6]) rows.push(row(date(week * 7 + day), 'N', 'Taylor'));
  }
  return rows;
}
const date = offset => new Date(Date.UTC(2026, 10, 29 + offset)).toISOString().slice(0, 10);

test('weekend turns follow the shift: Saturday and Sunday days, Friday to Sunday nights', () => {
  assert.equal(isWeekendTurn(row('2026-12-04', 'D', 'A')), false);   // Friday day
  assert.equal(isWeekendTurn(row('2026-12-04', 'N', 'A')), true);    // Friday night
  assert.equal(isWeekendTurn(row('2026-12-05', 'D', 'A')), true);
  assert.equal(isWeekendTurn(row('2026-12-07', 'N', 'A')), false);
});

test('fair share follows shifts worked, and a weekend-only person is left out of the pool', () => {
  const table = ledger(nights(), 'N', { taylor: { status: 'Contract', arrangement: 'weekend-only' } });
  const by = Object.fromEntries(table.people.map(entry => [entry.person, entry]));
  assert.equal(by.Taylor.weekendGap, null);
  assert.equal(by.Taylor.weekend, 6);
  // The other four share 8 weekend nights between 24 shifts: 2 each.
  assert.deepEqual(['Jordan', 'Morgan', 'Parker', 'Quinn'].map(name => [by[name].weekend, by[name].weekendFair]), [[4, 2], [2, 2], [0, 2], [2, 2]]);
  assert.equal(table.spread, 4);
  assert.equal(table.withinOne, 2);
  assert.equal(table.regulars, 4);
  assert.equal(table.next[0], 'Parker');
  assert.equal(by.Jordan.charge, 2);
  // Without the arrangement, the same person counts toward everyone's share.
  assert.ok(ledger(nights(), 'N', {}).people.find(entry => entry.person === 'Jordan').weekendFair > 2);
});

test('students are left out and holidays are named', () => {
  const rows = [...nights(), row('2026-12-25', 'N', 'Jordan'), row('2026-12-25', 'N', 'Riley')];
  const table = ledger(rows, 'N', { riley: { status: 'Student' } });
  assert.equal(table.people.some(entry => entry.person === 'Riley'), false);
  assert.deepEqual(table.people.find(entry => entry.person === 'Jordan').holidays, ['Christmas Day']);
  assert.deepEqual(holidays(2026).filter(item => /Thanksgiving|Memorial|Labor/.test(item.name)).map(item => item.date), ['2026-05-25', '2026-09-07', '2026-11-26']);
});

test('offering to go home never moves someone to the front of the line', () => {
  const releases = [
    { person: 'Jordan', hours: 4, voluntary: true, inPlaceOf: 'Morgan', date: '2026-11-29' },
    { person: 'Parker', hours: 2, voluntary: false, date: '2026-11-30' }
  ];
  assert.deepEqual(releaseOrder(['Jordan', 'Morgan', 'Parker'], releases).map(item => item.person), ['Morgan', 'Parker', 'Jordan']);
  assert.deepEqual(releaseOrder(['Jordan', 'Morgan'], []).map(item => item.hours), [0, 0]);
});

test('a stat sheet counts what a person carried and the times they helped', () => {
  const requests = [
    { status: 'Both agreed · queued for review', kind: 'trade', recipient: 'Jordan', from: { person: 'Morgan' } },
    { status: 'Both agreed · queued for review', kind: 'coverage', recipient: 'Jordan', from: { person: 'Quinn' } },
    { status: 'Declined', kind: 'trade', recipient: 'Jordan', from: { person: 'Parker' } },
    { status: 'Awaiting reply', kind: 'trade', recipient: 'Jordan', from: { person: 'Parker' } }
  ];
  const releases = [{ person: 'Jordan', hours: 4, voluntary: true, inPlaceOf: 'Morgan', date: '2026-11-29' }, { person: 'Jordan', hours: 2, voluntary: false, date: '2026-12-01' }];
  const sheet = statSheet('Jordan', { assignments: nights(), requests, releases, directory: {} });
  assert.deepEqual([sheet.shift, sheet.row.shifts, sheet.tradesAccepted, sheet.shiftsCovered, sheet.wentHomeForSomeone, sheet.releasedHours], ['N', 6, 1, 1, 1, 6]);
  // Nothing on the sheet counts a declined request.
  assert.equal(JSON.stringify(sheet).includes('eclin'), false);
});
