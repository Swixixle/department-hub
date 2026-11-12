// Synthetic test material — NOT FOR CLINICAL USE. Every protocol, device, unit, role and number here is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPdf, passageAt, passagesIn, layoutPage } from '../src/pdftext.js';
import { addRevision, checkExtraction, supplyText, markFigure, markMappingsReviewed, activate, withdraw, standing, applicable, emptyLibrary, prepareLibrary,
  historyOf, searchLibrary, toggleMark, sealOf } from '../src/protocols.js';
import { LABEL, DIGESTS, META, loadFixture, addFixture, activeLibrary, expectedPath, reader, ok } from './protocol-kit.mjs';
import { slim } from '../scripts/protocol-fixture-data.mjs';

const WHO = 'Avery Stone', AT = '2026-11-10T10:00:00.000Z';
const text = (extraction, anchor) => passageAt(extraction, anchor)?.text;

test('the committed PDFs are the ones the tests were written against, and every page carries the label', async () => {
  for (const [name, digest] of Object.entries(DIGESTS)) assert.equal((await loadFixture(name)).digest, digest, name + ' changed: regenerate the expected readings and review every assertion');
  for (const name of ['rt-train-014-rev1.pdf', 'rt-train-014-rev2.pdf']) {
    const { extraction } = await loadFixture(name);
    assert.equal(extraction.pages.length, 3);
    for (const page of extraction.pages) {
      const labels = page.blocks.filter(block => block.text === LABEL);
      assert.equal(labels.length, 2, name + ' page ' + page.number + ' must carry the label at the top and the bottom');
      assert.ok(labels.every(block => block.running), 'the label is a running line, not a passage of the protocol');
    }
  }
  for (const name of ['rt-train-014-rev1', 'rt-train-014-rev2', 'no-text-page']) assert.match(readFileSync(expectedPath(name + '.expected.json'), 'utf8'), /Synthetic test material — NOT FOR CLINICAL USE/);
});

test('a reading matches the committed expected reading exactly, anchors and hashes included', async () => {
  for (const name of ['rt-train-014-rev1', 'rt-train-014-rev2', 'no-text-page']) {
    const { extraction, digest } = await loadFixture(name + '.pdf'), expected = JSON.parse(readFileSync(expectedPath(name + '.expected.json'), 'utf8'));
    assert.equal(expected.sha256, digest);
    assert.deepEqual(slim(extraction), { format: expected.format, emptyPages: expected.emptyPages, pages: expected.pages });
  }
});

test('passages keep their page, their place and the words that give them meaning', async () => {
  const { extraction } = await loadFixture('rt-train-014-rev1.pdf');
  // The rate is in a table on page 2. A row is read with its column names, never as bare numbers.
  assert.equal(text(extraction, 'p2.b3.r1'), 'Age band: Adult (18 years and over) · Starting rate: 12 mk/min · Highest rate: 20 mk/min · Recheck after: 10 minutes');
  assert.equal(text(extraction, 'p2.b3.r2'), 'Age band: Pediatric (under 18 years) · Starting rate: 6 mk/min · Highest rate: 10 mk/min · Recheck after: 5 minutes');
  const cell = passageAt(extraction, 'p2.b3.r2.c4');
  assert.equal(cell.text, 'Age band: Pediatric (under 18 years) · Recheck after: 5 minutes');
  assert.equal(cell.hash, passageAt(extraction, 'p2.b3.r2').hash, 'a cell is bound to its whole row, so a change anywhere in the row breaks the link');
  assert.equal(cell.context, '4. Rates by age band · table row 2');
  assert.ok(cell.box[0] > 400 && cell.box[2] < 60, 'the cell has its own place on the page for highlighting');
  // The condition that forbids starting is on a different page from the rate.
  const contra = passageAt(extraction, 'p3.b3');
  assert.equal(contra.page, 3);
  assert.equal(contra.under, '7. When the drill must not be started');
  assert.equal(contra.text, 'Do not start the drill if the amber seal lamp on the manikin is lit, or if the bellows was serviced within the last 24 hours. This applies to adult and pediatric drills.');
  assert.equal(text(extraction, 'p1.b9'), 'A written drill order from the Simulation Lead is required before the drill is started. A verbal request is not a drill order.');
  assert.equal(text(extraction, 'p1.b7'), 'Only a therapist who holds a current Blue Trainer card may run the drill. A student may run the drill only while a card holder is present in the room.');
  assert.equal(text(extraction, 'p3.b5'), 'Stop the drill at once if the red lamp lights or the gauge reads above 30 marks.');
  assert.equal(text(extraction, 'p3.b7'), 'After stopping, call the Simulation Lead. If the Simulation Lead does not answer within 5 minutes, call the Education Supervisor.');
  assert.equal(passageAt(extraction, 'p2.b5').under, '5. Adult drill');
  assert.equal(passageAt(extraction, 'p2.b7').under, '6. Pediatric drill');
  for (const bad of ['p9.b1', 'p2.b3.r7', 'p2.b3.r1.c9', 'p2.b5.r1', 'nonsense', '']) assert.equal(passageAt(extraction, bad), null, bad);
});

test('words inside the diagram are flagged as labels, because the arrows that give them meaning are not read', async () => {
  const { extraction } = await loadFixture('rt-train-014-rev1.pdf');
  const page = extraction.pages[2], figure = page.blocks.filter(block => block.figure);
  assert.equal(page.drawn, true);
  assert.equal(extraction.pages[0].drawn, false);
  assert.deepEqual(figure.map(block => block.text).sort(), ['Adult: start at 12 mk/min.', 'Is a drill order on file?', 'Is the amber seal lamp lit?', 'Lamp lit: do not start.', 'No', 'No',
    'No order: do not start. Ask the Simulation Lead.', 'Pediatric: start at 6 mk/min.', 'Which age band is the manikin?', 'Yes', 'Yes']);
  // "Adult: start at 12 mk/min." read alone drops the order and the lamp. It must never come back from a search.
  const library = (await activeLibrary()).library;
  for (const query of ['adult start 12 mk/min', 'order on file', 'lamp lit do not start']) {
    const found = searchLibrary(library, query, '2026-11-11');
    assert.ok(found.length, query);
    assert.ok(found.every(hit => !hit.passage.figure && !hit.passage.running), query + ' returned a diagram label or a running line');
  }
  assert.ok(passagesIn(extraction).filter(passage => !passage.figure && !passage.running).every(passage => !/^(Yes|No)$/.test(passage.text)));
});

test('the second revision moves passages and changes values, so nothing can be carried over by position', async () => {
  const one = (await loadFixture('rt-train-014-rev1.pdf')).extraction, two = (await loadFixture('rt-train-014-rev2.pdf')).extraction;
  assert.equal(text(two, 'p2.b3.r1'), 'Age band: Adult (18 years and over) · Starting rate: 14 mk/min · Highest rate: 22 mk/min · Recheck after: 10 minutes');
  assert.equal(text(two, 'p2.b3.r2'), 'Age band: Pediatric (under 18 years) · Starting rate: 6 mk/min · Highest rate: 10 mk/min · Recheck after: 4 minutes');
  assert.match(text(two, 'p3.b3'), /serviced within the last 48 hours/);
  assert.match(text(two, 'p3.b7'), /^After stopping, call the Charge Educator\./);
  assert.notEqual(text(one, 'p1.b9'), text(two, 'p1.b9'), 'the same anchor names a different passage in revision 2');
  assert.match(text(two, 'p1.b11'), /written drill order from the Charge Educator/);
  assert.equal(text(two, 'p2.b8'), 'Do not run a pediatric drill with the large cuff fitted.');
  assert.notEqual(passageAt(one, 'p3.b3').hash, passageAt(two, 'p3.b3').hash);
});

test('a page with no text is reported as empty and cannot be confirmed until a person types its text in', async () => {
  const file = await loadFixture('no-text-page.pdf');
  assert.deepEqual(file.extraction.emptyPages, [1]);
  assert.equal(file.extraction.characters, 0);
  const input = { title: 'Scanned sheet', identifier: 'RT-TRAIN-900', authority: 'Fictional committee', label: '1', effective: '2026-01-01', digest: file.digest, extraction: file.extraction, file: { name: file.name, bytes: file.bytes.length } };
  let step = ok(addRevision(emptyLibrary(), input, WHO, AT));
  const id = step.revision.id;
  assert.equal(step.revision.state, 'added');
  assert.deepEqual(step.receipt.details.pagesWithNoText, [1]);
  const refused = checkExtraction(step.library, id, WHO, AT);
  assert.equal(refused.ok, false);
  assert.match(refused.why, /Page 1 read as empty\. A scanned page is not read here/);
  assert.equal((await supplyText(step.library, id, 1, '   ', WHO, AT)).ok, false);
  step = ok(await supplyText(step.library, id, 1, 'Synthetic test material — NOT FOR CLINICAL USE\n\nWipe the trainer after each drill.', WHO, AT));
  const typed = passageAt(step.library.revisions[0].extraction, 'p1.s2');
  assert.equal(typed.text, 'Wipe the trainer after each drill.');
  assert.equal(typed.supplied, true, 'typed-in text stays marked as a person\'s transcription');
  assert.equal(step.receipt.type, 'Protocol page text supplied');
  step = ok(checkExtraction(step.library, id, WHO, AT));
  assert.deepEqual(step.receipt.details.typedInPages, [1]);
  assert.equal((await supplyText(step.library, id, 1, 'Changed later', WHO, AT)).ok, false, 'confirmed text cannot be retyped');
});

test('a file that is not a PDF, or that reads to nothing, is refused rather than added', async () => {
  const garbage = await readPdf(new TextEncoder().encode('This is a text file pretending to be a PDF.'), await reader());
  assert.equal(garbage.unreadable, 'This file could not be read as a PDF.');
  const refused = addRevision(emptyLibrary(), { ...META[1], digest: 'a'.repeat(64), extraction: garbage }, WHO, AT);
  assert.deepEqual(refused, { ok: false, why: 'This file could not be read as a PDF.' });
  assert.equal(addRevision(emptyLibrary(), { ...META[1], digest: 'a'.repeat(64), extraction: { pages: [] } }, WHO, AT).ok, false);
  assert.equal(addRevision(emptyLibrary(), { ...META[1], digest: 'not-a-digest', extraction: (await loadFixture('rt-train-014-rev1.pdf')).extraction }, WHO, AT).ok, false);
});

test('adding records what the document says about itself separately from when it was added here', async () => {
  const step = ok(await addFixture(emptyLibrary(), 1));
  const { revision, family, receipt } = step;
  assert.equal(family.identifier, 'RT-TRAIN-014');
  assert.deepEqual([revision.state, revision.effective, revision.added.at, revision.added.by, revision.checked, revision.activated], ['added', '2026-06-01', '2026-11-10T09:00:00.000Z', 'Avery Stone', null, null]);
  assert.equal(revision.digest, DIGESTS['rt-train-014-rev1.pdf']);
  assert.equal(revision.file.bytes, 5006);
  assert.equal(receipt.type, 'Protocol revision added');
  assert.equal(receipt.details.sha256, revision.digest);
  assert.equal(receipt.details.effective, '2026-06-01');
  for (const missing of ['title', 'identifier', 'authority', 'label', 'effective']) assert.equal((await addFixture(emptyLibrary(), 1, { [missing]: '' })).ok, false, missing + ' is required');
  assert.equal((await addFixture(emptyLibrary(), 1, { effective: '11/01/2026' })).ok, false);
  const again = await addFixture(step.library, 1);
  assert.match(again.why, /^This exact file is already held as Blue Trainer Bellows Drill, revision 1\./);
  const sameLabel = await addFixture(step.library, 2, { label: '1' });
  assert.match(sameLabel.why, /^Revision 1 of RT-TRAIN-014 is already held with different contents/);
  const second = ok(await addFixture(step.library, 2));
  assert.equal(second.library.families.length, 1, 'a second revision joins the same family');
  assert.equal(second.revision.family, revision.family);
  assert.deepEqual(second.receipt.details.alongside, ['1 (d09ae851f3b2)']);
});

test('each step must be taken in order by an explicit action, and each leaves a receipt', async () => {
  let step = ok(await addFixture(emptyLibrary(), 1));
  const id = step.revision.id;
  assert.match(markMappingsReviewed(step.library, id, WHO, AT).why, /^Confirm the reading against the original first/);
  assert.match(activate(step.library, id, WHO, AT, '2026-11-11').why, /^Confirm the reading and review the mapped answers first/);
  step = ok(checkExtraction(step.library, id, WHO, AT));
  assert.equal(step.receipt.type, 'Protocol reading confirmed');
  assert.equal(step.receipt.details.diagramLabels, 11);
  assert.match(step.receipt.details.note, /Not an authenticated clinical review/);
  assert.equal(checkExtraction(step.library, id, WHO, AT).ok, false);
  assert.equal(markFigure(step.library, id, 'p3.b3', true).ok, false, 'what counts as diagram text is fixed once the reading is confirmed');
  assert.equal(activate(step.library, id, WHO, AT, '2026-11-11').ok, false);
  step = ok(markMappingsReviewed(step.library, id, WHO, AT));
  assert.equal(step.receipt.type, 'Protocol answers reviewed');
  assert.match(step.receipt.details.note, /No answers are mapped/);
  step = ok(activate(step.library, id, WHO, AT, '2026-11-11'));
  assert.equal(step.receipt.type, 'Protocol revision made active');
  assert.equal(step.receipt.details.inForce, 'from now');
  assert.deepEqual(step.library.revisions[0].activated, { by: WHO, at: AT });
  assert.equal(activate(step.library, id, WHO, AT, '2026-11-11').why, 'This revision is already active.');
  assert.equal(withdraw(step.library, id, '  ', WHO, AT).ok, false, 'a withdrawal needs a reason');
  step = ok(withdraw(step.library, id, 'Added by mistake', WHO, AT));
  assert.deepEqual(step.receipt, { type: 'Protocol revision withdrawn', details: { identifier: 'RT-TRAIN-014', revision: '1', sha256: DIGESTS['rt-train-014-rev1.pdf'], was: 'active', reason: 'Added by mistake' } });
  assert.match(activate(step.library, id, WHO, AT, '2026-11-11').why, /^A withdrawn revision cannot be made active/);
});

test('diagram marks can be corrected before the reading is confirmed', async () => {
  let step = ok(await addFixture(emptyLibrary(), 1));
  const id = step.revision.id;
  step = ok(markFigure(step.library, id, 'p3.b17', false));
  assert.equal(passageAt(step.library.revisions[0].extraction, 'p3.b17').figure, false);
  step = ok(markFigure(step.library, id, 'p3.b17', true));
  assert.equal(passageAt(step.library.revisions[0].extraction, 'p3.b17').figure, true);
  assert.equal(markFigure(step.library, id, 'p9.b1', true).ok, false);
});

test('a later revision takes over on its effective date and never before; the earlier one stays as history', async () => {
  const { library: first, id: one } = await activeLibrary();
  // Revision 2 is added ahead of its date. Nothing changes yet.
  const added = ok(await addFixture(first, 2, { effective: '2026-12-01' })), two = added.revision.id;
  let now = applicable(added.library, added.family.id, '2026-11-11');
  assert.deepEqual([now.status, now.revision.id, now.answerable, now.upcoming.id], ['active', one, true, two]);
  assert.equal(standing(added.library, added.library.revisions[0], '2026-11-11'), 'active');
  // On the day, revision 2 is in force even though nobody has finished reviewing it. Revision 1 does not fill in.
  now = applicable(added.library, added.family.id, '2026-12-01');
  assert.deepEqual([now.status, now.revision.id, now.answerable], ['pending', two, false]);
  assert.match(now.why, /^Revision 2 of RT-TRAIN-014 has been in effect since 2026-12-01, and its review here is not finished \(added · reading not checked\)\. Earlier revisions are history and are not used to answer\.$/);
  assert.equal(standing(added.library, added.library.revisions[0], '2026-12-01'), 'superseded');
  assert.equal(standing(added.library, added.library.revisions[0], '2026-11-30'), 'active');
  // Reviewed and made active ahead of time: scheduled, not in force.
  let step = ok(checkExtraction(added.library, two, WHO, AT));
  step = ok(markMappingsReviewed(step.library, two, WHO, AT));
  step = ok(activate(step.library, two, WHO, AT, '2026-11-11'));
  assert.equal(step.receipt.details.inForce, 'from 2026-12-01');
  assert.deepEqual(step.receipt.details.replaces, ['1 (d09ae851f3b2)']);
  assert.equal(standing(step.library, step.library.revisions[1], '2026-11-11'), 'scheduled');
  assert.equal(applicable(step.library, added.family.id, '2026-11-30').revision.id, one);
  now = applicable(step.library, added.family.id, '2026-12-01');
  assert.deepEqual([now.status, now.revision.id, now.answerable], ['active', two, true]);
  // History keeps both, newest first, with the original untouched.
  assert.deepEqual(historyOf(step.library, added.family.id).map(revision => [revision.label, standing(step.library, revision, '2026-12-02')]), [['2', 'active'], ['1', 'superseded']]);
  assert.equal(step.library.revisions[0].digest, DIGESTS['rt-train-014-rev1.pdf']);
  assert.equal(step.library.revisions[0].state, 'active', 'the stored record of revision 1 is not rewritten; supersession is worked out from dates');
});

test('withdrawal, nothing in effect, nothing held and two revisions on one date each say so plainly', async () => {
  const { library: first, id: one } = await activeLibrary();
  const family = first.families[0].id;
  // Before its effective date there is no applicable revision.
  let now = applicable(first, family, '2026-05-31');
  assert.deepEqual([now.status, now.revision, now.answerable], ['not-yet', null, false]);
  assert.equal(now.why, 'No revision of RT-TRAIN-014 is in effect yet. Revision 1 takes effect on 2026-06-01.');
  // Withdrawing the newer revision hands the protocol back to the earlier one. Withdrawing both leaves none.
  const added = ok(await addFixture(first, 2));
  assert.equal(applicable(added.library, family, '2026-11-11').status, 'pending');
  const backOut = ok(withdraw(added.library, added.revision.id, 'Wrong file', WHO, AT));
  now = applicable(backOut.library, family, '2026-11-11');
  assert.deepEqual([now.status, now.revision.id, now.answerable], ['active', one, true]);
  assert.equal(standing(backOut.library, backOut.library.revisions[1], '2026-11-11'), 'withdrawn');
  const none = ok(withdraw(backOut.library, one, 'Retired', WHO, AT));
  now = applicable(none.library, family, '2026-11-11');
  assert.deepEqual([now.status, now.revision, now.why], ['none', null, 'Every revision held of RT-TRAIN-014 has been withdrawn.']);
  // Two live revisions dated the same day. No precedence is invented, and neither can be made active.
  const clash = ok(await addFixture(first, 2, { effective: '2026-06-01' }));
  now = applicable(clash.library, family, '2026-11-11');
  assert.deepEqual([now.status, now.revision, now.answerable, now.conflict.map(revision => revision.label).sort()], ['conflict', null, false, ['1', '2']]);
  assert.match(now.why, /both take effect on 2026-06-01\. Department Hub does not choose between them/);
  let step = ok(checkExtraction(clash.library, clash.revision.id, WHO, AT));
  step = ok(markMappingsReviewed(step.library, clash.revision.id, WHO, AT));
  assert.match(activate(step.library, clash.revision.id, WHO, AT, '2026-11-11').why, /Two revisions cannot take effect on the same day/);
});

test('search reads only the revision in force unless history is asked for, and keeps nothing', async () => {
  const { library: first } = await activeLibrary();
  const added = ok(await addFixture(first, 2)), before = JSON.stringify(added.library);
  let found = searchLibrary(first, 'serviced hours amber lamp', '2026-11-11');
  assert.equal(found[0].passage.anchor, 'p3.b3');
  assert.match(found[0].passage.text, /24 hours/);
  found = searchLibrary(added.library, 'serviced hours amber lamp', '2026-11-11');
  assert.ok(found.length && found.every(hit => hit.revision.label === '2'), 'revision 1 is history once revision 2 is in effect');
  assert.match(found[0].passage.text, /48 hours/);
  assert.equal(found[0].standing, 'added');
  const all = searchLibrary(added.library, 'serviced hours amber lamp', '2026-11-11', { history: true });
  assert.deepEqual([...new Set(all.map(hit => hit.revision.label + ':' + hit.standing))].sort(), ['1:superseded', '2:added']);
  assert.deepEqual(searchLibrary(added.library, '', '2026-11-11'), []);
  assert.deepEqual(searchLibrary(added.library, 'ventilator weaning', '2026-11-11'), []);
  assert.equal(JSON.stringify(added.library), before, 'searching changes nothing in the library');
});

test('a workspace from before protocols opens with an empty library, and a held library is kept as it is', async () => {
  assert.deepEqual(prepareLibrary(undefined), emptyLibrary());
  assert.deepEqual(prepareLibrary({ families: 'broken' }), emptyLibrary());
  const { library } = await activeLibrary();
  assert.deepEqual(prepareLibrary(JSON.parse(JSON.stringify(library))), { ...library, marks: [] });
  const marked = toggleMark(library, library.families[0].id);
  assert.deepEqual(marked.marks, [library.families[0].id]);
  assert.deepEqual(toggleMark(marked, library.families[0].id).marks, []);
});

test('a seal changes when any part of what was reviewed changes, and ignores the review record itself', () => {
  const mapping = { digest: 'x', bundle: { id: 'a', links: [{ role: 'rule', anchor: 'p2.b3.r1' }], plain: 'Start at 12 mk/min.' } };
  assert.equal(sealOf(mapping), sealOf(JSON.parse(JSON.stringify(mapping))));
  assert.equal(sealOf(mapping), sealOf({ bundle: { plain: 'Start at 12 mk/min.', links: [{ anchor: 'p2.b3.r1', role: 'rule' }], id: 'a', review: { by: 'x' } }, digest: 'x' }));
  assert.notEqual(sealOf(mapping), sealOf({ ...mapping, bundle: { ...mapping.bundle, plain: 'Start at 12 mk/sec.' } }));
  assert.notEqual(sealOf(mapping), sealOf({ ...mapping, bundle: { ...mapping.bundle, links: [] } }));
  assert.notEqual(sealOf(mapping), sealOf({ ...mapping, digest: 'y' }));
});

test('layout keeps side-by-side labels apart and does not call two loose lines a table', () => {
  const item = (str, x, y, width, height = 10) => ({ str, transform: [height, 0, 0, height, x, y], width, height });
  const page = layoutPage([item('Left box', 80, 500, 50), item('Right box', 330, 500, 60), item('Left again', 80, 430, 55), item('Right again', 330, 430, 60), item('One line of', 72, 300, 60), item('prose here.', 72, 286, 60)],
    { number: 1, width: 612, height: 792 });
  assert.deepEqual(page.blocks.map(block => [block.kind, block.text]), [['text', 'Left box'], ['text', 'Right box'], ['text', 'Left again'], ['text', 'Right again'], ['text', 'One line of prose here.']]);
});
