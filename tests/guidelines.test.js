import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSet, checkCard, wordCheck, addGuideline, matchCopy, compareCard, withdrawGuideline, guidelineAnswer, sentenceOf, comparedBy, GUIDELINE_FORMAT } from '../src/guidelines.js';
import { ask } from '../src/ask.js';
import { emptyLibrary, prepareLibrary } from '../src/protocols.js';
import { guidelineView } from '../src/protocol-view.js';
import { world as department } from './eval/world.mjs';

// The tests use an invented guideline (synthetic test material, NOT FOR CLINICAL USE). The real AARC capture stays on
// the owner's computer and is not in the repository; only the cards built from it are.
const fixture = name => readFileSync(new URL('./fixtures/guidelines/' + name, import.meta.url), 'utf8');
const TEXT = fixture('invented-guideline.txt'), SPEC = () => JSON.parse(fixture('invented-spec.json'));
const RECEIPT = { tool: 'Blinders', id: '00000000-0000-4000-8000-000000000001', sha256: createHash('sha256').update(TEXT).digest('hex'), bytes: Buffer.byteLength(TEXT), saved_at: '2026-11-12T19:00:00Z' };
const WHO = 'Avery', OTHER = 'Morgan', AT = '2026-11-12T20:00:00.000Z';
const ok = result => { if (!result.ok) throw new Error('Refused: ' + (result.why || result.problems.join('; '))); return result; };
const built = async () => ok(await buildSet(SPEC(), TEXT, RECEIPT)).set;
const held = async () => ok(await addGuideline(emptyLibrary(), await built(), WHO, AT)).library;
const say = (library, question) => ask(question, { ...department, today: '2026-11-12', last: null, protocols: library });
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const tools = { h, button: (label, action, options = '') => '<button data-action="' + action + '" ' + options + '>' + label + '</button>', valueAttr: value => 'data-value="' + h(value) + '"' };

test('cards are fixed sentences filled from the guideline, every number found in its passage, and nothing of the text ships', async () => {
  const set = await built();
  assert.equal(set.format, GUIDELINE_FORMAT);
  assert.deepEqual(set.cards.map(sentenceOf), ['Recommendation 1 (conditional, low certainty): a bellows check is not needed before every drill.', 'Recommendation 2 (conditional, moderate certainty): a drill can run with or without a cuff of 3 cm or less.',
    'Gauge reading at which trainers commonly start a drill: 12 to 14 marks, as the guideline describes common practice.', 'A drill is commonly stopped if the gauge falls below: 6 marks.']);
  const shipped = JSON.stringify(set);
  // The title is the guideline's name, which a citation carries; nothing else of it may.
  const body = TEXT.split('\n').slice(2).filter(line => line.split(' ').length > 6);
  for (const line of body) assert.ok(!shipped.includes(line), 'a line of the guideline ships: ' + line);
  assert.deepEqual(set.cards.map(card => card.passage.numbers), [[], ['3'], ['12', '14'], ['6']]);
  assert.equal(set.source.capture.sha256, RECEIPT.sha256);
});

test('the build refuses a wrong number, a wrong section, free text and a capture that is not the one received', async () => {
  const card = SPEC().cards;
  assert.match(checkCard({ ...card[2], fields: { ...card[2].fields, value: '12 to 15 marks' } }, TEXT).join(), /states 15, which its passage does not contain/);
  assert.match(checkCard({ ...card[1], fields: { ...card[1].fields, number: '1' } }, TEXT).join(), /says it is recommendation 1, but the section its passage sits in is 2/);
  assert.match(checkCard({ ...card[0], passage: [12, 12] }, TEXT).join(), /not a recommendation/);
  assert.match(checkCard({ ...card[2], fields: { ...card[2].fields, note: 'free text' } }, TEXT).join(), /a field it may not have/);
  assert.match(checkCard({ ...card[2], fields: { ...card[2].fields, what: 'x'.repeat(81) } }, TEXT).join(), /one too long: what/);
  assert.match(checkCard({ ...card[2], kind: 'essay' }, TEXT).join(), /no known kind/);
  assert.match(checkCard({ ...card[2], passage: [40, 41] }, TEXT).join(), /not in the capture/);
  const result = await buildSet(SPEC(), TEXT.replace('6 marks', '5 marks'), RECEIPT);
  assert.equal(result.ok, false); assert.ok(result.problems.some(problem => /not the one its receipt describes/.test(problem)));
});

test('the word check: a card may use only its passage’s words, keeps every negation, and may not add a modal', async () => {
  const card = SPEC().cards, words = (index, field, value) => checkCard({ ...card[index], fields: { ...card[index].fields, [field]: value } }, TEXT).join();
  assert.match(words(0, 'about', 'a bellows check is not useful before every drill'), /uses words its passage does not: useful/);
  assert.match(words(0, 'about', 'a bellows check is needed before every drill'), /drops a negation its passage has: not/);
  assert.match(words(1, 'about', 'a drill should run with or without a cuff of 3 cm or less'), /uses words its passage does not: should/);
  assert.match(words(1, 'strength', 'strong, moderate certainty'), /uses words its passage does not: strong/);
  assert.match(words(3, 'what', 'A drill is never stopped if the gauge falls below'), /uses words its passage does not: never/);
  assert.equal(words(2, 'when', 'as the guideline describes common practice'), '', 'a fixed framing phrase may be added');
  assert.equal(words(2, 'when', 'as the guideline describes usual practice'), 'Card "Gauge reading to start a drill" uses words its passage does not: guideline, describes, usual, practice.', 'only the exact framing');
  // Abbreviations come from one fixed list: a card may say SBT for a passage's "spontaneous breathing trial", and the reverse.
  const sbt = { id: 'x', title: 'x', kind: 'value', passage: [0, 0], fields: { what: 'Length of an SBT', value: '30 minutes' } };
  assert.deepEqual(wordCheck(sbt, 'A spontaneous breathing trial commonly lasts 30 minutes, the length of most.'), []);
  assert.deepEqual(wordCheck({ ...sbt, fields: { what: 'Length of a spontaneous breathing trial', value: '30 minutes' } }, 'An SBT lasts 30 minutes, the length of most.'), []);
  const set = await built();
  assert.ok(set.cards.every(one => one.passage.checked.includes('words')), 'every built card records that its words were checked');
});

test('a replaced guideline answers only where no newer one covers the question, and says it was replaced', async () => {
  const newer = await built(), older = { ...(await built()), id: 'invented-bellows-old', replacedBy: { id: newer.id, title: newer.title } };
  const both = ok(await addGuideline(ok(await addGuideline(emptyLibrary(), older, WHO, AT)).library, newer, WHO, AT)).library;
  assert.equal(say(both, 'when do I stop a drill?').guideline.set, 'invented-bellows');
  const alone = ok(await addGuideline(emptyLibrary(), older, WHO, AT)).library, reply = say(alone, 'when do I stop a drill?');
  assert.equal(reply.guideline.set, 'invented-bellows-old');
  assert.match(reply.items[0].sub, /replaced by /);
});

test('a member’s own copy is searched for each passage, wherever its lines break; a changed number is not found', async () => {
  const library = await held(), id = 'invented-bellows';
  // The same text saved in another browser: different line breaks, extra spacing, curly quotes kept.
  const theirs = TEXT.replace(/\n/g, '\n\n').replace('Trainers commonly start', 'Trainers  commonly\nstart');
  const found = ok(await matchCopy(library, id, theirs, OTHER, AT));
  assert.deepEqual([found.found.sort(), found.missing], [['r1', 'r2', 'v-start', 'v-stop'], []]);
  assert.equal(found.receipt.type, 'Guideline cards found in a member’s copy');
  assert.ok(!JSON.stringify(found.library).includes('Trainers commonly'), 'nothing of the member’s copy is kept');
  const altered = ok(await matchCopy(library, id, TEXT.replace('below 6 marks', 'below 5 marks'), OTHER, AT));
  assert.deepEqual(altered.missing.sort(), ['v-start', 'v-stop'], 'a copy that differs in the passage does not bear those cards out');
  assert.equal((await matchCopy(library, id, 'An unrelated page.', OTHER, AT)).ok, false);
});

test('only a member whose own copy held the passage can record that the card says the same', async () => {
  const library = await held(), id = 'invented-bellows';
  assert.match(compareCard(library, id, 'v-stop', OTHER, AT).why, /Give the app your own copy/);
  const matched = ok(await matchCopy(library, id, TEXT, OTHER, AT)).library;
  const done = ok(compareCard(matched, id, 'v-stop', OTHER, AT));
  assert.equal(done.receipt.type, 'Guideline card compared with a member’s copy');
  assert.deepEqual(comparedBy(done.library.guidelines[0], done.library.guidelines[0].cards.find(card => card.id === 'v-stop')), [OTHER]);
  assert.match(compareCard(matched, id, 'v-stop', WHO, AT).why, /Give the app your own copy/, 'one member’s match does not count for another');
  // A card changed after it was compared loses the comparison.
  const edited = structuredClone(done.library); edited.guidelines[0].cards.find(card => card.id === 'v-stop').fields.value = '7 marks';
  assert.deepEqual(comparedBy(edited.guidelines[0], edited.guidelines[0].cards.find(card => card.id === 'v-stop')), []);
});

test('Ask gives the card’s sentence, where it is, and whether anyone has compared it; it never quotes the guideline', async () => {
  const library = await held(), reply = say(library, 'when do I stop a drill?');
  assert.deepEqual([reply.kind, reply.title, reply.guideline.cards], ['guideline', 'A drill is commonly stopped if the gauge falls below: 6 marks.', ['v-stop']]);
  assert.match(reply.lines.at(-1), /^Restated in Department Hub’s own fixed wording from the guideline named\. It is not the guideline’s text/);
  assert.match(reply.items[0].sub, /every number checked against an exact capture of the guideline · every word found in its passage · read it in your own copy$/);
  assert.equal(reply.items.at(-1).go, 'guideline|invented-bellows');
  for (const line of TEXT.split('\n').slice(2).filter(line => line.split(' ').length > 6)) assert.ok(!JSON.stringify(reply).includes(line));
  assert.deepEqual(say(library, 'When do I work next?'), say(emptyLibrary(), 'When do I work next?'), 'schedule questions are untouched');
  const gone = ok(withdrawGuideline(library, 'invented-bellows', 'Replaced', WHO, AT)).library;
  assert.equal(guidelineAnswer('when do I stop a drill?', { protocols: gone }), null);
  assert.deepEqual(prepareLibrary({ families: [], revisions: [], marks: [] }).guidelines, []);
});

test('the guideline screen offers a member their own check, and the compare button only after their copy held the passage', async () => {
  const library = await held(), set = library.guidelines[0];
  const page = guidelineView({ set, actor: OTHER, keeper: false, withdrawing: false }, tools);
  assert.match(page, /id="guideline-copy" type="file"/);
  assert.equal(page.includes('guideline-compare'), false);
  const matched = ok(await matchCopy(library, set.id, TEXT, OTHER, AT)).library;
  assert.equal(guidelineView({ set: matched.guidelines[0], actor: OTHER, keeper: false, withdrawing: false }, tools).match(/data-action="guideline-compare"/g).length, 4);
  assert.equal(guidelineView({ set: matched.guidelines[0], actor: WHO, keeper: true, withdrawing: false }, tools).includes('guideline-compare'), false);
});

test('the shipped AARC 2024 breathing-trial cards are well formed and hold no text of the guideline', async () => {
  const set = JSON.parse(readFileSync(new URL('../src/reference/guidelines/aarc-2024-sbt.json', import.meta.url), 'utf8'));
  assert.ok(set.cards.every(card => card.passage.checked.join() === 'numbers,words'), 'every shipped card passed the word check');
  assert.equal(set.format, GUIDELINE_FORMAT);
  assert.equal(set.source.capture.sha256, '29f3a368baca4213ef7451e563a4aeaccb2eab7f47a4740e71482d951bd70fad');
  assert.match(set.source.rights, /Copyright © 2024 Daedalus Enterprises\. Department Hub holds none of its text/);
  assert.equal(set.cards.length, 7);
  for (const card of set.cards) {
    assert.ok(/^[0-9a-f]{32}$/.test(card.passage.fingerprint) && card.passage.words > 10, card.id);
    assert.ok(Object.keys(card.fields).every(key => ['what', 'value', 'unit', 'when', 'number', 'strength', 'about'].includes(key)), card.id);
    assert.ok(Object.values(card.fields).every(value => String(value).length <= 140), card.id);
  }
  const library = ok(await addGuideline(emptyLibrary(), set, WHO, AT)).library;
  const expected = { 'do I need an rsbi before an sbt': 'r1-rsbi', 'can I do the sbt on pressure support': 'r2-psv', 'what time sbt': 'r3-timing', 'should I turn up fio2 during sbt': 'r4-fio2',
    'what spo2 before sbt': 'v-oxygenation', 'when to stop sbt': 'v-stop', 'patient is being extubated to bipap': 'v-niv' };
  for (const [question, card] of Object.entries(expected)) assert.deepEqual(say(library, question).guideline?.cards, [card], question);
  assert.equal(say(library, 'should I turn up fio2 during sbt').title, 'Recommendation 4 (conditional, very low certainty): FIO2 should not be increased during an SBT.');
});
