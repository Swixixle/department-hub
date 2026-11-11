import { test } from 'node:test';
import assert from 'node:assert/strict';
import { census, holidays, isWeekendTurn, ledger, releaseOrder, staffing, statSheet } from '../src/fairness.js';

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

test('people level on hours are shown as tied, and the one released longest ago goes first', () => {
  assert.deepEqual(releaseOrder(['Quinn', 'Jordan', 'Morgan'], []).map(item => [item.person, item.first]), [['Jordan', true], ['Morgan', true], ['Quinn', true]]);
  const releases = [
    { person: 'Jordan', hours: 4, voluntary: false, date: '2026-12-02' }, { person: 'Morgan', hours: 4, voluntary: false, date: '2026-11-30' },
    { person: 'Quinn', hours: 4, voluntary: true, date: '2026-12-03' }
  ];
  // Quinn offered most recently and is last. Offering protects exactly as much as being sent.
  assert.deepEqual(releaseOrder(['Jordan', 'Morgan', 'Quinn', 'Parker'], releases).map(item => [item.person, item.first]),
    [['Parker', true], ['Morgan', false], ['Jordan', false], ['Quinn', false]]);
});

test('shifts that list more or fewer people than usual are found without any setting', () => {
  const rows = [...nights(), row(date(1), 'N', 'Quinn'), row(date(1), 'N', 'Riley'), row(date(9), 'N', 'Morgan')].filter(item => !(item.date === date(3) && item.person === 'Quinn'));
  // Day 1 lists Jordan, Parker, Quinn and a student. Day 9 lists Morgan, Parker and Morgan again.
  const table = staffing(rows, 'N', { riley: { status: 'Student' } });
  assert.equal(table.usual, 2);
  assert.deepEqual(table.over.map(item => [item.date, item.people, item.extra]), [[date(0), ['Jordan', 'Morgan', 'Taylor'], 1], [date(1), ['Jordan', 'Parker', 'Quinn'], 1], [date(7), ['Jordan', 'Morgan', 'Taylor'], 1]]);
  assert.deepEqual(table.short.map(item => [item.date, item.extra]), [[date(3), -1]]);
  assert.equal(staffing([], 'D').usual, 0);
});

test('low census: each person on an over-staffed shift carries an even share, and releases are counted', () => {
  const rows = [...nights(), row(date(1), 'N', 'Quinn'), row(date(8), 'N', 'Quinn')];
  const releases = [
    { person: 'Quinn', hours: 12, voluntary: true, inPlaceOf: 'Jordan', date: date(1), shift: 'N' },
    { person: 'Morgan', hours: 4, voluntary: false, date: date(2), shift: 'N' },
    { person: 'Morgan', hours: 4, voluntary: false, date: date(2), shift: 'D' }, { person: 'Nobody', hours: 4, voluntary: false, date: date(2), shift: 'N' }
  ];
  const table = census(rows.filter(item => item.person !== 'Taylor'), 'N', {}, releases, date(5));
  assert.equal(table.usual, 2);
  assert.deepEqual(table.over.map(item => [item.date, item.recorded]), [[date(1), true], [date(8), false]]);
  assert.deepEqual(table.upcoming.map(item => item.date), [date(8)]);
  assert.deepEqual(table.unrecorded, []);
  assert.deepEqual(census(rows.filter(item => item.person !== 'Taylor'), 'N', {}, [], date(5)).unrecorded.map(item => item.date), [date(1)]);
  const by = Object.fromEntries(table.people.map(entry => [entry.person, entry]));
  assert.deepEqual([by.Quinn.onOver, by.Quinn.turns, by.Quinn.hours, by.Quinn.offered], [2, 1, 12, 1]);
  assert.ok(Math.abs(by.Jordan.share - 2 / 3) < 1e-9);
  assert.deepEqual([by.Morgan.onOver, by.Morgan.turns, by.Morgan.hours], [0, 1, 4]);
  assert.equal(by.Nobody, undefined);
  // On the next over-staffed night, the person who already gave up a shift is last in line.
  assert.deepEqual(table.over[1].order.map(item => item.person), ['Jordan', 'Parker', 'Quinn']);
  assert.deepEqual(table.over[1].order.map(item => item.first), [true, true, false]);
});

test('extra weekends taken by choice are credit, and nobody else is measured against them', () => {
  const plain = ledger(nights(), 'N', {});
  const table = ledger(nights(), 'N', { taylor: { arrangement: 'weekend-only' }, jordan: { status: 'Staff', arrangement: 'weekend-volunteer' } });
  const by = Object.fromEntries(table.people.map(entry => [entry.person, entry]));
  // Without Taylor, the four share 8 weekend nights: 2 each. Jordan worked 4, so 2 are extra by choice.
  assert.deepEqual([by.Jordan.weekend, by.Jordan.weekendFair, by.Jordan.weekendExtra, by.Jordan.weekendGap, by.Jordan.regular], [4, 2, 2, null, false]);
  assert.deepEqual(table.volunteers, [{ person: 'Jordan', extra: 2 }]);
  // The other three share the 4 weekend nights that are left between 18 shifts.
  assert.deepEqual(['Morgan', 'Parker', 'Quinn'].map(name => [by[name].weekend, Number(by[name].weekendFair.toFixed(3))]), [[2, 1.333], [0, 1.333], [2, 1.333]]);
  assert.equal(table.regulars, 3);
  assert.equal(table.next.includes('Jordan'), false);
  assert.ok(by.Morgan.weekendFair < plain.people.find(entry => entry.person === 'Morgan').weekendFair);
  // A volunteer who ends up under a regular share is not shown as owing anything.
  assert.equal(ledger(nights(), 'N', { parker: { arrangement: 'weekend-volunteer' } }).people.find(entry => entry.person === 'Parker').weekendExtra, 0);
  assert.equal(statSheet('Jordan', { assignments: nights(), directory: { taylor: { arrangement: 'weekend-only' }, jordan: { arrangement: 'weekend-volunteer' } } }).weekendExtra, 2);
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
