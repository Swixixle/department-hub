import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ask } from '../src/ask.js';
import { addSet, withdrawSet, validateSet, verifyCapture, cardHolds, factAnswer, passagesOf, passageText, EARLIER_FORMATS } from '../src/facts.js';
import { witnessCard, shotOf } from '../src/witness.js';
import { emptyLibrary, prepareLibrary } from '../src/protocols.js';
import { knowledgeView, libraryView } from '../src/protocol-view.js';
import { world as department } from './eval/world.mjs';
import { carryThrough } from './protocol-kit.mjs';
import { shipped, held, file, PAGE, LICENCE, readingsOf } from './witness-kit.mjs';

const ID = 'blood-gases-adult-witnessed', WHO = 'Avery Stone', AT = '2026-11-12T12:00:00.000Z', TODAY = '2026-11-12';
const ok = result => { if (!result.ok) throw new Error('Refused: ' + result.why); return result; };
let added;
const library = async () => (added ||= ok(await addSet(emptyLibrary(), shipped(), held(), WHO, AT))).library;
const say = (lib, question, extra = {}) => ask(question, { ...department, today: TODAY, last: null, protocols: lib, ...extra });
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const tools = { h, button: (label, action, options = '') => '<button data-action="' + action + '" ' + options + '>' + label + '</button>', valueAttr: value => 'data-value="' + h(value) + '"', shotUrl: id => '/shots/' + id + '.png' };
const shots = () => held().shots.map(shot => shotOf(shot.id, shot.readings));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('every held file is the exact bytes Blinders saved, and the cards name each receipt', () => {
  const set = shipped(), receipts = [[PAGE, '.txt', set.source.capture], [LICENCE, '.txt', set.source.licenceCapture], ...set.source.screenshots.map(shot => ['sources/blinders-' + shot.id, '.png', shot])];
  assert.equal(set.source.screenshots.length, 7);
  for (const [path, kind, receipt] of receipts) {
    const bytes = file(path + kind), blinders = JSON.parse(file(path + '.receipt.json').toString('utf8'));
    assert.equal(sha(bytes), blinders.sha256, path + ' is not the file Blinders saved');
    assert.deepEqual([bytes.length, receipt.id, receipt.sha256, receipt.bytes, receipt.savedAt, receipt.method], [blinders.bytes, blinders.id, blinders.sha256, blinders.bytes, blinders.saved_at, blinders.capture_method]);
    assert.ok(blinders.source.startsWith(set.source.url), 'the capture is of the page the cards cite');
  }
  assert.match(held().licence, /^Nursing Fundamentals 2e Copyright © 2024 by WisTech Open is licensed under a Creative Commons Attribution 4\.0 International License/);
});

test('cards carry no wording of their own: each is a title, question wording and passages of the capture', () => {
  const set = shipped();
  assert.deepEqual(validateSet(set, held()), []);
  assert.equal(set.cards.length, 12);
  for (const card of set.cards) assert.deepEqual(Object.keys(card).sort(), ['id', 'passages', 'said', 'title', 'where']);
  const paco2 = passagesOf({ ...set, held: held() }, set.cards.find(card => card.id === 'paco2'));
  assert.match(paco2[1], /^PaCO2\tPressure of carbon dioxide in the blood\.[\s\S]*\t35–45 mmHg\tLess than 25 mmHg\.\nGreater than 60 mmHg\.$/);
  assert.match(paco2[2], /^WakeMed Pathology Laboratories\. \(2016\)\. Critical values\./);
  for (const [change, why] of [[set => { set.cards[0].answer = 'Normal is 35-45.'; }, /carries its own wording of the answer/], [set => { set.cards[0].passages = [[250, 900]]; }, /not in the captured page/],
    [set => { set.cards[0].passages = [[1, 1]]; }, /passage of blank lines/], [set => { delete set.cards[0].where; }, /does not say where/], [set => { set.cards[1].id = set.cards[0].id; }, /its own id/],
    [set => { set.source.screenshots = []; }, /receipts of the screenshots/], [set => { set.format = EARLIER_FORMATS[1]; }, /earlier format/], [set => { set.format = 'other'; }, /not a Department Hub reference card file/]]) {
    const broken = shipped(); change(broken);
    assert.ok(validateSet(broken, held()).some(line => why.test(line)), String(why));
  }
});

test('a held file that is not the captured one is refused before anything is read', async () => {
  const altered = [
    [page => ({ ...page, text: page.text.replace('35–45 mmHg', '35–55 mmHg') }), /held page is not the one captured: its SHA-256 is [0-9a-f]{8}…[0-9a-f]{6} \(25965 bytes\), the receipt says cf48652c…cde3e7 \(25965 bytes\)/],
    [page => ({ ...page, licence: page.licence.replace('4.0', '3.0') }), /held licence line is not the one captured/],
    [page => { const shots = page.shots.map(shot => ({ ...shot, bytes: shot.bytes.slice() })); shots[3].bytes[5000] ^= 1; return { ...page, shots }; }, /held screenshot 49343fa5 is not the one captured/],
    [page => ({ ...page, shots: page.shots.slice(1) }), /captured screenshot a750f9ff is not held/]];
  for (const [damage, why] of altered) { const result = await addSet(emptyLibrary(), shipped(), damage(held()), WHO, AT); assert.equal(result.ok, false); assert.match(result.why, why); }
  assert.deepEqual(await verifyCapture(shipped(), held()), []);
});

test('every line the cards show is found on the screenshots by the app’s own reader, every number exactly', async () => {
  const { receipt, set } = added || ok(await addSet(emptyLibrary(), shipped(), held(), WHO, AT));
  assert.equal(receipt.type, 'Reference cards added');
  assert.match(receipt.details.found, /^\d+ of 1100 words, every number$/);
  assert.equal(receipt.details.screenshots.length, 7);
  assert.match(receipt.details.note, /Checked by the app, not by a person/);
  for (const card of set.cards) { assert.ok(card.witness.ok, card.id); assert.ok(card.witness.matched / card.witness.words >= 0.85, card.id); assert.ok(card.witness.pictures.length >= card.passages.length - 1, card.id + ' has a picture per passage'); }
  assert.ok(!JSON.stringify(set).includes('"readings"'), 'the readings are used to check, not kept');
});

test('a changed word or number is refused by the screenshots even when its receipt is forged to match', async () => {
  // Each change made to the held text, with the page's receipt recomputed so the hash check passes. Only the
  // screenshots stand between the change and an answer.
  const changes = [['\t35–45 mmHg\tLess than 25 mmHg.', '\t35–45 mmHg\tLess than 60 mmHg.'], ['Greater than 60 mmHg.', 'Greater than 45 mmHg.'], ['Less than 60 mmHg.', 'Less than 25 mmHg.'],
    ['\t7.35–7.45\tLess than 7.25.', '\t7.25–7.45\tLess than 7.35.'], ['Less than 88%.', 'Less than 95%.'], ['Less than 10 mEq/L.', 'Less than 22 mEq/L.'],
    ['and the PaCO2 is >45, or acidotic, this is respiratory acidosis', 'and the PaCO2 is >35, or acidotic, this is respiratory acidosis'], ['HCO3 <22 is considered acidotic.', 'HCO3 <22 is considered alkalotic.'],
    ['HCO3 is a base managed by the kidneys.', 'HCO3 is a base managed by the lungs.'], ['PaCO2 and HCO3 are both out of range.', 'PaCO2 or HCO3 is out of range.'],
    ['PaCO2 or HCO3 is abnormal, but not both.', 'PaCO2 or HCO3 is abnormal, but both.'], ['pH <7.35 is acidosis.', 'pH >7.35 is acidosis.'],
    ['As PaCO2 increases, the blood becomes more acidic and the pH decreases.', 'As PaCO2 increases, the blood becomes more acidic and the pH increases.'],
    // A number the page never showed, added beside the real ones.
    ['Less than 88%.', 'Less than 88% or 90%.']];
  for (const [from, to] of changes) {
    const page = held(), text = page.text.replace(from, to), set = shipped();
    assert.notEqual(text, page.text, from);
    set.source.capture = { ...set.source.capture, sha256: sha(Buffer.from(text, 'utf8')), bytes: Buffer.byteLength(text, 'utf8') };
    const result = await addSet(emptyLibrary(), set, { ...page, text }, WHO, AT);
    assert.equal(result.ok, false, 'the screenshots let through: ' + to);
    assert.match(result.why, /The screenshots do not bear out \d+ of them/);
  }
  // And the screenshots of one part of the page cannot stand in for another's.
  const page = held(), swapped = { ...page, shots: page.shots.map((shot, index) => ({ ...shot, readings: index === 0 ? readingsOf(page.shots[6].id) : shot.readings })) };
  assert.equal((await addSet(emptyLibrary(), shipped(), swapped, WHO, AT)).ok, false);
  // The honest text, line by line, is borne out.
  const all = shipped().cards.map(card => witnessCard(card.passages.map(range => passageText(held().text, range)), shots()));
  assert.ok(all.every(result => result.ok));
});

test('an answer is the source’s own words, with the picture of where they were found', async () => {
  const lib = await library(), reply = say(lib, 'What is a normal PaCO2?');
  assert.deepEqual([reply.kind, reply.fact.status, reply.title], ['fact', 'answer', 'From the source: PaCO2: normal and critical values']);
  assert.equal(reply.lines[0], 'Reference knowledge. It is not your hospital’s protocol and not an order for any patient. Adult values, as the source\'s own table is titled. A laboratory sets its own reference ranges and critical values, and your hospital\'s may differ.');
  const item = reply.items[0];
  assert.deepEqual(item.quote, passagesOf(lib.knowledge[0], lib.knowledge[0].cards.find(card => card.id === 'paco2')));
  assert.ok(item.quote.some(text => text.includes('\t35–45 mmHg\tLess than 25 mmHg.')));
  assert.ok(item.pictures.some(picture => picture.passage === 1 && picture.marks.length >= 3), 'the PaCO2 row is outlined on its screenshot');
  assert.match(item.sub, /exact text captured with Blinders on 2026-11-12, SHA-256 cf48652c…cde3e7 · found on the page’s screenshots: \d+ of \d+ words, every number$/);
  assert.match(reply.source, /with 7 screenshots\. Checked by the app, not by a person/);
  assert.ok(!JSON.stringify(reply).includes('the source lists'), 'no paraphrase anywhere in the answer');
  const expected = { 'normal abg values': 'abg-normal', 'whats the normal range for PaCO2': 'paco2', 'normal po2?': 'pao2', 'what should bicarb be': 'hco3', 'normal arterial saturation': 'sao2', 'critical values for an abg': 'abg-critical',
    'is a low pH acidosis or alkalosis': 'acidosis-alkalosis', 'what is respiratory acidosis': 'respiratory', 'how do I tell metabolic alkalosis': 'metabolic', 'is it compensated or uncompensated': 'compensation', 'which is the respiratory component': 'lungs-kidneys' };
  for (const [question, card] of Object.entries(expected)) assert.deepEqual(say(lib, question).fact?.cards, [card], question);
  assert.deepEqual(say(lib, 'normal ph and paco2').fact.cards, ['ph', 'paco2']);
  const typo = say(lib, 'normal bicarbonte level');
  assert.deepEqual([typo.fact.cards, typo.changes], [['hco3'], [['bicarbonte', 'bicarbonate']]]);
});

test('a card answers only what it is about, and never ahead of a held protocol or instead of the schedule', async () => {
  const lib = await library();
  for (const question of ['What is a normal SpO2?', 'normal pulse ox', 'what sat should I titrate to']) assert.notEqual(say(lib, question).kind, 'fact', question);
  for (const question of ['When do I work next?', 'Who is on tonight?', 'How do I request leave?', 'thanks'])
    assert.deepEqual(say(lib, question), say(emptyLibrary(), question), question + ' answers exactly as it does with no cards held');
  const { library: withProtocol } = await carryThrough(lib, 1);
  assert.equal(say(withProtocol, 'What rate do I start an adult Blue Trainer drill at, with a written order on file?').kind, 'protocol');
  assert.equal(say(withProtocol, 'What is a normal pH?').kind, 'fact');
});

test('a card changed after it was added stops answering', async () => {
  for (const damage of [set => { set.cards.find(card => card.id === 'paco2').passages[1] = [49, 49]; }, set => { set.held.text = set.held.text.replace('\t35–45 mmHg\tLess than 25 mmHg.', '\t35–45 mmHg\tLess than 20 mmHg.'); },
    set => { set.source.capture.sha256 = '0'.repeat(64); }, set => { set.cards.find(card => card.id === 'paco2').witness.matched = 78; }]) {
    const lib = structuredClone(await library()); damage(lib.knowledge[0]);
    assert.equal(cardHolds(lib.knowledge[0], lib.knowledge[0].cards.find(card => card.id === 'paco2')), false);
    assert.deepEqual([say(lib, 'What is a normal PaCO2?').fact.status, say(lib, 'What is a normal PaCO2?').items[0].go], ['broken', 'knowledge|' + ID]);
  }
});

test('earlier cards stop answering and are withdrawn, with the reason, when these arrive', async () => {
  const earlier = { format: EARLIER_FORMATS[1], id: 'blood-gases-adult-captured', title: 'Arterial blood gases', applies: 'Adult values.', source: shipped().source, held: { text: held().text },
    cards: [{ id: 'ph', title: 'Arterial pH', where: 'Table 15.5a', passages: [[38, 46]], said: ['normal ph'], answer: 'Adult normal arterial pH is 7.35-7.45.', review: { by: WHO, at: AT, seal: 'x' } }], added: { by: WHO, at: AT }, withdrawn: null };
  const lib = { ...emptyLibrary(), knowledge: [earlier] };
  assert.equal(factAnswer('What is a normal pH?', { today: TODAY, protocols: lib }), null, 'a set checked by a person against an AI paraphrase no longer answers');
  assert.match(knowledgeView({ set: earlier, keeper: true, withdrawing: false }, tools), /in an earlier format and no longer answer/);
  const result = ok(await addSet(lib, shipped(), held(), WHO, AT));
  assert.deepEqual(result.replaced, ['blood-gases-adult-captured']);
  assert.match(result.library.knowledge.find(set => set.id === 'blood-gases-adult-captured').withdrawn.reason, /^Replaced by cards in the source’s own words, borne out by screenshots of the page/);
});

test('withdrawing needs a reason, is recorded, and stops the answers; an older workspace opens with no cards', async () => {
  const lib = await library();
  assert.equal(withdrawSet(lib, ID, ' ', WHO, AT).ok, false);
  const gone = ok(withdrawSet(lib, ID, 'A figure was wrong', WHO, AT));
  assert.deepEqual(gone.receipt, { type: 'Reference cards withdrawn', details: { set: ID, title: shipped().title, reason: 'A figure was wrong' } });
  assert.notEqual(say(gone.library, 'What is a normal pH?').kind, 'fact');
  assert.equal((await addSet(lib, shipped(), held(), WHO, AT)).why, 'These reference cards are already held.');
  assert.deepEqual(prepareLibrary({ families: [], revisions: [], marks: [] }).knowledge, []);
  assert.deepEqual(prepareLibrary(JSON.parse(JSON.stringify(lib))).knowledge, lib.knowledge);
});

test('the cards screen shows each card’s passages and pictures, the receipts, and no button for a person to vouch', async () => {
  const page = knowledgeView({ set: (await library()).knowledge[0], keeper: true, withdrawing: false }, tools);
  assert.equal(page.includes('knowledge-check'), false);
  assert.match(page, /12 of 12 cards answering/);
  assert.match(page, /<dt>SHA-256<\/dt><dd class="digest">cf48652c3a646897627597f3827d14b412a963bc7e354604b4c9524071cde3e7<\/dd>/);
  assert.match(page, /<dt>Screenshots<\/dt><dd>7, captured with Blinders 2026-11-12\./);
  assert.match(page, /Checked by the app, not by a person/);
  assert.match(page, /The page’s licence line, as captured: “Nursing Fundamentals 2e Copyright © 2024 by WisTech Open/);
  assert.equal(page.match(/<blockquote class="source-quote">/g).length, shipped().cards.reduce((sum, card) => sum + card.passages.length, 0));
  assert.ok(page.match(/<figure class="capture-picture"><div class="capture-frame"><svg viewBox="\d+ \d+ \d+ \d+" style="width:\d+px"/g).length >= 30);
  assert.match(page, /<image href="\/shots\/a750f9ff-51dd-4d9d-b64e-907920f74567\.png" x="0" y="0" width="2812" height="1540"\/>/);
  const home = libraryView({ library: emptyLibrary(), today: TODAY, documents: [], query: '', results: [], keeper: true, demo: false, sampleNext: null, references: null, cardSetOffered: true }, tools);
  assert.match(home, /Reference knowledge<\/h2>.*data-action="knowledge-add".*reads the page’s screenshots on this device/s);
});
