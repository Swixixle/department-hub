import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendar, reconcileNames } from '../src/calendar.js';
import { parsePage } from '../src/importer.js';
import { inkMask, longStrokes, tintName, backgroundColor, tightBox } from '../src/pixels.js';
import { minutesByWeek, shiftTimes } from '../src/model.js';

// A two-week calendar as OCR words. Columns are 200 wide, rows 300 tall, and the page starts on Sunday 11/29.
const word = (text, x, y, confidence = 96) => ({ text, x0: x, y0: y, x1: x + text.length * 16, y1: y + 26, confidence });
function page({ cells, header = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], label }) {
  const words = header.map((name, column) => name && word(name, 160 + column * 200, 40)).filter(Boolean);
  if (label) words.push(word(label, 300, 5));
  const dates = ['11/29', '11/30', '12/1', '12/2', '12/3', '12/4', '12/5', '12/6', '12/7', '12/8', '12/9', '12/10', '12/11', '12/12'];
  dates.forEach((date, index) => {
    const x = 100 + (index % 7) * 200, y = 100 + Math.floor(index / 7) * 300;
    words.push(word(date, x, y));
    (cells[date] || ['AVERY', 'BLAIR', 'CASEY']).forEach((line, row) => {
      let cursor = x;
      for (const piece of line.split(' ')) { words.push(word(piece, cursor, y + 45 + row * 45)); cursor += piece.length * 16 + 12; }
    });
  });
  return words;
}
const source = { page: 'hash', file: 'calendar.png' };
const today = '2026-11-11';

test('calendar page gets its year from the weekday columns and one row per printed name', () => {
  const result = parseCalendar(page({ cells: {} }), source, { today });
  assert.equal(result.layout, 'calendar grid');
  assert.deepEqual([result.dates[0], result.dates.at(-1), result.dates.length], ['2026-11-29', '2026-12-12', 14]);
  assert.equal(result.assignments.length, 42);
  assert.equal(result.shift, 'N');
  assert.equal(result.shiftGuessed, true);
  assert.deepEqual(result.assignments.filter(row => row.date === '2026-12-01').map(row => row.person), ['Avery', 'Blair', 'Casey']);
  assert.equal(result.flags.length, 0);
  assert.equal(parsePage(page({ cells: {} }), source, { today }).layout, 'calendar grid');
});

test('four names a cell reads as a day page, a written label wins, and the caller can set the shift', () => {
  const cells = Object.fromEntries(['11/29', '11/30', '12/1', '12/2', '12/3', '12/4', '12/5', '12/6', '12/7', '12/8', '12/9', '12/10', '12/11', '12/12']
    .map(date => [date, ['AVERY', 'BLAIR', 'CASEY', 'DREW']]));
  assert.equal(parseCalendar(page({ cells }), source, { today }).shift, 'D');
  const labelled = parseCalendar(page({ cells, label: 'Night' }), source, { today });
  assert.equal(labelled.shift, 'N');
  assert.equal(labelled.shiftGuessed, false);
  assert.equal(parseCalendar(page({ cells: {} }), source, { today, shift: 'D' }).shift, 'D');
});

test('a missing Sunday header and a misread date do not move the calendar', () => {
  const words = page({ cells: {}, header: [null, 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }).filter(item => item.text !== '12/3');
  words.push(word('12/47', 100 + 4 * 200, 100));
  const result = parseCalendar(words, source, { today });
  assert.deepEqual([result.dates[0], result.dates.at(-1)], ['2026-11-29', '2026-12-12']);
  assert.deepEqual(result.assignments.filter(row => row.date === '2026-12-03').map(row => row.person), ['Avery', 'Blair', 'Casey']);
});

test('handwriting is ignored, initials and partial hours are kept, and highlighter sets the role', () => {
  const cells = {
    '11/30': ['AVERY', 'JORDAN K', 'CASEY 7-3'],
    '12/1': ['AVERY', 'BLAIR', 'CASEY', 'Lee Jn', 'ivtc student'],
    '12/2': ['AVERY', 'JORDAN K7-3', 'CASEY']
  };
  const tintOf = ([x0, y0]) => (y0 - 100) % 300 === 45 ? 'pink' : (y0 - 100) % 300 === 90 ? 'green' : null;
  const result = parseCalendar(page({ cells }), source, { today, tintOf });
  const on = date => result.assignments.filter(row => row.date === date);
  assert.deepEqual(on('2026-11-30').map(row => [row.person, row.role, row.hours]),
    [['Avery', 'charge', undefined], ['Jordan K', 'icu', undefined], ['Casey', undefined, '7-3']]);
  assert.deepEqual(on('2026-12-01').map(row => row.person), ['Avery', 'Blair', 'Casey']);
  assert.deepEqual(on('2026-12-02').map(row => [row.person, row.hours]), [['Avery', undefined], ['Jordan K', '7-3'], ['Casey', undefined]]);
});

test('a struck name is dropped and its cell is flagged, and a short cell is flagged', () => {
  const cells = { '12/7': ['AVERY', 'BLAIR', 'CASEY'], '12/9': ['AVERY', 'BLAIR'] };
  // A pen stroke through the second line of the 12/7 cell (column 1, second week).
  const strokesIn = region => region.x0 < 300 && region.x1 > 300 && region.y0 > 380
    ? [{ x0: 300, x1: 380, y: 400 + 90 + 13, length: 80 }] : [];
  const result = parseCalendar(page({ cells }), source, { today, strokesIn });
  assert.deepEqual(result.assignments.filter(row => row.date === '2026-12-07').map(row => row.person), ['Avery', 'Casey']);
  const open = result.flags.filter(flag => flag.status === 'open').map(flag => [flag.draft.date, flag.message.slice(0, 14)]);
  assert.deepEqual(open, [['2026-12-07', 'A name is cros'], ['2026-12-09', 'Fewer names we']]);
  assert.equal(result.flags[0].draft.shift, 'N');
});

test('a low-confidence name is held for review with the reading filled in', () => {
  const words = page({ cells: {} });
  words.find(item => item.text === 'CASEY').confidence = 40;
  const result = parseCalendar(words, source, { today });
  assert.equal(result.assignments.length, 41);
  assert.deepEqual(result.flags.map(flag => [flag.draft.date, flag.draft.person]), [['2026-11-29', 'Casey']]);
});

test('name clean-up prefers the spaced form and asks about near misses', () => {
  const rows = [...Array(4).fill('Jordan K'), ...Array(4).fill('Jordan'), ...Array(5).fill('Harper'), 'Jordank', 'Harpar', 'Lee', 'Sam'].map(person => ({ person }));
  const { rows: fixed, changes } = reconcileNames(rows);
  assert.deepEqual(changes.map(change => [change.from, change.to, change.kind]), [['Jordank', 'Jordan K', 'spacing'], ['Harpar', 'Harper', 'similar']]);
  assert.deepEqual(fixed.slice(-4).map(row => row.person), ['Jordan K', 'Harper', 'Lee', 'Sam']);
  // A frequent run-together misread still gives way to the spaced name.
  const flipped = reconcileNames([...Array(4).fill('Jordank'), 'Jordan K'].map(person => ({ person })));
  assert.ok(flipped.rows.every(row => row.person === 'Jordan K'));
});

test('partial shifts count their real hours', () => {
  assert.deepEqual([shiftTimes({ shift: 'D', hours: '7-3:30' }).start, shiftTimes({ shift: 'D', hours: '7-3:30' }).end], ['07:00', '15:30']);
  assert.deepEqual(minutesByWeek({ date: '2026-12-02', shift: 'D', hours: '7-3' }), [['2026-11-29', 480]]);
  assert.deepEqual(minutesByWeek({ date: '2026-12-05', shift: 'N', hours: '7-3' }), [['2026-11-29', 300], ['2026-12-06', 180]]);
  assert.deepEqual(minutesByWeek({ date: '2026-12-02', shift: 'D' }), [['2026-11-29', 720]]);
});

test('pixel helpers separate ink from highlighter and find a strike-through', () => {
  const width = 120, height = 40, data = new Uint8ClampedArray(width * height * 4);
  const paint = (x, y, [r, g, b]) => data.set([r, g, b, 255], (y * width + x) * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) paint(x, y, x < 60 ? [246, 182, 201] : [250, 249, 246]);
  for (let y = 12; y < 28; y++) for (const x of [10, 11, 20, 21, 30, 31, 70, 71, 80, 81, 90, 91]) paint(x, y, [20, 20, 20]);
  for (let x = 64; x < 100; x++) for (const y of [19, 20]) paint(x, y, [20, 20, 20]);
  const image = { data, width, height };
  const mask = inkMask(image);
  assert.equal(mask[20 * width + 10], 1);
  assert.equal(mask[20 * width + 15], 0);
  assert.equal(mask[5 * width + 40], 0);
  assert.deepEqual(longStrokes(mask, width, { x0: 0, y0: 0, x1: 60, y1: height }, 20), []);
  const strokes = longStrokes(mask, width, { x0: 60, y0: 0, x1: width, y1: height }, 20);
  assert.equal(strokes.length, 1);
  assert.ok(strokes[0].length >= 34);
  assert.equal(tintName(backgroundColor(image, tightBox(mask, width, [8, 4, 34, 36])), 0.03), 'pink');
  assert.equal(tintName(backgroundColor(image, tightBox(mask, width, [68, 4, 94, 36])), 0.03), null);
  assert.equal(tintName({ hue: 95, saturation: 0.14 }, 0.07), 'green');
  assert.equal(tintName({ hue: 205, saturation: 0.5 }, 0.07), 'blue');
  assert.equal(tintName({ hue: 32, saturation: 0.07 }, 0.07), null);
});
