import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignmentKey, evaluateChange, mergeAssignments, minutesByWeek } from '../src/model.js';
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
