import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGREED_STATUS, assignmentKey, committedKeys, evaluateChange, mergeAssignments, minutesByWeek, projectRoster } from '../src/model.js';
import { parseDate, parsePage } from '../src/importer.js';

function shift(date, code, person, sources = []) {
  const entry = { date, shift:code, person, sources };
  return { ...entry, key:assignmentKey(entry) };
}

test('Saturday night divides across the payroll boundary', () => {
  assert.deepEqual(minutesByWeek(shift('2026-11-14','N','Jordan')), [['2026-11-08',300],['2026-11-15',420]]);
});

test('clock change is reflected in actual elapsed hours', () => {
  assert.equal(minutesByWeek(shift('2026-10-31','N','Jordan')).reduce((n, [, m]) => n + m, 0), 13 * 60);
});

test('overlapping pages combine exact assignments and keep evidence', () => {
  const date = '2026-11-14';
  const rows = mergeAssignments([
    shift(date,'N','Jordan',[{page:'a',box:[1,2,3,4]}]),
    shift(date,'N','JORDAN',[{page:'b',box:[1,2,3,4]}])
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sources.length, 2);
});

test('trade checks the receiving employee and keeps unverified hours explicit', () => {
  const from = shift('2026-11-09','N','Jordan');
  const to = shift('2026-11-12','N','Sam');
  const directory = { jordan:{ status:'Staff', skills:['N'] }, sam:{ status:'Staff', skills:['N'] } };
  const payload = { roster:[from,to], from,to,kind:'trade',directory };
  assert.equal(evaluateChange(payload).status, 'review');
  assert.equal(evaluateChange({ ...payload, hoursVerified:true }).status, 'eligible');
  directory.sam.status = 'PRN';
  assert.equal(evaluateChange({ ...payload, hoursVerified:true }).status, 'blocked');
});

test('a 36-hour employee receiving an extra full shift exceeds 40 hours', () => {
  const from = shift('2026-11-12','N','Jordan');
  const roster = [from, ...['09','10','11'].map(day => shift('2026-11-' + day,'N','Sam'))];
  const directory = { jordan:{status:'Staff',skills:['N']},sam:{status:'Staff',skills:['N']} };
  assert.equal(evaluateChange({ roster,from,recipient:'Sam',kind:'coverage',directory,hoursVerified:true }).status, 'blocked');
});

test('invalid dates are flagged and explicit dates are normalized', () => {
  assert.equal(parseDate('2026-02-30'),null);
  assert.equal(parseDate('11/9/2026'),'2026-11-09');
});

test('date-row parsing attaches a source and flags doubtful cells', () => {
  const word = (text,x,y,confidence=99) => ({text,x0:x,y0:y,x1:x+60,y1:y+24,confidence});
  const result = parsePage([
    word('DATE',40,130), word('DAY',270,130), word('SHIFT',330,130),
    word('NIGHT',800,130), word('SHIFT',895,130), word('2026-11-09',40,200),
    word('Avery',270,200), word('/',338,200), word('Blair',395,200,40),
    word('Jordan',800,200)
  ],{page:'source',file:'test.png'});
  assert.deepEqual(result.assignments.map(row => row.person), ['Avery','Jordan']);
  assert.equal(result.flags.length,1);
  assert.equal(result.assignments[0].sources[0].page,'source');
});

const staff = skills => ({ status:'Staff', skills });
const nights = (person, ...days) => days.map(day => shift('2026-11-' + day,'N',person));

test('unknown staff details never hide an overlap or projected overtime', () => {
  const jordan = nights('Jordan','15','17','19');
  const morgan = nights('Morgan','15','17','20');
  const quinn = nights('Quinn','13','16','18');
  const roster = [...nights('Jordan','09','10','12'), ...jordan, ...morgan, ...quinn];
  const directory = { jordan:{ person:'Jordan', status:null, skills:[] }, morgan:{ person:'Morgan', status:null, skills:[] } };
  const overlap = evaluateChange({ roster, from:jordan[0], to:morgan[1], kind:'trade', directory });
  assert.equal(overlap.status, 'blocked');
  assert.match(overlap.reason, /overlaps/);
  const overtime = evaluateChange({ roster, from:jordan[0], to:quinn[0], kind:'trade', directory:{} });
  assert.equal(overtime.status, 'blocked');
  assert.match(overtime.reason, /overtime/);
  const sameWeek = evaluateChange({ roster, from:jordan[0], to:quinn[1], kind:'trade', directory:{} });
  assert.equal(sameWeek.status, 'review');
  assert.match(sameWeek.reason, /verification/);
});

test('a change that puts a night and a day back to back is blocked', () => {
  const jordan = nights('Jordan','15','17','19');
  const avery = ['15','18','20'].map(day => shift('2026-11-' + day,'D','Avery'));
  const directory = { jordan:staff(['D','N']), avery:staff(['D','N']) };
  const result = evaluateChange({ roster:[...jordan, ...avery], from:jordan[0], to:avery[1], kind:'trade', directory, hoursVerified:true });
  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /back to back/);
  const noRule = evaluateChange({ roster:[...jordan, ...avery], from:jordan[0], to:avery[1], kind:'trade', directory, hoursVerified:true,
    policy:{ overtimeLimitMinutes:2400, minimumRestMinutes:0 } });
  assert.equal(noRule.status, 'eligible');
});

test('a shift in an agreed request cannot be agreed again and its hours count', () => {
  const jordan = nights('Jordan','15','17','19');
  const quinn = nights('Quinn','16','18','20');
  const sam = [shift('2026-11-16','N','Sam'), shift('2026-11-19','N','Sam')];
  const roster = [...jordan, ...quinn, ...sam];
  const directory = { jordan:staff(['N']), quinn:staff(['N']), sam:staff(['N']) };
  const first = { id:'one', status:AGREED_STATUS, kind:'trade', from:jordan[0], to:quinn[0], recipient:'Quinn' };
  const waiting = { id:'two', status:'Awaiting reply', kind:'trade', from:jordan[0], to:sam[0], recipient:'Sam' };
  assert.deepEqual(committedKeys([first, waiting]), [jordan[0].key, quinn[0].key]);
  assert.deepEqual(committedKeys([first, waiting], 'one'), []);
  const again = evaluateChange({ roster:projectRoster(roster, [first, waiting]), from:jordan[0], to:sam[0], kind:'trade', directory,
    hoursVerified:true, committed:committedKeys([first, waiting]) });
  assert.equal(again.status, 'blocked');
  assert.match(again.reason, /already part of an agreed request/);

  // Sam agreed to cover a Jordan shift. That pickup is not in the imported roster yet, but it still counts.
  const pickup = { id:'three', status:AGREED_STATUS, kind:'coverage', from:jordan[1], recipient:'Sam' };
  const projected = projectRoster(roster, [pickup]);
  assert.equal(projected.find(item => item.key === jordan[1].key).person, 'Sam');
  assert.equal(roster.find(item => item.key === jordan[1].key).person, 'Jordan');
  const second = evaluateChange({ roster:projected, from:quinn[2], recipient:'Sam', kind:'coverage', directory, hoursVerified:true,
    committed:committedKeys([pickup]), policy:{ overtimeLimitMinutes:2400, minimumRestMinutes:480, allowPrnCoverage:true } });
  assert.equal(second.status, 'blocked');
  assert.match(second.reason, /overtime/);
  const withoutProjection = evaluateChange({ roster, from:quinn[2], recipient:'Sam', kind:'coverage', directory, hoursVerified:true });
  assert.equal(withoutProjection.status, 'eligible');
});
