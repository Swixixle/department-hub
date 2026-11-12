import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { freshness, setFingerprint, shippedFormOf, checksForGuideline } from '../src/assurance.js';
import { addSet, factAnswer } from '../src/facts.js';
import { addGuideline, guidelineAnswer } from '../src/guidelines.js';
import { emptyLibrary } from '../src/protocols.js';
import { knowledgeView, guidelineView } from '../src/protocol-view.js';
import { shipped, held } from './witness-kit.mjs';

const read = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const SBT = () => read('src/reference/guidelines/aarc-2024-sbt.json');
const ok = result => { if (!result.ok) throw new Error(result.why); return result; };
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const tools = { h, button: (label, action) => '<button data-action="' + action + '">' + label + '</button>', valueAttr: value => 'data-value="' + h(value) + '"', shotUrl: () => '/x.png' };

test('a source checked as the newest edition says when, and asks to be checked again after its period', () => {
  const source = { current: { checkedOn: '2026-11-12', how: 'searched', recheckMonths: 12 } };
  assert.deepEqual([freshness(source, '2027-03-01').state, freshness(source, '2027-03-01').label], ['current', 'Checked as the newest edition on 2026-11-12']);
  assert.deepEqual([freshness(source, '2027-11-12').state, freshness(source, '2027-11-12').label], ['due', 'Last checked as the newest edition on 2026-11-12, 12 months ago: check for a newer one']);
  assert.deepEqual(freshness({}, '2026-11-12'), { state: 'unknown', label: 'Not checked for a newer edition' });
  for (const set of [shipped(), SBT()]) { assert.equal(freshness(set.source, '2026-11-12').state, 'current', set.id); assert.ok(set.source.current.how.length > 20, set.id + ' says how it was checked'); }
});

test('every reference answer names each check it passed and each it has not, separately', async () => {
  const facts = ok(await addSet(emptyLibrary(), shipped(), held(), 'Avery', '2026-11-12T12:00:00Z')).library;
  const fact = factAnswer('normal paco2', { protocols: facts, today: '2026-11-12' }).items[0].checks;
  assert.deepEqual(fact.map(one => [one.label, one.done]), [['Page and screenshots match their Blinders receipts', true], ['Every line found on the page’s screenshots', true], ['Every number exactly as captured', true],
    ['Nothing reworded: the source’s own words', true], ['Checked as the newest edition on 2026-11-12', true]]);
  assert.equal(factAnswer('normal paco2', { protocols: facts, today: '2028-01-05' }).items[0].checks.at(-1).done, false, 'an old check shows as not done');
  const lib = ok(await addGuideline(emptyLibrary(), SBT(), 'Avery', '2026-11-12T12:00:00Z')).library;
  const fresh = guidelineAnswer('should I turn up fio2 during sbt', { protocols: lib, today: '2026-11-12' }).items[0].checks;
  assert.deepEqual(fresh.map(one => [one.label, one.done]), [['Every number checked against an exact capture of the guideline', true], ['Restated in fixed wording, not the guideline’s text', true],
    ['Not yet found in a member’s own copy', false], ['Not yet compared with the guideline by a member', false], ['Checked as the newest edition on 2026-11-12', true]]);
  // After a member's copy has the passage and they compare it, those two checks turn done, under their name.
  const marked = { ...lib, guidelines: lib.guidelines.map(set => ({ ...set, cards: set.cards.map(card => card.id === 'r4-fio2' ? { ...card, matched: [{ by: 'Morgan' }] } : card) })) };
  const card = marked.guidelines[0].cards.find(one => one.id === 'r4-fio2');
  assert.deepEqual(checksForGuideline(marked.guidelines[0], card, () => ['Morgan'], '2026-11-12').slice(2, 4).map(one => [one.label, one.done]), [['Passage found in a member’s own copy', true], ['Compared with the guideline by Morgan', true]]);
});

test('a card set has one fingerprint: the same from the file, from the app after adding, and on the published page', async () => {
  const facts = ok(await addSet(emptyLibrary(), shipped(), held(), 'Avery', '2026-11-12T12:00:00Z'));
  const guideline = ok(await addGuideline(emptyLibrary(), SBT(), 'Avery', '2026-11-12T12:00:00Z'));
  assert.equal(facts.library.knowledge[0].fingerprint, await setFingerprint(shipped()));
  assert.equal(guideline.library.guidelines[0].fingerprint, await setFingerprint(SBT()));
  assert.equal(facts.receipt.details.fingerprint, facts.library.knowledge[0].fingerprint);
  // What the app adds while holding a set does not change it: checks made, members' comparisons, the held page.
  assert.equal(await setFingerprint(facts.library.knowledge[0]), await setFingerprint(shipped()));
  const compared = { ...guideline.library.guidelines[0], cards: guideline.library.guidelines[0].cards.map(card => ({ ...card, compared: [{ by: 'Morgan' }], matched: [{ by: 'Morgan' }] })) };
  assert.equal(await setFingerprint(compared), await setFingerprint(SBT()));
  // Any change to what was published does.
  const edited = SBT(); edited.cards[3].fields.about = 'FIO2 may be raised during a breathing trial';
  assert.notEqual(await setFingerprint(edited), await setFingerprint(SBT()));
  const reordered = Object.fromEntries(Object.entries(SBT()).reverse());
  assert.equal(await setFingerprint(reordered), await setFingerprint(SBT()), 'key order does not matter');
  assert.deepEqual(Object.keys(shippedFormOf(facts.library.knowledge[0])).sort(), Object.keys(shipped()).sort());
  const page = readFileSync(new URL('../docs/CARD-FINGERPRINTS.md', import.meta.url), 'utf8');
  for (const print of [facts.library.knowledge[0].fingerprint, guideline.library.guidelines[0].fingerprint]) assert.ok(page.includes('`' + print + '`'), 'the published page lists ' + print);
  execFileSync(process.execPath, [new URL('../scripts/card-fingerprints.mjs', import.meta.url).pathname, '--check']);
});

test('each set’s screen shows its fingerprint and whether its source is the newest edition', async () => {
  const facts = ok(await addSet(emptyLibrary(), shipped(), held(), 'Avery', '2026-11-12T12:00:00Z')).library.knowledge[0];
  const page = knowledgeView({ set: facts, keeper: true, withdrawing: false, today: '2026-11-12' }, tools);
  assert.match(page, new RegExp('<dt>Card set fingerprint</dt><dd class="digest">' + facts.fingerprint + '<small class="subtle">The same as in docs/CARD-FINGERPRINTS.md'));
  assert.equal((page.match(/<dt>/g) || []).length, (page.match(/<dd[ >]/g) || []).length, 'every value in the record has its label');
  assert.match(page, /<dt>Newest edition\?<\/dt><dd class="">Checked as the newest edition on 2026-11-12\. A web search/);
  const old = { ...facts }; delete old.fingerprint;
  assert.match(knowledgeView({ set: old, keeper: true, withdrawing: false, today: '2026-11-12' }, tools), /Not recorded: these cards were added before fingerprints were/);
  const sbt = ok(await addGuideline(emptyLibrary(), SBT(), 'Avery', '2026-11-12T12:00:00Z')).library.guidelines[0];
  assert.match(guidelineView({ set: sbt, actor: 'Avery', keeper: true, withdrawing: false, today: '2028-01-01' }, tools), /<dd class="due">Last checked as the newest edition on 2026-11-12, 14 months ago: check for a newer one/);
});
