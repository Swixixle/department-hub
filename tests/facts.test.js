import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ask } from '../src/ask.js';
import { addSet, reviewCard, withdrawSet, validateSet, verifyCapture, cardHolds, factAnswer, passagesOf, numbersOf, OLD_FORMAT } from '../src/facts.js';
import { emptyLibrary, prepareLibrary } from '../src/protocols.js';
import { knowledgeView, libraryView } from '../src/protocol-view.js';
import { world as department } from './eval/world.mjs';
import { carryThrough } from './protocol-kit.mjs';

const file = path => readFileSync(new URL('../src/reference/' + path, import.meta.url));
const shipped = () => JSON.parse(file('cards-blood-gases.json').toString('utf8'));
const PAGE = 'sources/blinders-cef48181-5ed3-4ff5-b07d-382304cdcf95', LICENCE = 'sources/blinders-b0473561-e3f8-41c7-bb7f-0f8267669a62';
const held = () => ({ text: file(PAGE + '.txt').toString('utf8'), licence: file(LICENCE + '.txt').toString('utf8') });
const ID = 'blood-gases-adult-captured', WHO = 'Avery Stone', AT = '2026-11-12T12:00:00.000Z', TODAY = '2026-11-12';
const ok = result => { if (!result.ok) throw new Error('Refused: ' + result.why); return result; };
const unchecked = async () => ok(await addSet(emptyLibrary(), shipped(), held(), WHO, AT)).library;
const checkedAll = async () => shipped().cards.reduce((library, card) => ok(reviewCard(library, ID, card.id, WHO, AT)).library, await unchecked());
const say = (library, question, extra = {}) => ask(question, { ...department, today: TODAY, last: null, protocols: library, ...extra });
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const tools = { h, button: (label, action, options = '') => '<button data-action="' + action + '" ' + options + '>' + label + '</button>', valueAttr: value => 'data-value="' + h(value) + '"' };
const refused = async (set, page = held()) => [...await verifyCapture(set, page), ...validateSet(set, page)];

test('the held page is the exact bytes Blinders saved, and its receipt says so', () => {
  const set = shipped();
  for (const [path, receipt] of [[PAGE, set.source.capture], [LICENCE, set.source.licenceCapture]]) {
    const bytes = file(path + '.txt'), blinders = JSON.parse(file(path + '.receipt.json').toString('utf8'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), blinders.sha256, path + ' is not the file Blinders saved');
    assert.deepEqual([bytes.length, receipt.id, receipt.sha256, receipt.bytes, receipt.savedAt, receipt.method], [blinders.bytes, blinders.id, blinders.sha256, blinders.bytes, blinders.saved_at, blinders.capture_method]);
    assert.equal(blinders.source, set.source.url, 'the capture is of the page the cards cite');
  }
  assert.equal(set.source.capture.sha256, 'cf48652c3a646897627597f3827d14b412a963bc7e354604b4c9524071cde3e7');
  assert.match(held().licence, /^Nursing Fundamentals 2e Copyright © 2024 by WisTech Open is licensed under a Creative Commons Attribution 4\.0 International License/);
});

test('the shipped cards pass every check, and each kind of fault is refused', async () => {
  const set = shipped();
  assert.deepEqual(await refused(set), []);
  assert.equal(set.cards.length, 12);
  assert.equal(set.source.licence, 'Creative Commons Attribution 4.0 International');
  // The figures, written here once more. Changing one must be a deliberate act in two places.
  const answer = id => set.cards.find(card => card.id === id).answer;
  assert.equal(answer('abg-normal'), 'Adult normal arterial blood gas values: pH 7.35-7.45, PaO2 80-100 mmHg, PaCO2 35-45 mmHg, HCO3 22-26 mEq/L, SaO2 95-100%.');
  assert.match(answer('paco2'), /35-45 mmHg\..*less than 25 mmHg or greater than 60 mmHg/);
  assert.doesNotMatch(answer('sao2'), /oximeter/, 'a claim the page does not make');
  assert.deepEqual(numbersOf('PaO2 80-100 mmHg, HCO3 22, pH 7.35, in 2016'), ['80', '100', '22', '7.35', '2016'], 'the 2 in PaO2 is a name, not a figure');
  // Each passage is the captured text itself. The PaCO2 card rests on the table's PaCO2 row.
  const page = { ...set, held: held() }, paco2 = passagesOf(page, set.cards.find(card => card.id === 'paco2'));
  assert.ok(paco2.every(passage => held().text.includes(passage.split('\n')[0])));
  assert.match(paco2[1], /^PaCO2\tPressure of carbon dioxide in the blood\.[\s\S]*\t35–45 mmHg\tLess than 25 mmHg\.\nGreater than 60 mmHg\.$/);
  assert.match(paco2[2], /^WakeMed Pathology Laboratories\. \(2016\)\. Critical values\./);
  const faults = [
    [set => { set.cards.find(card => card.id === 'paco2').answer = 'Adult normal PaCO2 is 35-55 mmHg.'; }, null, /states 55, which its passages do not contain/],
    [set => { set.cards.find(card => card.id === 'ph').passages = [[44, 44]]; set.cards.find(card => card.id === 'ph').answer = 'A critical pH is less than 7.20.'; }, null, /states 7\.20/],
    [set => { set.cards[0].passages = [[250, 900]]; }, null, /cites a passage that is not in the captured page/],
    [set => { set.cards[0].passages = [[1, 1]]; }, null, /cites a passage of blank lines/],
    [set => { delete set.cards[0].where; }, null, /does not say where in the source/],
    [set => { set.cards[1].id = set.cards[0].id; }, null, /its own id/],
    [set => { set.source.url = 'http://example.org/x'; }, null, /secure web address/],
    [set => { delete set.source.capture.sha256; }, null, /receipt of the capture/],
    [set => { set.format = OLD_FORMAT; }, null, /earlier format, which rested on an AI reading/],
    [() => {}, page => ({ ...page, text: page.text.replace('35–45 mmHg', '35–55 mmHg') }), /held page is not the one captured: its SHA-256 is [0-9a-f]{8}…[0-9a-f]{6} \(25965 bytes\), the receipt says cf48652c…cde3e7 \(25965 bytes\)/],
    [() => {}, page => ({ ...page, text: page.text + ' ' }), /held page is not the one captured/],
    [() => {}, page => ({ ...page, licence: page.licence.replace('4.0', '3.0') }), /held licence line is not the one captured/],
    [() => {}, page => ({ licence: page.licence }), /captured page is not held/]];
  for (const [change, damage, why] of faults) {
    const broken = shipped(); change(broken); const page = damage ? damage(held()) : held();
    assert.ok((await refused(broken, page)).some(line => why.test(line)), String(why) + ' got ' + JSON.stringify(await refused(broken, page)));
    assert.equal((await addSet(emptyLibrary(), broken, page, WHO, AT)).ok, false, String(why));
  }
});

test('a card answers nothing until a person has checked it against its passages, and stops if it is changed afterwards', async () => {
  const claimed = shipped(); for (const card of claimed.cards) card.review = { by: 'The file itself', at: AT, seal: 'anything' };
  const arrived = ok(await addSet(emptyLibrary(), claimed, held(), WHO, AT));
  assert.ok(arrived.library.knowledge[0].cards.every(card => !card.review), 'a file cannot arrive already checked');
  assert.deepEqual([arrived.receipt.type, arrived.receipt.details.capture, arrived.receipt.details.sha256, arrived.receipt.details.bytes],
    ['Reference cards added', 'cef48181-5ed3-4ff5-b07d-382304cdcf95', 'cf48652c3a646897627597f3827d14b412a963bc7e354604b4c9524071cde3e7', 25965]);
  assert.equal(arrived.library.knowledge[0].held.text, held().text, 'the page is held with the cards');
  const waiting = say(arrived.library, 'What is a normal PaCO2?');
  assert.deepEqual([waiting.kind, waiting.fact.status, waiting.title], ['fact', 'unchecked', 'A reference card on this is held and has not been checked against its source']);
  assert.ok(!/\d{2}/.test(JSON.stringify([waiting.title, waiting.lines, waiting.items])), 'an unchecked card showed a figure or a passage');
  assert.equal(waiting.items[0].go, 'knowledge|' + ID);
  const one = ok(reviewCard(arrived.library, ID, 'paco2', WHO, AT));
  assert.deepEqual([one.receipt.type, one.receipt.details.card, one.receipt.details.where, one.receipt.details.capture], ['Reference card checked', 'PaCO2', 'Table 15.5a, PaCO2 row', 'cef48181-5ed3-4ff5-b07d-382304cdcf95']);
  assert.match(one.receipt.details.note, /a check that the card says what the captured passage says\. It is not clinical sign-off\./);
  assert.match(say(one.library, 'What is a normal PaCO2?').title, /^Adult normal PaCO2 is 35-45 mmHg\. The source lists a PaCO2 less than 25 mmHg or greater than 60 mmHg as critical/);
  assert.equal(say(one.library, 'What is a normal pH?').fact.status, 'unchecked', 'checking one card does not check its neighbours');
  // After the check: one digit of the card, its passage range, or the receipt it cites. Each stops it answering.
  for (const [what, damage] of [['answer', set => { set.cards.find(card => card.id === 'paco2').answer = 'Adult normal PaCO2 is 35-55 mmHg.'; }],
    ['passage', set => { set.cards.find(card => card.id === 'paco2').passages[1] = [49, 49]; }], ['capture', set => { set.source.capture.sha256 = '0'.repeat(64); }], ['page', set => { set.source.url = 'https://example.org/another-page/'; }],
    ['held text', set => { set.held.text = set.held.text.replace('\t35–45 mmHg\tLess than 25 mmHg.', '\t35–45 mmHg\tLess than 20 mmHg.'); }]]) {
    const edited = structuredClone(one.library); damage(edited.knowledge[0]);
    assert.equal(cardHolds(edited.knowledge[0], edited.knowledge[0].cards.find(card => card.id === 'paco2')), false, what);
    assert.equal(say(edited, 'What is a normal PaCO2?').fact.status, 'unchecked', what);
  }
  assert.equal((await addSet(one.library, shipped(), held(), WHO, AT)).why, 'These reference cards are already held.');
  assert.equal(reviewCard(one.library, ID, 'no-such-card', WHO, AT).ok, false);
});

test('checked cards answer in ordinary words, with the source’s own words under them', async () => {
  const library = await checkedAll(), reply = say(library, 'What is a normal pH?');
  assert.equal(reply.kind, 'fact');
  assert.equal(reply.title, 'Adult normal arterial pH is 7.35-7.45. The source lists a pH less than 7.25 or greater than 7.60 as critical, crediting its critical values to one laboratory\'s 2016 list.');
  assert.equal(reply.lines[0], 'Reference knowledge. It is not your hospital’s protocol and not an order for any patient. Adult values, as the source\'s own table is titled. A laboratory sets its own reference ranges and critical values, and your hospital\'s may differ.');
  assert.deepEqual([reply.items.length, reply.items[0].text, reply.items[0].href, reply.items[0].go], [1, 'The source’s own words · Table 15.5a, pH row', shipped().source.url, undefined]);
  assert.deepEqual(reply.items[0].quote, passagesOf({ ...shipped(), held: held() }, shipped().cards.find(card => card.id === 'ph')));
  assert.ok(reply.items[0].quote.some(passage => passage.includes('\t7.35–7.45\tLess than 7.25.')), 'the figure is shown in the source’s own words');
  assert.equal(reply.items[0].sub, 'WisTech Open (Open RN), 2024 · Creative Commons Attribution 4.0 International · exact text captured with Blinders on 2026-11-12, SHA-256 cf48652c…cde3e7');
  assert.match(reply.source, /held as Blinders capture cef48181-5ed3-4ff5-b07d-382304cdcf95\. The card was checked against those passages by Avery Stone on 2026-11-12, under the profile selected on this device\. That is a check that the card says what the passage says, not clinical sign-off\.$/);
  assert.deepEqual(reply.context, { kind: 'fact' }, 'nothing of the question is carried forward');
  const expected = { 'normal abg values': 'abg-normal', 'whats the normal range for PaCO2': 'paco2', 'normal po2?': 'pao2', 'what should bicarb be': 'hco3', 'normal arterial saturation': 'sao2', 'critical values for an abg': 'abg-critical',
    'is a low pH acidosis or alkalosis': 'acidosis-alkalosis', 'what is respiratory acidosis': 'respiratory', 'how do I tell metabolic alkalosis': 'metabolic', 'is it compensated or uncompensated': 'compensation', 'which is the respiratory component': 'lungs-kidneys' };
  for (const [question, card] of Object.entries(expected)) assert.deepEqual(say(library, question).fact?.cards, [card], question);
  // Two subjects in one question: both cards, neither dropped, each with its own passages.
  const both = say(library, 'normal ph and paco2');
  assert.deepEqual([both.fact.cards, both.title, both.lines.slice(0, 2).map(line => line.slice(0, 22)), both.items.map(item => item.card)], [['ph', 'paco2'], 'Reference cards on this:', ['Adult normal arterial ', 'Adult normal PaCO2 is '], ['ph', 'paco2']]);
  const typo = say(library, 'normal bicarbonte level');
  assert.deepEqual([typo.fact.cards, typo.changes, typo.read], [['hco3'], [['bicarbonte', 'bicarbonate']], 'normal bicarbonate level']);
  assert.deepEqual(say(library, 'metabolic alkalosys').fact.cards, ['metabolic']);
});

test('a card answers only what it is about: not the pulse oximeter, not the schedule, not ahead of a held protocol', async () => {
  const library = await checkedAll();
  for (const question of ['What is a normal SpO2?', 'normal pulse ox', 'what sat should I titrate to']) assert.notEqual(say(library, question).kind, 'fact', question);
  for (const question of ['When do I work next?', 'Who is on tonight?', 'Who has worked the most weekends?', 'How do I request leave?', 'thanks', 'What did I miss on the board?'])
    assert.deepEqual(say(library, question), say(emptyLibrary(), question), question + ' answers exactly as it does with no cards held');
  assert.equal(factAnswer('What is a normal pH?', { today: TODAY, protocols: emptyLibrary() }), null);
  const { library: withProtocol } = await carryThrough(library, 1);
  assert.equal(withProtocol.knowledge.length, 1, 'adding a protocol leaves the cards in place');
  const protocol = say(withProtocol, 'What rate do I start an adult Blue Trainer drill at, with a written order on file?');
  assert.deepEqual([protocol.kind, protocol.title], ['protocol', 'Start an adult drill at 12 mk/min.']);
  assert.equal(say(withProtocol, 'What is a normal pH?').kind, 'fact');
  const before = JSON.stringify(library); for (let turn = 0; turn < 20; turn++) say(library, 'What is a normal pH?', { learned: [{ terms: ['normal', 'ph'], go: 'doc|thin|0', count: 50, sourceHash: 'x' }] });
  assert.equal(JSON.stringify(library), before, 'answering changed the cards');
});

test('cards from the earlier format stop answering, and are withdrawn with a reason when the captured cards arrive', async () => {
  // A workspace that took in the earlier cards and checked them all: an AI reading of the page, with nothing held.
  const earlier = { format: OLD_FORMAT, id: 'blood-gases-adult', title: 'Arterial blood gases', applies: 'Adult values.', source: { ...shipped().source, capture: undefined, licenceCapture: undefined },
    cards: [{ id: 'ph', title: 'Arterial pH', where: 'Table 15.5a', read: 'twice', said: ['normal ph'], answer: 'Adult normal arterial pH is 7.35-7.45.', review: { by: WHO, at: AT, seal: 'x' } }], added: { by: WHO, at: AT }, withdrawn: null };
  const library = { ...emptyLibrary(), knowledge: [earlier] };
  assert.equal(factAnswer('What is a normal pH?', { today: TODAY, protocols: library }), null, 'an AI reading with no held page answers nothing');
  assert.equal(reviewCard(library, 'blood-gases-adult', 'ph', WHO, AT).ok, false);
  assert.match(knowledgeView({ set: earlier, keeper: true, withdrawing: false }, tools), /in the earlier format\. Their figures were read from the page by an AI assistant/);
  const added = ok(await addSet(library, shipped(), held(), WHO, AT));
  assert.deepEqual([added.replaced, added.receipt.details.replaced], [['blood-gases-adult'], ['blood-gases-adult']]);
  assert.equal(added.library.knowledge.find(set => set.id === 'blood-gases-adult').withdrawn.reason, 'Replaced by cards resting on a captured copy of the page (Blinders capture cef48181-5ed3-4ff5-b07d-382304cdcf95).');
});

test('withdrawing needs a reason, is recorded, and stops the answers; an older workspace opens with no cards', async () => {
  const library = await checkedAll();
  assert.equal(withdrawSet(library, ID, ' ', WHO, AT).ok, false);
  const gone = ok(withdrawSet(library, ID, 'A figure was wrong', WHO, AT));
  assert.deepEqual(gone.receipt, { type: 'Reference cards withdrawn', details: { set: ID, title: shipped().title, reason: 'A figure was wrong' } });
  assert.notEqual(say(gone.library, 'What is a normal pH?').kind, 'fact');
  assert.equal(reviewCard(gone.library, ID, 'ph', WHO, AT).ok, false);
  assert.equal(ok(await addSet(gone.library, shipped(), held(), WHO, AT)).library.knowledge.length, 1, 'withdrawn cards can be added again, unchecked');
  assert.deepEqual(prepareLibrary({ families: [], revisions: [], marks: [] }).knowledge, []);
  assert.deepEqual(prepareLibrary(JSON.parse(JSON.stringify(library))).knowledge, library.knowledge);
});

test('the cards screen shows each card over its passages, the capture receipt, and one button to record the check', async () => {
  const page = knowledgeView({ set: (await unchecked()).knowledge[0], keeper: true, withdrawing: false }, tools);
  assert.equal(page.match(/data-action="knowledge-check"/g).length, 12);
  assert.match(page, /<b>Reference knowledge\. It is not your hospital’s protocol and not an order for any patient\.<\/b>/);
  assert.match(page, /<dt>SHA-256<\/dt><dd class="digest">cf48652c3a646897627597f3827d14b412a963bc7e354604b4c9524071cde3e7<\/dd><dt>Size<\/dt><dd>25,965 bytes<\/dd>/);
  assert.match(page, /The page’s licence line, as captured: “Nursing Fundamentals 2e Copyright © 2024 by WisTech Open is licensed under a Creative Commons Attribution 4\.0 International License/);
  assert.match(page, /The source’s own words · Table 15\.5b, step 2<\/p><blockquote class="source-quote">Step 2: PaCO2, normal 35–45 mmHg\tIs the PaCO2 normal\?/);
  assert.equal(page.match(/<blockquote class="source-quote">/g).length, shipped().cards.reduce((sum, card) => sum + card.passages.length, 0));
  assert.match(page, /0 of 12 cards checked/);
  assert.equal(knowledgeView({ set: (await unchecked()).knowledge[0], keeper: false, withdrawing: false }, tools).includes('knowledge-check'), false, 'only a record keeper is offered the check');
  const done = knowledgeView({ set: (await checkedAll()).knowledge[0], keeper: true, withdrawing: false }, tools);
  assert.match(done, /12 of 12 cards checked/); assert.equal(done.includes('knowledge-check'), false);
  const home = libraryView({ library: emptyLibrary(), today: TODAY, documents: [], query: '', results: [], keeper: true, demo: false, sampleNext: null, references: null, cardSetOffered: true }, tools);
  assert.match(home, /Reference knowledge<\/h2>.*data-action="knowledge-add".*resting on a Blinders capture.*They arrive unchecked\./s);
});
