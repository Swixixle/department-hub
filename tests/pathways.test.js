// Synthetic test material — NOT FOR CLINICAL USE. Every protocol, device, unit, role and number here is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS } from './protocol-contract.mjs';
import { runFaults, FAULTS } from '../scripts/protocol-faults.mjs';
import { emptyLibrary, activate, bundlesOf } from '../src/protocols.js';
import { addMapping, reviewBundle, markMappingsReviewed, validateMapping, validateBundle, reviewHolds, resolve, figuresOf, wholeRule, UNKNOWN } from '../src/bundles.js';
import { protocolAnswer, protocolTopics } from '../src/pathways.js';
import { passageAt } from '../src/pdftext.js';
import { carryThrough, mappingFor, ok } from './protocol-kit.mjs';

const WHO = 'Avery Stone', AT = '2026-11-10T12:00:00.000Z';

// The contract, one test per check, so a failure names the behaviour that broke.
for (const [name, check] of CHECKS) test('contract · ' + name, check);

test('every deliberate fault is caught by the check written for it, and the unbroken copy passes', { timeout: 120000 }, () => {
  const report = runFaults();
  assert.deepEqual(report.control.failed, [], 'the unbroken copy must pass every check, positive control included');
  assert.equal(report.faults.length, FAULTS.length);
  for (const fault of report.faults) assert.ok(fault.caught, fault.name + ': ' + (fault.error || 'not caught; expected ' + fault.missed.join(', ')));
  // The five named in the brief are each present.
  for (const named of ['remove the contraindication link', 'alter a unit', 'select the wrong age branch', 'remove the order requirement', 'reuse a superseded revision'])
    assert.ok(report.faults.some(fault => fault.name.startsWith(named) && fault.caught), named);
});

test('figures are read with the word that follows them', () => {
  assert.deepEqual(figuresOf('Start at 12 mk/min. Recheck after 10 minutes; never above 20 mk/min, or 30 marks.').map(figure => figure.said), ['12 mk/min', '10 minutes', '20 mk/min', '30 marks']);
  assert.deepEqual(figuresOf('Adult (18 years and over) · 0.5 L/min · 40%').map(figure => figure.said), ['18 years', '0.5 l/min', '40 %']);
  assert.deepEqual(figuresOf('No figures here.'), []);
});

test('a mapping is refused whole, with the reason, when any part of it does not hold', async () => {
  const { library } = await carryThrough(emptyLibrary(), 1, { upTo: 'checked' }), revision = library.revisions[0];
  const broken = (edit, complaint) => { const mapping = mappingFor(1); edit(mapping, id => mapping.topics.flatMap(topic => topic.bundles).find(bundle => bundle.id === id));
    const problems = validateMapping(revision, mapping); assert.ok(problems.some(problem => complaint.test(problem)), String(complaint) + ' not among ' + JSON.stringify(problems));
    assert.equal(addMapping(library, revision.id, mapping, WHO, AT).ok, false); };
  // Removing the do-not-start link while the answer still says it must carry one.
  broken((mapping, bundle) => { bundle('start-adult').links = bundle('start-adult').links.filter(link => link.role !== 'exception'); }, /"Starting an adult drill" must carry do not go ahead if and links none\./);
  broken((mapping, bundle) => { bundle('start-adult').links[0].anchor = 'p9.b9'; }, /links p9\.b9, which is not a passage in this revision/);
  broken((mapping, bundle) => { bundle('start-adult').links[0].hash = 'f'.repeat(24); }, /links p2\.b3\.r1, which does not read the way it did when the mapping was written/);
  // Pointing a link at a diagram label, a heading or a running line, with the right hash for it, is still refused.
  const aim = (link, anchor) => { link.anchor = anchor; link.hash = passageAt(revision.extraction, anchor).hash; };
  broken((mapping, bundle) => aim(bundle('start-adult').links[0], 'p3.b17'), /links p3\.b17, a label inside a diagram\. A diagram label cannot stand as a rule/);
  broken((mapping, bundle) => aim(bundle('start-adult').links[0], 'p2.b2'), /links p2\.b2, a heading\. Link the passage under it\./);
  broken((mapping, bundle) => aim(bundle('start-adult').links[0], 'p1.b1'), /links p1\.b1, a running header or footer\./);
  broken((mapping, bundle) => { bundle('start-adult').links[0].digest = 'e'.repeat(64); }, /links p2\.b3\.r1 in file eeeeeeeeeeee, which is not this revision \(d09ae851f3b2\)/);
  broken((mapping, bundle) => { bundle('start-adult').links[0].role = 'vibes'; }, /unknown kind of link: vibes/);
  broken((mapping, bundle) => { bundle('start-adult').requires = []; }, /does not say which kinds of passage it must carry/);
  broken((mapping, bundle) => { bundle('start-adult').when.age = 'elderly'; }, /depends on age being "elderly", which is not one of its choices/);
  broken((mapping, bundle) => { delete bundle('start-no-order').when.order; }, /could both apply to the same situation/);
  broken((mapping, bundle) => { bundle('start-pediatric').when = { age: 'adult', order: 'yes' }; }, /"Starting an adult drill" and "Starting a pediatric drill" could both apply/);
  broken(mapping => { mapping.facts.age.options.push({ value: UNKNOWN, label: 'Unknown' }); }, /reserved value "unknown"/);
  broken(mapping => { mapping.topics[0].needs.push('weight'); }, /asks about "weight", which the mapping does not define/);
  broken(mapping => { mapping.format = 'something-else'; }, /not a Department Hub protocol mapping file/);
  broken(mapping => { mapping.topics = []; }, /has no topics/);
  assert.deepEqual(validateMapping(revision, mappingFor(1)), []);
});

test('mapping needs a confirmed reading, review is one answer at a time, and activation needs them all', async () => {
  const unread = await carryThrough(emptyLibrary(), 1, { upTo: 'added' });
  assert.match(addMapping(unread.library, unread.id, mappingFor(1), WHO, AT).why, /^Confirm the reading against the original first/);
  const { library, id } = await carryThrough(emptyLibrary(), 1, { upTo: 'mapped' });
  assert.equal(bundlesOf(library.revisions[0]).length, 6);
  assert.ok(bundlesOf(library.revisions[0]).every(({ topic, bundle }) => !reviewHolds(library.revisions[0], topic, bundle)));
  assert.match(markMappingsReviewed(library, id, WHO, AT).why, /^6 mapped answers have not been reviewed: Starting an adult drill; /);
  let step = ok(reviewBundle(library, id, 'start-adult', WHO, AT));
  assert.equal(step.receipt.type, 'Protocol answer reviewed');
  assert.deepEqual(step.receipt.details.passages, ['rule p2.b3.r1', 'rule p2.b5', 'order p1.b9', 'qualification p1.b7', 'exception p3.b3', 'stop p3.b5', 'escalation p3.b7']);
  assert.match(step.receipt.details.note, /Not an authenticated clinical review/);
  assert.match(markMappingsReviewed(step.library, id, WHO, AT).why, /^5 mapped answers have not been reviewed/);
  assert.equal(reviewBundle(step.library, id, 'no-such-answer', WHO, AT).ok, false);
  for (const name of ['start-pediatric', 'start-no-order', 'not-start', 'stop', 'who']) step = ok(reviewBundle(step.library, id, name, WHO, AT));
  step = ok(markMappingsReviewed(step.library, id, WHO, AT));
  assert.equal(step.receipt.details.answers, 6);
  // New answers arriving before activation send the revision back a step.
  const more = mappingFor(1); more.topics = [{ ...more.topics[3], id: 'who-again', title: 'Who may run it, again' }]; more.topics[0].bundles[0].id = 'who-again';
  const back = ok(addMapping(step.library, id, more, WHO, AT));
  assert.equal(back.library.revisions[0].state, 'checked');
  assert.equal(back.receipt.type, 'Protocol answers mapped');
  assert.equal(activate(back.library, id, WHO, AT, '2026-11-11').ok, false);
  assert.equal(ok(activate(step.library, id, WHO, AT, '2026-11-11')).library.revisions[0].state, 'active');
});

test('resolving never treats an unknown fact as yes or as no', async () => {
  const { library } = await carryThrough(emptyLibrary(), 1), revision = library.revisions[0], start = revision.topics.find(topic => topic.id === 'start');
  const kinds = facts => { const found = resolve(revision, start, facts); return [found.kind, found.bundles?.map(bundle => bundle.id) || found.bundle.id, found.unknown || null]; };
  assert.deepEqual(kinds({ age: 'adult', order: 'yes' }), ['answer', 'start-adult', null]);
  assert.deepEqual(kinds({ age: 'pediatric', order: 'no' }), ['answer', 'start-no-order', null]);
  assert.deepEqual(kinds({ age: UNKNOWN, order: 'yes' }), ['unresolved', ['start-adult', 'start-pediatric'], ['age']]);
  assert.deepEqual(kinds({ age: 'adult', order: UNKNOWN }), ['unresolved', ['start-adult', 'start-no-order'], ['order']]);
  assert.deepEqual(kinds({ age: UNKNOWN, order: UNKNOWN }), ['unresolved', ['start-adult', 'start-pediatric', 'start-no-order'], ['age', 'order']]);
  assert.deepEqual(kinds({ age: UNKNOWN, order: 'no' }), ['answer', 'start-no-order', null], 'the age band does not matter when there is no order');
  assert.deepEqual(kinds({ age: 'adult' }), ['uncovered', [], null], 'a fact that was never given fits nothing; the caller asks for it first');
  assert.deepEqual(wholeRule(revision, start.bundles[0]).map(section => [section.role, section.passages.length]), [['rule', 2], ['order', 1], ['qualification', 1], ['exception', 1], ['stop', 1], ['escalation', 1]]);
  assert.deepEqual(validateBundle(revision, start, start.bundles[0]), []);
});

test('nothing is answered from a library with no protocols, and held topics can be listed without any history', async () => {
  assert.equal(protocolAnswer('What rate do I start the bellows drill at?', { today: '2026-11-11', protocols: emptyLibrary() }), null);
  assert.equal(protocolAnswer('', { today: '2026-11-11', protocols: (await carryThrough(emptyLibrary(), 1)).library }), null);
  const { library } = await carryThrough(emptyLibrary(), 1);
  assert.deepEqual(protocolTopics(library, '2026-11-11').map(entry => entry.topic.title), ['Starting the drill', 'When the drill must not be started', 'Stopping the drill and who to call', 'Who may run the drill']);
  assert.deepEqual(protocolTopics(library, '2026-05-01'), []);
});
