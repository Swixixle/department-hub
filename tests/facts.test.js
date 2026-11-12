import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ask } from '../src/ask.js';
import { addSet, reviewCard, withdrawSet, validateSet, cardHolds, factAnswer } from '../src/facts.js';
import { emptyLibrary, prepareLibrary } from '../src/protocols.js';
import { knowledgeView, libraryView } from '../src/protocol-view.js';
import { world as department } from './eval/world.mjs';
import { carryThrough } from './protocol-kit.mjs';

const shipped = () => JSON.parse(readFileSync(new URL('../src/reference/cards-blood-gases.json', import.meta.url), 'utf8'));
const WHO = 'Avery Stone', AT = '2026-11-12T12:00:00.000Z', TODAY = '2026-11-12';
const ok = result => { if (!result.ok) throw new Error('Refused: ' + result.why); return result; };
const unchecked = () => ok(addSet(emptyLibrary(), shipped(), WHO, AT)).library;
const checkedAll = () => shipped().cards.reduce((library, card) => ok(reviewCard(library, 'blood-gases-adult', card.id, WHO, AT)).library, unchecked());
const say = (library, question, extra = {}) => ask(question, { ...department, today: TODAY, last: null, protocols: library, ...extra });
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const tools = { h, button: (label, action, options = '') => '<button data-action="' + action + '" ' + options + '>' + label + '</button>', valueAttr: value => 'data-value="' + h(value) + '"' };

test('the shipped cards are well formed, cite an openable page, and say how many times each figure was read', () => {
  const set = shipped();
  assert.deepEqual(validateSet(set), []);
  assert.equal(set.cards.length, 12);
  assert.equal(set.source.url, 'https://wtcs.pressbooks.pub/nursingfundamentals/chapter/15-5-acid-base-balance/');
  assert.equal(set.source.licence, 'Creative Commons Attribution 4.0 International');
  assert.deepEqual(set.cards.filter(card => card.read === 'once').map(card => card.id), ['respiratory', 'metabolic', 'compensation', 'lungs-kidneys'], 'the cards read only once are known and say so');
  // The figures two independent readings of the page agreed on. Changing one here must be a deliberate act.
  const answer = id => set.cards.find(card => card.id === id).answer;
  assert.equal(answer('abg-normal'), 'Adult normal arterial blood gas values: pH 7.35-7.45, PaO2 80-100 mmHg, PaCO2 35-45 mmHg, HCO3 22-26 mEq/L, SaO2 95-100%.');
  assert.match(answer('ph'), /7\.35-7\.45\..*less than 7\.25 or greater than 7\.60/);
  assert.match(answer('pao2'), /80-100 mmHg\..*less than 60 mmHg/);
  assert.match(answer('paco2'), /35-45 mmHg\..*less than 25 mmHg or greater than 60 mmHg/);
  assert.match(answer('hco3'), /22-26 mEq\/L\..*less than 10 mEq\/L or greater than 40 mEq\/L/);
  assert.match(answer('sao2'), /95-100%\..*less than 88%/);
  // Every figure in a single-value card also appears, written the same way, in the all-values or all-critical card.
  const figures = text => [...text.matchAll(/\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?(?: ?(?:mmHg|mEq\/L|%))?/g)].map(match => match[0]);
  for (const id of ['ph', 'pao2', 'paco2', 'hco3', 'sao2']) for (const figure of figures(answer(id))) assert.ok((answer('abg-normal') + answer('abg-critical')).includes(figure), id + ' says ' + figure + ' and the summary cards do not');
  for (const problem of [[set => { set.source.url = 'http://example.org/x'; }, /secure web address/], [set => { delete set.cards[0].where; }, /does not say where in the source/], [set => { set.cards[1].id = set.cards[0].id; }, /its own id/],
    [set => { set.cards[0].read = 'thrice'; }, /how many times its figures were read/], [set => { set.format = 'other'; }, /not a Department Hub reference card file/]]) { const broken = shipped(); problem[0](broken); assert.ok(validateSet(broken).some(line => problem[1].test(line)), String(problem[1])); assert.equal(addSet(emptyLibrary(), broken, WHO, AT).ok, false); }
});

test('a card answers nothing until a person has checked it against its page, and stops if it is changed afterwards', () => {
  const claimed = shipped(); for (const card of claimed.cards) card.review = { by: 'The file itself', at: AT, seal: 'anything' };
  const arrived = ok(addSet(emptyLibrary(), claimed, WHO, AT));
  assert.ok(arrived.library.knowledge[0].cards.every(card => !card.review), 'a file cannot arrive already checked');
  assert.equal(arrived.receipt.type, 'Reference cards added');
  const waiting = say(arrived.library, 'What is a normal PaCO2?');
  assert.deepEqual([waiting.kind, waiting.fact.status, waiting.title], ['fact', 'unchecked', 'A reference card on this is held and has not been checked against its source']);
  assert.ok(!/\d{2}/.test(JSON.stringify([waiting.title, waiting.lines])), 'an unchecked card showed a figure');
  assert.equal(waiting.items[0].go, 'knowledge|blood-gases-adult');
  const one = ok(reviewCard(arrived.library, 'blood-gases-adult', 'paco2', WHO, AT));
  assert.deepEqual([one.receipt.type, one.receipt.details.card, one.receipt.details.where, one.receipt.details.source], ['Reference card checked', 'PaCO2', 'Table 15.5a', shipped().source.url]);
  assert.match(one.receipt.details.note, /a check that the card matches the cited page\. It is not clinical sign-off\./);
  assert.equal(say(one.library, 'What is a normal PaCO2?').title, 'Adult normal PaCO2 is 35-45 mmHg. The source lists a PaCO2 less than 25 mmHg or greater than 60 mmHg as critical.');
  assert.equal(say(one.library, 'What is a normal pH?').fact.status, 'unchecked', 'checking one card does not check its neighbours');
  // The stored card is edited after it was checked: one digit. It stops answering.
  const edited = structuredClone(one.library); edited.knowledge[0].cards.find(card => card.id === 'paco2').answer = 'Adult normal PaCO2 is 35-55 mmHg.';
  assert.equal(cardHolds(edited.knowledge[0], edited.knowledge[0].cards.find(card => card.id === 'paco2')), false);
  assert.equal(say(edited, 'What is a normal PaCO2?').fact.status, 'unchecked');
  const moved = structuredClone(one.library); moved.knowledge[0].source.url = 'https://example.org/another-page/';
  assert.equal(say(moved, 'What is a normal PaCO2?').fact.status, 'unchecked', 'a card pointed at a different page is no longer the card that was checked');
  assert.equal(addSet(one.library, shipped(), WHO, AT).why, 'These reference cards are already held.');
  assert.equal(reviewCard(one.library, 'blood-gases-adult', 'no-such-card', WHO, AT).ok, false);
});

test('checked cards answer in ordinary words, with the figure, its source and what it is not', () => {
  const library = checkedAll(), reply = say(library, 'What is a normal pH?');
  assert.equal(reply.kind, 'fact');
  assert.equal(reply.title, 'Adult normal arterial pH is 7.35-7.45. The source lists a pH less than 7.25 or greater than 7.60 as critical.');
  assert.equal(reply.lines[0], 'Reference knowledge. It is not your hospital’s protocol and not an order for any patient. Adult values, as the source\'s own table is titled. A laboratory sets its own reference ranges, and your hospital\'s may differ.');
  assert.deepEqual([reply.items.length, reply.items[0].text, reply.items[0].href, reply.items[0].go], [1, 'Nursing Fundamentals 2e, section 15.5 Acid-Base Balance · Table 15.5a', shipped().source.url, undefined]);
  assert.match(reply.items[0].sub, /^WisTech Open \(Open RN\), 2024 · Creative Commons Attribution 4\.0 International · read from the page on 2026-11-12; two separate readings agreed · the page’s own text is not held here/);
  assert.match(reply.source, /Checked against that page by Avery Stone on 2026-11-12, under the profile selected on this device\. That is a check that the card matches the page, not clinical sign-off\.$/);
  assert.deepEqual(reply.context, { kind: 'fact' }, 'nothing of the question is carried forward');
  const expected = { 'normal abg values': 'abg-normal', 'whats the normal range for PaCO2': 'paco2', 'normal po2?': 'pao2', 'what should bicarb be': 'hco3', 'normal arterial saturation': 'sao2', 'critical values for an abg': 'abg-critical',
    'is a low pH acidosis or alkalosis': 'acidosis-alkalosis', 'what is respiratory acidosis': 'respiratory', 'how do I tell metabolic alkalosis': 'metabolic', 'is it compensated or uncompensated': 'compensation', 'which is the respiratory component': 'lungs-kidneys' };
  for (const [question, card] of Object.entries(expected)) assert.deepEqual(say(library, question).fact?.cards, [card], question);
  assert.match(say(library, 'what is respiratory acidosis').items[0].sub, /read once/, 'a card whose figures were read only once says so in the answer');
  // Two subjects in one question: both cards, neither dropped.
  const both = say(library, 'normal ph and paco2');
  assert.deepEqual([both.fact.cards, both.title, both.lines.slice(0, 2).map(line => line.slice(0, 22))], [['ph', 'paco2'], 'Reference cards on this:', ['Adult normal arterial ', 'Adult normal PaCO2 is ']]);
  // Near-miss spelling is read as the card's word, and shown.
  const typo = say(library, 'normal bicarbonte level');
  assert.deepEqual([typo.fact.cards, typo.changes, typo.read], [['hco3'], [['bicarbonte', 'bicarbonate']], 'normal bicarbonate level']);
  assert.deepEqual(say(library, 'metabolic alkalosys').fact.cards, ['metabolic']);
});

test('a card answers only what it is about: not the pulse oximeter, not the schedule, not ahead of a held protocol', async () => {
  const library = checkedAll();
  // SpO2 is not SaO2. The arterial card must not answer a pulse-oximetry question.
  for (const question of ['What is a normal SpO2?', 'normal pulse ox', 'what sat should I titrate to']) assert.notEqual(say(library, question).kind, 'fact', question);
  for (const question of ['When do I work next?', 'Who is on tonight?', 'Who has worked the most weekends?', 'How do I request leave?', 'thanks', 'What did I miss on the board?'])
    assert.deepEqual(say(library, question), say(emptyLibrary(), question), question + ' answers exactly as it does with no cards held');
  assert.equal(factAnswer('What is a normal pH?', { today: TODAY, protocols: emptyLibrary() }), null);
  const { library: withProtocol } = await carryThrough(library, 1);
  assert.equal(withProtocol.knowledge.length, 1, 'adding a protocol leaves the cards in place');
  const held = say(withProtocol, 'What rate do I start an adult Blue Trainer drill at, with a written order on file?');
  assert.deepEqual([held.kind, held.title], ['protocol', 'Start an adult drill at 12 mk/min.']);
  assert.equal(say(withProtocol, 'What is a normal pH?').kind, 'fact');
  const before = JSON.stringify(library); for (let turn = 0; turn < 20; turn++) say(library, 'What is a normal pH?', { learned: [{ terms: ['normal', 'ph'], go: 'doc|thin|0', count: 50, sourceHash: 'x' }] });
  assert.equal(JSON.stringify(library), before, 'answering changed the cards');
});

test('withdrawing needs a reason, is recorded, and stops the answers; an older workspace opens with no cards', () => {
  const library = checkedAll();
  assert.equal(withdrawSet(library, 'blood-gases-adult', ' ', WHO, AT).ok, false);
  const gone = ok(withdrawSet(library, 'blood-gases-adult', 'A figure was wrong', WHO, AT));
  assert.deepEqual(gone.receipt, { type: 'Reference cards withdrawn', details: { set: 'blood-gases-adult', title: shipped().title, reason: 'A figure was wrong' } });
  assert.notEqual(say(gone.library, 'What is a normal pH?').kind, 'fact');
  assert.equal(reviewCard(gone.library, 'blood-gases-adult', 'ph', WHO, AT).ok, false);
  assert.equal(ok(addSet(gone.library, shipped(), WHO, AT)).library.knowledge.length, 1, 'withdrawn cards can be added again, unchecked');
  assert.deepEqual(prepareLibrary({ families: [], revisions: [], marks: [] }).knowledge, []);
  assert.deepEqual(prepareLibrary(JSON.parse(JSON.stringify(library))).knowledge, library.knowledge);
});

test('the cards screen shows each card with its place in the source and one button to record the check', () => {
  const page = knowledgeView({ set: unchecked().knowledge[0], keeper: true, withdrawing: false }, tools);
  assert.equal(page.match(/data-action="knowledge-check"/g).length, 12);
  assert.match(page, /<b>Reference knowledge\. It is not your hospital’s protocol and not an order for any patient\.<\/b>/);
  assert.match(page, /href="https:\/\/wtcs\.pressbooks\.pub\/nursingfundamentals\/chapter\/15-5-acid-base-balance\/" target="_blank" rel="noopener noreferrer">Open the source page ↗<\/a>/);
  assert.match(page, /In the source: Table 15\.5b, step 2 · read from the page once; not cross-checked/);
  assert.match(page, /0 of 12 cards checked/);
  assert.equal(knowledgeView({ set: unchecked().knowledge[0], keeper: false, withdrawing: false }, tools).includes('knowledge-check'), false, 'only a record keeper is offered the check');
  const done = knowledgeView({ set: checkedAll().knowledge[0], keeper: true, withdrawing: false }, tools);
  assert.match(done, /12 of 12 cards checked/); assert.equal(done.includes('knowledge-check'), false);
  const home = libraryView({ library: emptyLibrary(), today: TODAY, documents: [], query: '', results: [], keeper: true, demo: false, sampleNext: null, references: null, cardSetOffered: true }, tools);
  assert.match(home, /Reference knowledge<\/h2>.*data-action="knowledge-add".*They arrive unchecked\./s);
});
