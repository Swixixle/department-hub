import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, linkNames, mergePhoneReads, parsePhoneList, personId, phoneLink } from '../src/contacts.js';
import { withoutRules } from '../src/pixels.js';
import { assignmentKey, evaluateChange } from '../src/model.js';

// A telephone list as OCR words. Every number is a 555-01xx number, which reaches no one.
// The page is tilted: each step to the right sits lower, as in a hand-held photo.
const tilt = 0.03;
const word = (text, x, y, confidence = 95) => ({ text, x0: x, y0: y + x * tilt, x1: x + text.length * 15, y1: y + x * tilt + 26, confidence });
function listPage(rows) {
  const words = [word('EMPLOYEE', 300, 60), word('TELEPHONE', 440, 60), word('LIST', 600, 60)];
  let y = 140;
  for (const row of rows) {
    if (typeof row === 'string') { let x = 480; for (const piece of row.split(' ')) { words.push(word(piece, x, y)); x += piece.length * 15 + 12; } }
    else {
      let x = 200;
      for (const piece of row[0].split(' ')) { words.push(word(piece, x, y)); x += piece.length * 15 + 12; }
      if (row[1]) words.push(word(row[1], 760, y));
      if (row[2]) words.push(word(row[2], 1060, y, row[3] ?? 95));
    }
    y += 60;
  }
  return words;
}
const source = { page: 'hash', file: 'list.png' };
const rows = [
  ['EMPLOYEE', 'OFFICE', 'CELL'],
  ['LANE, AVERY', '', '317.555.0100'], ['DE LA CRUZ, BLAIR', '', '317.5550101'], ['VALE-STONE, FRANCESCA', '', '317.555.0102'],
  ['AMES, ROBIN – MANAGER', '5501', '317.555.0103'],
  'CONTRACT/RESERVE STAFF', ['EMPLOYEE', '', 'CELL'], ['MARSH, JORDAN', '', '317.555.0104'], ['Il COLE, MORGAN', '', '317.555.0105'],
  'PRN STAFF', ['EMPLOYEE', '', 'CELL'], ['POE, RILEY', '', '317.555.0106'],
  'STUDENTS (RTA’s)', ['EMPLOYEE', '', 'CELL'], ['BIRCH, TAYLOR', '', '317.555.01'],
  ['DR. WREN', '5502', ''], 'MEDICAL DIRECTOR'
];

test('a tilted telephone list keeps each number with its own name and section', () => {
  const result = parsePhoneList(listPage(rows), source);
  assert.equal(result.layout, 'phone list');
  assert.deepEqual(result.people.map(person => [person.last, person.first, person.group, person.cell, person.office]), [
    ['Lane', 'Avery', 'Staff', '3175550100', ''], ['De La Cruz', 'Blair', 'Staff', '3175550101', ''], ['Vale-Stone', 'Francesca', 'Staff', '3175550102', ''],
    ['Ames', 'Robin', 'Leadership', '3175550103', '5501'], ['Marsh', 'Jordan', 'Contract', '3175550104', ''], ['Cole', 'Morgan', 'Contract', '3175550105', ''],
    ['Poe', 'Riley', 'PRN', '3175550106', ''], ['Birch', 'Taylor', 'Student', '31755501', ''], ['Wren', '', 'Physician', '', '5502']
  ]);
  assert.equal(result.people[3].role, 'Manager');
  assert.equal(result.people.at(-1).role, 'Medical Director');
  assert.deepEqual(result.people.filter(person => person.check).map(person => person.last), ['Birch']);
  assert.equal(result.sections, 3);
  assert.equal(parsePhoneList(listPage(rows).filter(item => !/\d/.test(item.text)), source), null);
});

test('a number is trusted only when two readings agree', () => {
  const first = parsePhoneList(listPage(rows), source);
  const changed = rows.map(row => Array.isArray(row) && row[0] === 'MARSH, JORDAN' ? ['MARSH, JORDAN', '', '317.555.0194'] : row);
  const second = parsePhoneList(listPage(changed).filter(item => item.text !== 'PRN'), source);
  const merged = mergePhoneReads(second, first);
  const byName = Object.fromEntries(merged.people.map(person => [person.last, person]));
  assert.equal(byName.Lane.check, false);
  assert.equal(byName.Marsh.check, true);
  assert.equal(byName.Birch.check, true);
  assert.equal(byName.Wren.check, false);
  assert.equal(byName.Poe.group, 'PRN');
  assert.equal(merged.people.length, first.people.length);
  assert.ok(mergePhoneReads(first, null).people.every(person => person.check));
});

test('schedule names are matched to people, and guesses are kept apart', () => {
  const person = (last, first, group = 'Staff') => { const entry = { last, first, group }; return { ...entry, id: personId(entry) }; };
  const people = [person('Lane', 'Avery'), person('Moss', 'Jordan'), person('Kerr', 'Jordan', 'Student'), person('Vale', 'Francesca'), person('Shaw', 'Samantha'),
    person('Park', 'Andrew'), person('Reyes', 'Nicolette')];
  const { links, guessed } = linkNames(['Avery', 'Jordan', 'Jordan K', 'Sam', 'Nico', 'Drew', 'Nobody'], people);
  assert.equal(links.avery, 'lane,avery');
  assert.equal(links['jordan k'], 'kerr,jordan');
  assert.equal(links.jordan, 'moss,jordan');
  assert.equal(links.sam, 'shaw,samantha');
  assert.equal(links.nico, 'reyes,nicolette');
  assert.equal(links.drew, undefined);
  assert.equal(links.nobody, undefined);
  assert.deepEqual(guessed.sort(), ['nico', 'sam']);
});

test('phone links and formatting', () => {
  assert.equal(formatPhone('3175550100'), '317.555.0100');
  assert.equal(formatPhone('317555'), '317555');
  assert.equal(phoneLink('tel', '317.555.0100'), 'tel:+13175550100');
  assert.equal(phoneLink('sms', '3175550100', 'Can you trade?'), 'sms:+13175550100?&body=Can%20you%20trade%3F');
  assert.equal(phoneLink('tel', '555'), null);
});

test('table rules are erased and letters are kept', () => {
  const width = 200, height = 120, mask = new Uint8Array(width * height);
  for (let x = 10; x < 190; x++) mask[20 * width + x] = 1;
  for (let y = 10; y < 110; y++) mask[y * width + 100] = 1;
  for (let x = 40; x < 60; x++) mask[60 * width + x] = 1;
  for (let y = 50; y < 80; y++) mask[y * width + 40] = 1;
  const clean = withoutRules(mask, width, height);
  assert.equal(clean[20 * width + 50], 0);
  assert.equal(clean[40 * width + 100], 0);
  assert.equal(clean[60 * width + 50], 1);
  assert.equal(clean[70 * width + 40], 1);
});

test('students are kept out of trades and coverage', () => {
  const shift = (date, person) => { const entry = { date, shift: 'D', person, sources: [] }; return { ...entry, key: assignmentKey(entry) }; };
  const from = shift('2026-12-02', 'Avery'), to = shift('2026-12-03', 'Taylor');
  const directory = { avery: { status: 'Staff', skills: ['D'] }, taylor: { status: 'Student', skills: ['D'] }, jordan: { status: 'Contract', skills: ['D'] } };
  assert.match(evaluateChange({ roster: [from, to], from, to, kind: 'trade', directory, hoursVerified: true }).reason, /Students/);
  assert.equal(evaluateChange({ roster: [from, to], from, recipient: 'Jordan', kind: 'coverage', directory, hoursVerified: true }).status, 'eligible');
});
