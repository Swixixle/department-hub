import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ask } from '../src/ask.js';
import { searchReferences, cautionsFor, referenceAnswer } from '../src/references.js';
import { referencesView, libraryView } from '../src/protocol-view.js';
import { emptyLibrary } from '../src/protocols.js';
import { shipped, RECEIVED, SHIPPED } from '../scripts/make-reference-catalog.mjs';
import { world as department } from './eval/world.mjs';
import { carryThrough } from './protocol-kit.mjs';

const file = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const list = file(SHIPPED), received = file(RECEIVED), records = list.records, TODAY = '2026-11-12';
const world = { ...department, today: TODAY, last: null, references: records, referencesCollected: list.collectedOn };
const titles = new Set(records.map(record => record.title));
const shortOf = hits => hits.map(hit => hit.record.short);
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const tools = { h, button: (label, action, options = '') => '<button data-action="' + action + '" ' + options + '>' + label + '</button>', valueAttr: value => 'data-value="' + h(value) + '"' };

test('the shipped reference list is exactly what the script derives from the catalog as received', () => {
  assert.deepEqual(list, shipped(received));
  assert.equal(records.length, 106);
  assert.deepEqual(Object.fromEntries(list.sections.map(name => [name, records.filter(record => record.section === name).length])), { 'Evidence-Based Clinical Practice Guidelines': 14, 'Expert Panel Reference-Based Guidelines': 23,
    'AARC-Retired Guidelines': 26, 'Guidelines From Other Organizations': 31, 'Current Guidance Documents': 4, 'Retired Guidance Documents': 1, 'NBRC references': 7 });
  assert.equal(records.filter(record => record.retired).length, 27);
  assert.equal(new Set(records.map(record => record.id)).size, 106);
  assert.equal(new Set(records.map(record => record.url)).size, 106);
  for (const record of records) {
    assert.match(record.url, /^https?:\/\/[a-z0-9.-]+\//, record.title);
    assert.ok(!/[?&](utm_|fbclid|gclid)/.test(record.url), 'a tracking tag is in the link for ' + record.title);
    assert.ok(record.title && record.short && record.section && record.issuer && record.foundAt && record.rights, record.id);
    assert.equal(record.retired, /Retired/.test(record.section), record.title);
  }
});

test('nothing of any guideline is shipped: no description, no text, only where the document is', () => {
  const allowed = ['id', 'title', 'short', 'url', 'section', 'topic', 'groups', 'issuer', 'year', 'retired', 'kind', 'foundAt', 'related', 'rights', 'versionNote'];
  for (const record of records) assert.deepEqual(Object.keys(record).filter(key => !allowed.includes(key)), [], record.title);
  // The catalog arrived with twelve descriptions written by an AI assistant. None of their sentences is in what ships.
  const described = received.records.filter(record => record.description);
  assert.equal(described.length, 12);
  const everything = JSON.stringify(list);
  for (const record of described) for (const sentence of record.description.split(/(?<=\.)\s+/)) assert.ok(!everything.includes(sentence), 'shipped: ' + sentence);
  assert.equal(received.full_text_copies, 0);
  assert.ok(records.every(record => record.title.length < 220), 'a title field holds more than a title');
});

test('search reads titles and topics, leaves retired documents out unless asked, and puts the newest first', () => {
  assert.deepEqual(shortOf(searchReferences(records, 'suction')), ['Artificial Airway Suctioning (2022)', 'Endotracheal Suctioning of Mechanically Ventilated Patients With Artificial Airways (2010)', 'Nasotracheal Suctioning (2004)']);
  assert.deepEqual(shortOf(searchReferences(records, 'suctioning', { retired: true })).at(-1), 'Suctioning of the patient in the home (1999)');
  assert.deepEqual(shortOf(searchReferences(records, 'vent weaning')).slice(0, 2), ['Spontaneous Breathing Trials for Liberation From Adult Mechanical Ventilation (2024)', 'Weaning and Discontinuing Ventilatory Support (2002)']);
  assert.deepEqual(shortOf(searchReferences(records, 'trach kids')).slice(0, 1), ['Management of Pediatric Patients with Tracheostomy in the Acute Care Setting (2021)']);
  assert.deepEqual(shortOf(searchReferences(records, 'cpr')), ['AHA ECC 2015 Guidelines for Cardiopulmonary Resuscitation and Emergency Cardiovascular Care']);
  assert.equal(searchReferences(records, '').length, 79, 'with nothing typed, every current entry');
  assert.equal(searchReferences(records, '', { retired: true }).length, 106);
  assert.equal(searchReferences(records, '', { section: 'NBRC references' }).length, 7);
  assert.deepEqual(searchReferences(records, 'parking'), []);
  assert.deepEqual(searchReferences(records, 'guideline for the patient'), [], 'words in every title find nothing on their own');
  // The broad grouping is matched only where asked for, and ranks below a title.
  const sleep = searchReferences(records, 'sleep', { groups: true });
  assert.deepEqual([sleep[0].record.short.slice(0, 4), sleep.some(hit => hit.record.short === 'Polysomnography (1995)'), searchReferences(records, 'sleep').some(hit => hit.record.short === 'Polysomnography (1995)')], ['AASM', true, false]);
});

test('each entry carries the cautions its own listing implies', () => {
  const by = short => records.find(record => record.short === short), said = short => cautionsFor(by(short), records, TODAY);
  assert.deepEqual(said('Artificial Airway Suctioning (2022)'), [], 'a recent AARC guideline needs no caution beyond the standing notice');
  assert.deepEqual(said('Pulse oximetry (1992)').slice(0, 1), ['Retired by AARC. Kept as history, not as a reference for practice.']);
  assert.deepEqual(said('Oxygen Therapy for Adults in the Acute Care Facility (2002)'), ['Dated 2002, 24 years ago. Check with whoever issued it for something newer.',
    'AARC also lists a later document on this subject: Management of Adult Patients With Oxygen in the Acute Care Setting (2022).']);
  assert.deepEqual(said('AHA ECC 2015 Guidelines for Cardiopulmonary Resuscitation and Emergency Cardiovascular Care'), ['Issued by another organization and listed by AARC. The link is the one AARC gives. It may have moved, and its issuer may have published a newer edition.',
    'Dated 2015, 11 years ago. Check with whoever issued it for something newer.']);
  assert.ok(said('Spontaneous Breathing Trials for Liberation From Adult Mechanical Ventilation (2024)').some(line => /paper in press.*final version may differ/.test(line)));
  assert.deepEqual(said('NBRC announcements'), ['News and announcements. News is not clinical policy.']);
  assert.deepEqual(said('NBRC candidate handbook'), ['Credentialing information, not a clinical protocol.']);
  assert.ok(said('AHA/ATS Guideline: Pediatric Pulmonary Hypertension').includes('The listing gives no year.'));
  // Every one of the 31 documents from other organizations says the link may have moved, and every entry ten or more years old says so.
  assert.ok(records.filter(record => record.kind === 'external_guideline_or_standard').every(record => cautionsFor(record, records, TODAY).some(line => /may have moved/.test(line))));
  assert.ok(records.filter(record => record.year && record.year <= 2016).every(record => cautionsFor(record, records, TODAY).some(line => /years ago/.test(line))));
});

test('Ask points to a published reference and gives nothing of what it says', () => {
  const reply = ask('Is there an AARC guideline on suctioning?', world);
  assert.equal(reply.kind, 'reference');
  assert.equal(reply.title, 'Professional references on this. They are not your hospital’s protocol.');
  assert.match(reply.lines[0], /^Department Hub holds none of their text and does not summarise them\. Open the official original and read it there, with its conditions and exceptions\./);
  assert.deepEqual(reply.items.slice(0, -1).map(item => item.text), ['AARC Clinical Practice Guidelines: Artificial Airway Suctioning (2022)', 'Endotracheal Suctioning of Mechanically Ventilated Patients With Artificial Airways (2010)', 'Nasotracheal Suctioning (2004)']);
  for (const item of reply.items.slice(0, -1)) { assert.ok(titles.has(item.text), 'an item is not a listed title'); assert.equal(item.href, records.find(record => record.title === item.text).url); assert.equal(item.go, undefined); }
  assert.match(reply.items[1].sub, /2010, 16 years old: check for a newer edition · AARC also lists a later document on this subject: Artificial Airway Suctioning \(2022\)\./);
  assert.deepEqual(reply.items.at(-1).go, 'refs|suctioning');
  assert.equal(reply.lines[1], '1 retired document on this is not shown. It is in the reference list, marked as retired.');
  assert.match(reply.source, /^A list of titles and links collected from AARC’s and NBRC’s public pages on 2026-11-12\. Department Hub holds none of these documents and has not checked that any is current\. It is not your hospital’s protocol\.$/);
  assert.deepEqual(reply.context, { kind: 'reference' }, 'nothing of the question is carried forward');
  // No figure, unit or instruction can appear, because nothing but titles is held.
  assert.ok(!/\b\d+\s?(?:mm ?hg|cm ?h2o|l\/min|ml|%|seconds?|minutes?)\b/i.test(JSON.stringify([reply.title, reply.lines, reply.items])));
});

test('adult and pediatric, current and retired are kept apart', () => {
  const ids = question => ask(question, world).items.filter(item => item.href).map(item => item.text.replace(/^AARC Clinical Practice Guidelines?: /, ''));
  assert.deepEqual(ids('What does AARC say about oxygen for adults?'), ['Management of Adult Patients With Oxygen in the Acute Care Setting (2022)', 'Oxygen Therapy for Adults in the Acute Care Facility (2002)']);
  assert.deepEqual(ids('AARC trach guideline for kids'), ['Management of Pediatric Patients with Tracheostomy in the Acute Care Setting (2021)']);
  assert.deepEqual(ids('is there a guideline for weaning from the vent'), ['Spontaneous Breathing Trials for Liberation From Adult Mechanical Ventilation (2024)', 'Weaning and Discontinuing Ventilatory Support (2002)']);
  // A subject AARC lists only a retired document for is named as such and not linked from the answer.
  const retired = ask('Is there an AARC guideline on pulse oximetry?', world);
  assert.deepEqual([retired.kind, retired.title, retired.items.length, retired.items[0].go, retired.items[0].href], ['reference', 'Only retired documents are listed on this', 1, 'refs|pulse%20oximetry|retired', undefined]);
  assert.match(retired.lines[0], /^AARC lists 1 retired document whose title matches, and nothing current\. A retired guideline is history, not a reference for practice\./);
  const none = ask('What is the AARC guideline on parking?', world);
  assert.deepEqual([none.kind, none.title, none.items.map(item => item.go)], ['reference', 'No professional reference in the list is titled for that', ['refs|']]);
});

test('NBRC is credentialing and news, and is labelled so', () => {
  const reply = ask('Anything new from NBRC?', world);
  assert.equal(reply.items.filter(item => item.href).length, 7);
  assert.ok(reply.items.filter(item => item.href).every(item => /^https:\/\/www\.nbrc\.org\//.test(item.href) && /not a clinical protocol|not clinical policy|not make it an order set/.test(item.sub)));
  assert.match(reply.items.find(item => item.text === 'NBRC announcements').sub, /News and announcements\. News is not clinical policy\./);
});

test('a reference is offered only after the department\'s own records, and never in place of a schedule answer', async () => {
  // The rest of Ask answers exactly as it does with no reference list.
  for (const question of ['When do I work next?', 'Who is on tonight?', 'Who has worked the most weekends?', 'How do I request leave?', 'thanks', 'Can I go home early?', 'What did I miss on the board?'])
    assert.deepEqual(ask(question, world), ask(question, { ...world, references: [] }), question);
  assert.equal(ask('How do I request leave?', world).kind, 'look', 'a pasted document that answers still answers');
  // The department's own record answers a question even when it says "guideline" and a published title shares its subject.
  const stocked = { ...world, documents: [...world.documents, { id: 'tanks', title: 'Oxygen cylinder storage', kind: 'Procedure', effective: '2026-01-01', text: 'Oxygen cylinders\n\nOxygen cylinders are stored upright and chained in the clean utility room. Empty cylinders go on the marked rack.' }] };
  const own = ask('Is there a guideline on where oxygen cylinders are stored?', stocked);
  assert.deepEqual([own.kind, own.items[0].go.split('|').slice(0, 2).join('|')], ['look', 'doc|tanks'], 'a published reference displaced the department\'s own document');
  assert.equal(ask('Is there a guideline on where oxygen cylinders are stored?', world).kind, 'reference', 'and with no such document the same question is pointed to published references');
  // A clinical question the department's records cannot answer gets pointers, worded as such, and nothing else.
  const reply = ask('What suction pressure for a neonate?', world);
  assert.deepEqual([reply.kind, reply.title], ['reference', 'Nothing in the department’s own records answers this. Published references on the subject:']);
  assert.ok(reply.items.filter(item => item.href).length >= 3 && reply.items.filter(item => item.href).every(item => titles.has(item.text)));
  assert.equal(ask('Is there an AARC guideline on suctioning?', { ...world, references: [] }).kind === 'reference', false, 'with no list held, nothing is pointed to');
  assert.equal(referenceAnswer('Is there an AARC guideline on suctioning?', { today: TODAY }), null);
  // A held, reviewed hospital protocol comes first, even when the question says "guideline".
  const { library } = await carryThrough(emptyLibrary(), 1);
  const held = ask('What is the guideline for starting an adult Blue Trainer drill with a written order on file?', { ...world, protocols: library });
  assert.deepEqual([held.kind, held.title], ['protocol', 'Start an adult drill at 12 mk/min.']);
  // Even a question that names AARC is answered from the held protocol when it is about that protocol.
  const both = ask('AARC clinical practice guideline or not, what rate do I start an adult Blue Trainer drill at with a written order on file?', { ...world, protocols: library });
  assert.deepEqual([both.kind, both.title], ['protocol', 'Start an adult drill at 12 mk/min.']);
});

test('the reference screen shows where each document is, what the listing does not establish, and nothing of its text', () => {
  const page = referencesView({ list, query: '', section: '', retired: false, today: TODAY }, tools);
  assert.equal(page.match(/<article /g).length, 79);
  assert.match(page, /<b>These are not your hospital’s protocols\.<\/b> Each entry is a title, a year and a link to the publisher’s own copy\. Department Hub holds none of the text, does not summarise it and answers nothing from it\./);
  assert.equal(page.match(/target="_blank" rel="noopener noreferrer">Open official source ↗<\/a>/g).length, 79, 'every link leaves the app safely');
  assert.match(page, /Include retired documents \(27\)/);
  assert.ok(!page.includes('RETIRED · '));
  const all = referencesView({ list, query: '', section: '', retired: true, today: TODAY }, tools);
  assert.equal(all.match(/<article /g).length, 106);
  assert.equal(all.match(/RETIRED · /g).length, 27);
  const found = referencesView({ list, query: 'oxygen adults', section: '', retired: false, today: TODAY }, tools);
  assert.ok(found.indexOf('Management of Adult Patients With Oxygen in the Acute Care Setting (2022)') < found.indexOf('Oxygen Therapy for Adults in the Acute Care Facility (2002)'));
  assert.match(found, /AARC also lists a later document on this subject: Management of Adult Patients With Oxygen in the Acute Care Setting \(2022\)\./);
  // An entry matched only by its broad subject group is set apart from the ones whose titles match.
  const suction = referencesView({ list, query: 'suction', section: '', retired: false, today: TODAY }, tools), divider = suction.indexOf('Not matched by title. Filed under a related subject:');
  assert.ok(divider > suction.indexOf('Nasotracheal Suctioning (2004)') && divider < suction.indexOf('Bronchoscopy Assisting (2007)'));
  assert.match(suction, /3 matched by title, \d+ more filed under a related subject, of 106/);
  for (const record of received.records.filter(entry => entry.description)) assert.ok(!all.includes(record.description.slice(0, 60)), 'a description is on the screen');
  assert.match(all, /All 94 entries match the live index: same section, title, link and order\./);
  assert.match(all, /Of 23 links to other organizations, 7 were confirmed to reach the named document\. The rest could not be confirmed\. All 7 NBRC links answered\. Two are short links that lead to NBRC’s current file\./);
  const home = libraryView({ library: emptyLibrary(), today: TODAY, documents: [], query: '', results: [], keeper: false, demo: false, sampleNext: null, references: list }, tools);
  assert.match(home, /Professional references<\/h2>.*They are not your hospital’s protocols\..*data-action="reference-shelf".*Browse 106 professional references/s);
});
