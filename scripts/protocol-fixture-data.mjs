#!/usr/bin/env node
// Optional. Rewrites the expected reading of each invented PDF from what the reader returns now.
// Run it only after deliberately changing a fixture or the reader, then read the diff: the tests
// compare every later reading with these files, so whatever is written here becomes "correct".
import { writeFileSync } from 'node:fs';
import { passagesIn } from '../src/pdftext.js';
import { loadFixture, expectedPath, fixturePath } from '../tests/protocol-kit.mjs';

export const slim = extraction => ({ format: extraction.format, emptyPages: extraction.emptyPages, pages: extraction.pages.map(page => ({ number: page.number, drawn: page.drawn,
  blocks: page.blocks.map(block => ({ anchor: block.anchor, kind: block.kind, ...(block.running ? { running: true } : {}), ...(block.figure ? { figure: true } : {}), under: block.under, hash: block.hash, box: block.box,
    ...(block.kind === 'table' ? { columns: block.columns, rows: block.rows.map(row => ({ anchor: row.anchor, hash: row.hash, cells: row.cells, text: row.text })) } : { text: block.text }) })) })) });

// The mapped answers for the invented protocol, written once here and resolved against each revision's own reading.
// A link is written as the opening words of the passage it means. It is looked up in that revision and stored as
// that revision's digest, anchor and text hash, so a mapping for one revision can never be read against another.
export function authorMapping(number, extraction, digest) {
  const two = number === 2, lead = two ? 'Charge Educator' : 'Simulation Lead';
  const value = { adult: two ? '14' : '12', adultTop: two ? '22' : '20', pediatricRecheck: two ? '4' : '5', serviced: two ? '48' : '24' };
  const places = passagesIn(extraction).filter(passage => !passage.running && !passage.figure && passage.kind !== 'heading');
  const link = (role, opening) => {
    const found = places.filter(passage => passage.text.startsWith(opening));
    if (found.length !== 1) throw new Error('Revision ' + number + ': "' + opening + '" matches ' + found.length + ' passages');
    return { role, digest, anchor: found[0].anchor, hash: found[0].hash };
  };
  const shared = [link('order', 'A written drill order'), link('qualification', 'Only a therapist'), link('exception', 'Do not start the drill if'), link('stop', 'Stop the drill at once'), link('escalation', 'After stopping, call')];
  const whole = ['rule', 'order', 'qualification', 'exception', 'stop', 'escalation'];
  return { format: 'department-hub-protocol-mapping-v1', note: 'Synthetic test material — NOT FOR CLINICAL USE. Mapped answers for the invented protocol RT-TRAIN-014, revision ' + number + '.', revision: digest,
    subject: ['blue trainer', 'bellows', 'drill', 'rt-train-014'],
    facts: {
      age: { name: 'the age band', ask: 'Is the manikin adult or pediatric?', options: [
        { value: 'adult', label: 'Adult (18 years and over)', said: ['adult', 'adults', 'grown up', '18 and over'] },
        { value: 'pediatric', label: 'Pediatric (under 18 years)', said: ['pediatric', 'paediatric', 'peds', 'child', 'children', 'kid', 'kids', 'under 18'] }] },
      order: { name: 'whether a written drill order is on file', ask: 'Is a written drill order on file?', options: [
        { value: 'yes', label: 'A written order is on file', said: ['with an order', 'with a written order', 'order on file', 'have an order', 'has an order', 'got an order', 'there is an order'] },
        { value: 'no', label: 'No written order', said: ['no order', 'without an order', 'without order', 'verbal request', 'verbal order', 'not ordered', 'no written order', 'not on file'] }] } },
    topics: [
      { id: 'start', title: 'Starting the drill', said: ['start', 'starting rate', 'begin', 'what rate', 'how fast', 'initial rate', 'set the rate', 'highest rate', 'recheck'], needs: ['age', 'order'], bundles: [
        { id: 'start-adult', title: 'Starting an adult drill', when: { age: 'adult', order: 'yes' }, requires: whole,
          plain: { interpretation: 'Start an adult drill at ' + value.adult + ' mk/min.', explanation: 'Recheck after 10 minutes. At each recheck raise the rate by 2 mk/min while the green lamp stays lit, and never go above ' + value.adultTop + ' mk/min.' },
          links: [link('rule', 'Age band: Adult'), link('rule', 'For an adult manikin'), ...shared] },
        { id: 'start-pediatric', title: 'Starting a pediatric drill', when: { age: 'pediatric', order: 'yes' }, requires: whole,
          plain: { interpretation: 'Start a pediatric drill at 6 mk/min, with the small cuff fitted.', explanation: 'Recheck after ' + value.pediatricRecheck + ' minutes. At each recheck raise the rate by 1 mk/min while the green lamp stays lit, and never go above 10 mk/min.' },
          links: [link('rule', 'Age band: Pediatric'), link('rule', 'For a pediatric manikin'), ...(two ? [link('exception', 'Do not run a pediatric drill')] : []), ...shared] },
        { id: 'start-no-order', title: 'No written order', when: { order: 'no' }, requires: ['order'],
          plain: { interpretation: 'Do not start. A written drill order is required first.', explanation: 'A verbal request is not a drill order. The order comes from the ' + lead + '.' },
          links: [link('order', 'A written drill order')] }] },
      { id: 'not-start', title: 'When the drill must not be started', said: ['must not', 'not start', 'not be started', 'contraindication', 'contraindications', 'contraindicated', 'amber', 'amber lamp', 'seal lamp', 'lamp is lit', 'serviced', 'servicing', 'when not'], needs: [], bundles: [
        { id: 'not-start', title: 'When the drill must not be started', requires: ['exception'],
          plain: { interpretation: 'Do not start if the amber seal lamp is lit, or if the bellows was serviced within the last ' + value.serviced + ' hours.', explanation: 'This applies to adult and pediatric drills.' + (two ? ' A pediatric drill is also not run with the large cuff fitted.' : '') },
          links: [link('exception', 'Do not start the drill if'), ...(two ? [link('exception', 'Do not run a pediatric drill')] : [])] }] },
      { id: 'stop', title: 'Stopping the drill and who to call', said: ['stop', 'stopping', 'red lamp', 'gauge', 'who do i call', 'who to call', 'who should i call', 'escalate', 'escalation', 'goes wrong'], needs: [], bundles: [
        { id: 'stop', title: 'When to stop and who to call', requires: ['stop', 'escalation'],
          plain: { interpretation: 'Stop at once if the red lamp lights or the gauge reads above 30 marks.', explanation: 'Then call the ' + lead + '. If there is no answer within 5 minutes, call the Education Supervisor.' },
          links: [link('stop', 'Stop the drill at once'), link('escalation', 'After stopping, call')] }] },
      { id: 'who', title: 'Who may run the drill', said: ['who may', 'who can', 'allowed', 'student', 'students', 'qualified', 'qualification', 'card holder', 'trainer card', 'may i run', 'can i run'], needs: [], bundles: [
        { id: 'who', title: 'Who may run the drill', requires: ['qualification'],
          plain: { interpretation: 'Only a therapist who holds a current Blue Trainer card.', explanation: 'A student may run the drill only while a card holder is present in the room.' },
          links: [link('qualification', 'Only a therapist')] }] }] };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  for (const number of [1, 2]) {
    const file = await loadFixture('rt-train-014-rev' + number + '.pdf');
    writeFileSync(fixturePath('rt-train-014-rev' + number + '.mapping.json'), JSON.stringify(authorMapping(number, file.extraction, file.digest), null, 1) + '\n');
    console.log('wrote', 'rt-train-014-rev' + number + '.mapping.json');
  }
  for (const name of ['rt-train-014-rev1', 'rt-train-014-rev2', 'no-text-page']) {
    const file = await loadFixture(name + '.pdf');
    writeFileSync(expectedPath(name + '.expected.json'), JSON.stringify({ note: 'Synthetic test material — NOT FOR CLINICAL USE. Expected reading of ' + name + '.pdf.', sha256: file.digest, ...slim(file.extraction) }, null, 1) + '\n');
    console.log('wrote', name + '.expected.json', file.extraction.pages.length, 'pages');
  }
}
