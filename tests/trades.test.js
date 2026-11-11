import test from 'node:test';
import assert from 'node:assert/strict';
import { AGREED_STATUS, EXCHANGE_AGREED, POLICY, assignmentKey, committedKeys, minutesByWeek, projectRoster } from '../src/model.js';
import { applyMoves, checkExchange, describe, exchangeCredits, findOptions } from '../src/trades.js';

// Two weeks of nights in November 2026. Nov 8 is a Sunday. Everyone is at 36 hours in the first week except Casey at 24.
const row = (date, shift, person, role = '') => { const item = { date, shift, person, ...(role ? { role } : {}) }; return { ...item, key: assignmentKey(item) }; };
const roster = [
  row('2026-11-09', 'N', 'Avery'), row('2026-11-10', 'N', 'Avery'), row('2026-11-13', 'N', 'Avery', 'charge'),
  row('2026-11-16', 'N', 'Avery'), row('2026-11-17', 'N', 'Avery'), row('2026-11-18', 'N', 'Avery'),
  row('2026-11-08', 'N', 'Blair'), row('2026-11-11', 'N', 'Blair'), row('2026-11-12', 'N', 'Blair'), row('2026-11-19', 'N', 'Blair'), row('2026-11-20', 'N', 'Blair'),
  row('2026-11-08', 'N', 'Casey'), row('2026-11-09', 'N', 'Casey'), row('2026-11-15', 'N', 'Casey'), row('2026-11-16', 'N', 'Casey'), row('2026-11-17', 'N', 'Casey'),
  row('2026-11-11', 'N', 'Drew', 'charge'), row('2026-11-12', 'N', 'Drew'), row('2026-11-13', 'N', 'Drew'), row('2026-11-20', 'N', 'Drew'),
  row('2026-11-09', 'D', 'Emery'), row('2026-11-10', 'D', 'Emery'), row('2026-11-11', 'D', 'Emery')
];
const at = (date, shift, person) => roster.find(item => item.key === assignmentKey({ date, shift, person }));
const friday = at('2026-11-13', 'N', 'Avery'), world = { roster, directory: {}, policy: POLICY, committed: [], today: '2026-11-09' };
const check = (moves, extra = {}) => checkExchange({ ...world, ...extra, moves });

test('a swap inside one pay week changes nobody’s hours, and is described in sentences', () => {
  const moves = [{ key: friday.key, to: 'Blair' }, { key: at('2026-11-11', 'N', 'Blair').key, to: 'Avery' }];
  const result = check(moves);
  assert.equal(result.status, 'check');                                  // Blair has not been charge on this schedule
  assert.deepEqual(result.problems, []);
  assert.deepEqual(describe(result, 'Avery'), ['You take Blair’s Wed, Nov 11 night.', 'Blair takes your Fri, Nov 13 night.', 'Nobody’s weekly hours change.', 'Rest and overlap checks pass.',
    'Charge cover needs checking: Blair is not listed as charge on this schedule.']);
  assert.equal(applyMoves(roster, moves).find(item => item.key === friday.key).person, 'Blair');
});

test('a swap across two weeks moves hours between them, and the limit decides', () => {
  const moves = [{ key: friday.key, to: 'Blair' }, { key: at('2026-11-19', 'N', 'Blair').key, to: 'Avery' }];
  const blocked = check(moves);
  assert.equal(blocked.status, 'blocked');
  assert.deepEqual(blocked.people.find(part => part.person === 'Avery').weeks, [{ week: '2026-11-08', before: 2160, after: 1440 }, { week: '2026-11-15', before: 2160, after: 2880 }]);
  assert.ok(blocked.problems.includes('Avery would be at 48 hours in the week of Nov 15. The limit entered is 40.'));
  const allowed = check(moves, { policy: { ...POLICY, overLimit: 'warn' } });
  assert.equal(allowed.status, 'check');
  assert.match(describe(allowed, 'Avery').join(' '), /Hours: You 36 → 24 in the week of Nov 8, 36 → 48 in the week of Nov 15/);
  assert.ok(allowed.notes.includes('Avery would work 4 days in a row.'));
});

test('picking up is allowed up to the limit and not past it', () => {
  assert.equal(check([{ key: at('2026-11-12', 'N', 'Drew').key, to: 'Casey' }]).status, 'ok');          // 24 to 36
  assert.match(check([{ key: at('2026-11-12', 'N', 'Drew').key, to: 'Avery' }]).problems[0], /Avery would be at 48 hours/);
});

test('rest, overlap and the kind of shift are checked for the person taking a shift', () => {
  const tuesday = at('2026-11-10', 'N', 'Avery');
  assert.match(check([{ key: tuesday.key, to: 'Emery' }]).problems[0], /Emery is not listed on any night shift, and no qualification for it is recorded/);
  const recorded = check([{ key: tuesday.key, to: 'Emery' }], { directory: { emery: { person: 'Emery', status: 'Staff', skills: ['D', 'N'] } } });
  assert.equal(recorded.status, 'blocked');
  assert.ok(recorded.problems.some(text => /Emery would have under 8 hours between/.test(text)));
  assert.match(check([{ key: at('2026-11-09', 'N', 'Casey').key, to: 'Avery' }]).problems[0], /Avery would be on two shifts at once on Nov 9/);
});

test('a charge shift taken by someone never listed as charge is flagged, not blocked', () => {
  const toCasey = check([{ key: friday.key, to: 'Casey' }]);
  assert.equal(toCasey.status, 'check');
  assert.match(toCasey.cautions[0], /^Charge cover needs checking: Casey/);
  assert.deepEqual(check([{ key: at('2026-11-20', 'N', 'Blair').key, to: 'Casey' }]).cautions, []);
});

test('a shift already agreed elsewhere, a past shift and a changed schedule are refused', () => {
  assert.match(check([{ key: friday.key, to: 'Casey' }], { committed: [friday.key] }).problems[0], /already part of an agreed request/);
  assert.match(check([{ key: friday.key, to: 'Casey' }], { today: '2026-11-14' }).problems[0], /has already passed/);
  assert.equal(check([{ key: 'gone', to: 'Casey' }]).status, 'blocked');
  assert.match(check([{ key: friday.key, to: 'Avery' }]).problems[0], /Avery already has/);
});

test('three people can each hand a shift to the next when none of them could simply pick one up', () => {
  for (const [shift, taker] of [[friday, 'Blair'], [at('2026-11-08', 'N', 'Blair'), 'Drew'], [at('2026-11-12', 'N', 'Drew'), 'Avery']])
    assert.match(check([{ key: shift.key, to: taker }], { today: '2026-11-07' }).problems.join(' '), /would be at 48 hours/, taker + ' alone');
  const loop = check([{ key: friday.key, to: 'Blair' }, { key: at('2026-11-08', 'N', 'Blair').key, to: 'Drew' }, { key: at('2026-11-12', 'N', 'Drew').key, to: 'Avery' }], { today: '2026-11-07' });
  assert.deepEqual(loop.problems, []);
  assert.ok(loop.people.every(part => part.weeks.length === 0));
});

test('the finder puts what keeps everyone’s weekly hours first, then what moves hours, then cover', () => {
  const found = findOptions({ ...world, target: friday, limit: 3, loops: true });
  assert.equal(findOptions({ ...world, target: friday }).counts.loops, undefined);            // the wide loop search runs only on request
  // Swaps inside the pay week leave every week as it was. Swaps across weeks are listed apart.
  assert.ok(found.keep.length > 0 && found.keep.every(option => option.neutral && option.people.every(part => part.weeks.length === 0)));
  assert.ok(found.swaps.every(option => !option.neutral));
  assert.ok(found.keep.some(option => option.moves[1].key === at('2026-11-11', 'N', 'Blair').key));
  // Three people in one pay week, each handing a shift to the next, are found without asking for the wide search.
  const quick = findOptions({ ...world, target: friday });
  assert.ok(quick.keepLoops.length > 0 && quick.keepLoops.every(option => option.moves.length === 3 && option.neutral));
  assert.deepEqual(found.pickups.map(option => option.moves[0].to), ['Casey']);
  assert.ok(found.counts.chains > 0 && found.keep.length <= 3);
  // A chain exists because Blair could not simply pick the shift up, but can once someone takes one of Blair's.
  assert.ok(found.chains.every(option => option.moves.length === 2 && option.moves[0].key === friday.key));
  assert.ok(found.chains.some(option => option.moves[0].to === 'Blair'));
  // Every option returned passes the whole-exchange check on its own.
  for (const option of ['keep', 'keepLoops', 'swaps', 'pickups', 'chains', 'loops'].flatMap(kind => found[kind])) assert.notEqual(check(option.moves).status, 'blocked');
  // Someone who said they could work that night comes first.
  const said = findOptions({ ...world, target: friday, offers: [{ person: 'Drew', date: '2026-11-20', shift: 'N' }, { person: 'Casey', date: '2026-11-13', shift: 'N' }] });
  assert.equal(said.pickups[0].said, true);
  // Late in the week there is less left to swap with, and once the shift has passed there is nothing.
  assert.ok(findOptions({ ...world, today: '2026-11-13', target: friday }).counts.keep < quick.counts.keep);
  assert.deepEqual(findOptions({ ...world, today: '2026-11-14', target: friday, loops: true }).counts, { keep: 0, keepLoops: 0, swaps: 0, pickups: 0, chains: 0, loops: 0 });
  // Two people on the same shift cannot "swap" it with each other.
  assert.match(check([{ key: friday.key, to: 'Drew' }, { key: at('2026-11-13', 'N', 'Drew').key, to: 'Avery' }]).problems.join(' '), /would give up and take the same shift/);
});

test('the pay week can start on any day', () => {
  const saturdayNight = row('2026-11-14', 'N', 'Avery');
  assert.deepEqual(minutesByWeek(saturdayNight), [['2026-11-08', 300], ['2026-11-15', 420]]);
  assert.deepEqual(minutesByWeek(saturdayNight, 1), [['2026-11-09', 720]]);
  const moves = [{ key: friday.key, to: 'Drew' }, { key: at('2026-11-20', 'N', 'Drew').key, to: 'Avery' }];
  assert.deepEqual(check(moves, { policy: { ...POLICY, weekStartsOn: 1 } }).people.find(part => part.person === 'Avery').weeks.map(item => item.week), ['2026-11-09', '2026-11-16']);
});

test('an agreed exchange holds its shifts, shows in the projected roster and is credited as help', () => {
  const exchange = { id: 'x1', by: 'Avery', status: EXCHANGE_AGREED, moves: [{ key: friday.key, from: 'Avery', to: 'Blair', date: '2026-11-13' }, { key: at('2026-11-08', 'N', 'Blair').key, from: 'Blair', to: 'Casey', date: '2026-11-08' }] };
  assert.deepEqual(committedKeys([exchange]), exchange.moves.map(move => move.key));
  assert.deepEqual(committedKeys([{ ...exchange, status: 'Waiting for Blair' }]), []);
  assert.equal(projectRoster(roster, [exchange]).find(item => item.key === friday.key).person, 'Blair');
  assert.deepEqual(exchangeCredits([exchange]), [{ kind: 'trade', recipient: 'Blair', status: AGREED_STATUS, from: { date: '2026-11-13' } }, { kind: 'coverage', recipient: 'Casey', status: AGREED_STATUS, from: { date: '2026-11-08' } }]);
});
