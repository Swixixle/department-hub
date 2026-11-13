import test from 'node:test';
import assert from 'node:assert/strict';
import { newReport, addBed, setFields, screenHandoff, possibleNames, allowNotName, expired, expiresAt, WIPE_HOURS, parseDictation, digits,
  readVentWords, keepWord, maskPlan, sheetOf, validBed } from '../src/handoff.js';

// Everything here is invented. No real patient, bed or unit.
const T0 = Date.parse('2026-11-13T19:00:00Z');
const ok = result => { if (!result.ok) throw new Error(result.why || JSON.stringify(result.refused)); return result; };

test('a handoff is wiped 13 hours after it was started, and a bed is a short number, never a name', () => {
  const report = newReport(T0, 'N');
  assert.equal(WIPE_HOURS, 13);
  assert.equal(expiresAt(report), T0 + 13 * 3600000);
  assert.equal(expired(report, T0 + 13 * 3600000 - 1), false);
  assert.equal(expired(report, T0 + 13 * 3600000), true);
  assert.equal(expired(null), true);
  for (const bed of ['12', '412-2', '7B', 'ICU 4']) assert.ok(validBed(bed), bed);
  for (const bed of ['', 'Mr Jones', 'Bed 12 Smith family']) assert.equal(validBed(bed), false, bed);
  const two = ok(addBed(ok(addBed(report, '12')).report, '4')).report;
  assert.deepEqual(two.beds.map(bed => bed.bed), ['4', '12'], 'beds sort as numbers');
  assert.equal(addBed(two, '12').ok, false);
});

test('names, record numbers and birth dates are stopped; a bed number and an ordinary age are not', () => {
  for (const [text, sign] of [['MRN 00482913', 'a record or account number'], ['DOB 3/14/1961', 'a date of birth'], ['Mr. Alvarez in 412 needs a neb', 'a patient’s name'],
    ['John Kowalski, still on the vent', 'what may be a name'], ['94 yo on BiPAP', 'a patient’s age']]) {
    assert.ok(screenHandoff(text).some(item => item.sign === sign), text + ' → ' + sign);
  }
  for (const text of ['Bed 12 on VC-AC 14/18, Vt 450, PEEP 8, FiO2 40', 'Patient in bed 7 extubated to HFNC 40 L 50%', '72 yo, weaned to 2 L NC',
    'DuoNeb q4, next 0800. Passy Muir trial with SLP', 'Rapid Response at 0300, Chest XRay done']) {
    assert.deepEqual(screenHandoff(text), [], text);
  }
  // Its writer can say a flagged pair is not a name; that holds for this handoff only.
  assert.deepEqual(possibleNames('Hamilton C6 alarms; Hamilton Medical'), ['Hamilton Medical']);
  const report = allowNotName(newReport(T0), 'Hamilton Medical');
  assert.deepEqual(screenHandoff('Hamilton Medical vent', report.notNames), []);
});

test('fields go through the screen one by one; a refused field keeps its old value and says why', () => {
  let report = ok(addBed(newReport(T0), '12')).report;
  const bed = report.beds[0].id;
  report = ok(setFields(report, bed, { mode: 'PRVC', peep: '8', events: 'Desat to 84% at 0200, bagged, recovered', bogus: 'ignored' })).report;
  assert.deepEqual(report.beds[0].fields, { mode: 'PRVC', peep: '8', events: 'Desat to 84% at 0200, bagged, recovered' });
  const result = setFields(report, bed, { plan: 'Family (Maria Lopez) wants a call', peep: '10' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.refused.map(item => [item.key, item.found[0].words]), [['plan', 'Maria Lopez']]);
  assert.equal(result.report.beds[0].fields.peep, '10');
  assert.equal(result.report.beds[0].fields.plan, undefined);
  assert.deepEqual(sheetOf(result.report)[0].lines.map(([label]) => label), ['Mode', 'PEEP', 'Events this shift']);
});

test('dictation lands in the template, bed by bed, and nothing it cannot place is dropped', () => {
  assert.equal(digits('peep of eight, rate twenty-two'), 'peep of 8, rate 22');
  const said = 'Bed twelve, on the vent, mode PRVC, rate 14 over 18, tidal volume 450, PEEP 8, FiO2 40 percent. Last gas 7.36/44/78 at 0400. ' +
    'Treatments DuoNeb every four hours. Plan SBT in the morning. Bed 4 on high flow, flow 40 liters, oxygen 50 percent. Events desatted at 0200 with suctioning.';
  const beds = parseDictation(said);
  assert.deepEqual(beds.map(bed => bed.bed), ['12', '4']);
  assert.deepEqual(beds[0].fields, { support: 'Vent', mode: 'PRVC', rate: '14/18', vt: '450', peep: '8', fio2: '40', abg: '7.36/44/78 at 0400', treatments: 'DuoNeb every 4 hours', plan: 'SBT in the morning' });
  assert.deepEqual(beds[1].fields, { support: 'HFNC', flow: '40', fio2: '50', events: 'desatted at 0200 with suctioning' });
  const loose = parseDictation('Quiet night overall. Bed 9 mode CPAP PEEP 5 something odd here');
  assert.equal(loose[0].rest, 'Quiet night overall', 'words before the first bed are kept');
  assert.equal(loose[1].fields.peep, '5');
  assert.match(loose[1].rest, /something odd here/);
});

const word = (text, x0, y0, w = 40, h = 20, confidence = 92) => ({ text, confidence, bbox: { x0, y0, x1: x0 + w, y1: y0 + h } });

test('a vent screen’s labels take the number beside or below them; nothing is guessed', () => {
  const screen = [word('PRVC', 10, 5), word('f', 10, 60, 10), word('14', 60, 60), word('VT', 150, 60), word('450', 150, 90), word('PEEP', 260, 60), word('8', 330, 60, 15),
    word('O2', 400, 60, 25), word('40%', 440, 60), word('Ppeak', 10, 160), word('27', 80, 160)];
  assert.deepEqual(readVentWords(screen), { mode: 'PRVC', rate: '14', vt: '450', peep: '8', fio2: '40' });
  assert.deepEqual(readVentWords([word('PEEP', 10, 10)]), {}, 'a label with no number near it is left out');
});

test('a chart photo keeps only clinical words and short numbers; names, dates and record lines are boxed out', () => {
  for (const kept of ['PEEP', '8', '40%', '7.38/42/80/24', 'DuoNeb', 'q4', '0400', 'FiO2']) assert.ok(keepWord(kept), kept);
  for (const boxed of ['Kowalski', '03/14/61', '00482913', 'Jennifer']) assert.equal(keepWord(boxed), false, boxed);
  assert.equal(keepWord('PEEP', 40), false, 'a word the reader was unsure of is boxed');
  const lines = [[word('Name:', 0, 0, 50), word('Kowalski,', 60, 0), word('J', 110, 0, 10)], [word('MRN', 0, 30), word('4829', 50, 30)],
    [word('PEEP', 0, 60), word('8', 50, 60, 10), word('FiO2', 70, 60), word('40%', 120, 60)]];
  const plan = maskPlan(lines.flatMap((line, index) => line.map(item => ({ ...item, line: index }))));
  assert.equal(plan.kept, 4, 'only the settings line is kept');
  assert.equal(plan.boxed, 5, 'the name line and the record line are boxed whole, even the short number after MRN');
  assert.ok(plan.boxes.every(box => box.w > 0 && box.h > 0));
});
