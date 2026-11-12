// The protocol contract. Synthetic test material — NOT FOR CLINICAL USE.
//
// Each check asks a question through Ask's ordinary entry point and asserts what came back: the words of the
// answer, the passages it carries and where in which file each one sits. None of them checks a routing tag alone.
// scripts/protocol-faults.mjs breaks the implementation or the mapping one way at a time and requires the matching
// check here to fail; the first check is the positive control, so refusing every question cannot pass either.
//
// These questions were written by the developer alongside the code and tuned until they passed. They show that
// the stated behaviours hold for this invented protocol. They are not a measure of accuracy on questions nobody
// has seen, and passing them says nothing about any real protocol or any clinical use.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { ask } from '../src/ask.js';
import { emptyLibrary, withdraw, activate } from '../src/protocols.js';
import { addMapping, validateMapping } from '../src/bundles.js';
import { world as department } from './eval/world.mjs';
import { DIGESTS, carryThrough, mappingFor, loadFixture, ok } from './protocol-kit.mjs';

const ONE = DIGESTS['rt-train-014-rev1.pdf'], TWO = DIGESTS['rt-train-014-rev2.pdf'];
const TODAY = '2026-11-11';
const memo = new Map();
const once = (name, build) => { if (!memo.has(name)) memo.set(name, build()); return memo.get(name); };
// Revision 1, checked, mapped, reviewed and active.
const first = () => once('first', () => carryThrough(emptyLibrary(), 1));
// Revision 2 added beside it and taken to `upTo`. Its effective date can be moved to test dates.
const second = (upTo = 'active', effective = '2026-11-01') => once('second:' + upTo + ':' + effective, async () => carryThrough((await first()).library, 2, { upTo, overrides: { effective } }));

const say = (library, question, last = null, today = TODAY, extra = {}) => ask(question, { ...department, ...extra, today, protocols: library, last });
// A conversation: each reply is asked with the context the one before it left.
function talk(library, questions, today = TODAY) { let reply = null; const replies = []; for (const question of questions) { reply = say(library, question, reply?.context || null, today); replies.push(reply); } return replies; }
const section = (reply, role, from = reply.protocol) => from.sections.find(entry => entry.role === role)?.passages || [];
const everyWord = reply => JSON.stringify([reply.title, reply.lines, reply.items, reply.protocol]);
const ADULT = 'What rate do I start an adult Blue Trainer drill at, with a written order on file?';
const PEDIATRIC = 'What rate do I start a pediatric Blue Trainer drill at, with a written order on file?';
// Figures as a reader would pick them out, written independently of the guard in src/bundles.js.
const figures = text => [...String(text).toLowerCase().matchAll(/\d+(?:\.\d+)?(?: (?:mk\/min|mk\/sec|minutes|hours|marks|years))?/g)].map(match => match[0]);

export const CHECKS = [
  ['control: a direct adult question returns a complete, usable, cited answer', async () => {
    const { library, id } = await first(), reply = say(library, ADULT);
    assert.equal(reply.kind, 'protocol');
    assert.equal(reply.protocol.status, 'answer');
    assert.equal(reply.title, 'Start an adult drill at 12 mk/min.');
    assert.equal(reply.protocol.explanation, 'Recheck after 10 minutes. At each recheck raise the rate by 2 mk/min while the green lamp stays lit, and never go above 20 mk/min.');
    assert.deepEqual(reply.protocol.sections.map(entry => entry.role), ['rule', 'order', 'qualification', 'exception', 'stop', 'escalation'], 'the whole rule, in a fixed order');
    assert.equal(reply.items.length, 7, 'every linked passage is shown; none is cut for length');
    for (const item of reply.items) { assert.equal(item.go, 'protocol|' + id + '|' + item.anchor); assert.match(item.sub, /RT-TRAIN-014 rev 1 · page \d/); assert.ok(item.text.length > 20); }
    assert.deepEqual(reply.protocol.revision, { id, label: '1', digest: ONE, effective: '2026-06-01', state: 'active' });
    assert.ok(reply.protocol.sections.every(entry => entry.passages.every(passage => passage.digest === ONE)), 'each citation names the file it is in');
    assert.match(reply.source, /^RT-TRAIN-014 revision 1, effective 2026-06-01, file d09ae851f3b2, as held on this device\. Department Hub cannot tell whether whoever issued it has published a newer one\./);
    assert.match(reply.source, /Answer reviewed here by Avery Stone on 2026-11-10, under the profile selected on this device\. That is not an authenticated clinical sign-off\.$/);
    assert.ok(reply.lines.includes('For: Adult (18 years and over) · A written order is on file'));
    assert.ok(reply.lines.some(line => /plain-language summary written by a person and reviewed against the original/.test(line)), 'the summary is labelled as a person\'s words');
  }],
  ['contraindication: the do-not-start passage on page 3 travels with the rate on page 2', async () => {
    const { library } = await first(), reply = say(library, ADULT), [stop] = section(reply, 'exception');
    assert.ok(stop, 'the answer carries no do-not-start passage');
    assert.deepEqual([stop.anchor, stop.page, stop.context], ['p3.b3', 3, '7. When the drill must not be started']);
    assert.equal(stop.text, 'Do not start the drill if the amber seal lamp on the manikin is lit, or if the bellows was serviced within the last 24 hours. This applies to adult and pediatric drills.');
    assert.ok(section(reply, 'rule').every(passage => passage.page === 2), 'the rate itself is on page 2');
    assert.ok(reply.items.some(item => item.anchor === 'p3.b3' && /^Do not go ahead if · /.test(item.sub)), 'and it is in what the person is shown');
    const direct = say(library, 'What are the contraindications for the bellows drill?');
    assert.equal(direct.title, 'Do not start if the amber seal lamp is lit, or if the bellows was serviced within the last 24 hours.');
    assert.deepEqual(section(direct, 'exception').map(passage => passage.anchor), ['p3.b3']);
  }],
  ['unit: the summary and the cited rule state the same figures in the same units', async () => {
    const { library } = await first(), reply = say(library, ADULT), rules = section(reply, 'rule');
    assert.deepEqual(rules.map(passage => passage.anchor), ['p2.b3.r1', 'p2.b5']);
    assert.equal(rules[0].text, 'Age band: Adult (18 years and over) · Starting rate: 12 mk/min · Highest rate: 20 mk/min · Recheck after: 10 minutes');
    assert.equal(rules[0].context, '4. Rates by age band · table row 1', 'a table figure is read with its column names');
    assert.match(reply.title, /\b12 mk\/min\b/);
    const cited = new Set(figures(reply.protocol.sections.flatMap(entry => entry.passages.map(passage => passage.text)).join(' ')));
    for (const figure of figures(reply.title + ' ' + reply.protocol.explanation)) assert.ok(cited.has(figure), 'the summary says "' + figure + '" and no cited passage does');
    assert.deepEqual(figures(reply.title), ['12 mk/min']);
  }],
  ['guard: a summary whose figure or unit differs from the cited passages cannot be mapped at all', async () => {
    const file = await loadFixture('rt-train-014-rev1.pdf'), { library } = await carryThrough(emptyLibrary(), 1, { upTo: 'checked' }), revision = library.revisions[0];
    for (const [from, to, complaint] of [['12 mk/min', '12 mk/sec', /The summary says "12 mk\/sec"\. The linked passages say "12 mk\/min"\./], ['12 mk/min', '21 mk/min', /The summary says "21 mk\/min"\. The linked passages do not give that figure\./],
      ['10 minutes', '10 hours', /The summary says "10 hours"\. The linked passages say "10 mk\/min", "10 minutes"\.|The summary says "10 hours"\. The linked passages say "10 minutes"/]]) {
      const altered = JSON.parse(JSON.stringify(mappingFor(1)).replace(from === '10 minutes' ? 'Recheck after 10 minutes' : 'Start an adult drill at ' + from, from === '10 minutes' ? 'Recheck after ' + to : 'Start an adult drill at ' + to));
      const problems = validateMapping(revision, altered);
      assert.ok(problems.some(problem => complaint.test(problem)), from + ' → ' + to + ' was accepted: ' + JSON.stringify(problems));
      assert.equal(addMapping(library, revision.id, altered, 'Avery Stone', '2026-11-10T11:00:00.000Z').ok, false);
    }
    assert.deepEqual(validateMapping(revision, mappingFor(1)), [], 'the unaltered mapping is accepted');
    assert.equal(file.digest, ONE);
  }],
  ['age: a pediatric question returns the pediatric rule and none of the adult one, and the reverse', async () => {
    const { library } = await first(), child = say(library, PEDIATRIC), adult = say(library, ADULT);
    assert.equal(child.title, 'Start a pediatric drill at 6 mk/min, with the small cuff fitted.');
    assert.deepEqual(section(child, 'rule').map(passage => passage.anchor), ['p2.b3.r2', 'p2.b7']);
    assert.match(section(child, 'rule')[0].text, /^Age band: Pediatric \(under 18 years\) · Starting rate: 6 mk\/min · Highest rate: 10 mk\/min · Recheck after: 5 minutes$/);
    assert.ok(!/12 mk\/min|Adult \(18 years and over\) ·|adult manikin/.test(everyWord(child).replace('For: Pediatric', '')), 'an adult figure or passage appeared in a pediatric answer');
    assert.equal(child.protocol.facts.age, 'pediatric');
    assert.ok(!/6 mk\/min|Pediatric \(under 18 years\) ·|pediatric manikin/.test(everyWord(adult)), 'a pediatric figure or passage appeared in an adult answer');
    for (const wording of ['What rate do I start the bellows drill at for a child with an order on file?', 'starting rate for kids on the blue trainer, order on file']) assert.equal(say(library, wording).protocol.bundle, 'start-pediatric', wording);
  }],
  ['age: when the age band is not given Ask asks, offers "Not known", and assumes nothing', async () => {
    const { library } = await first(), [asked, unknown] = talk(library, ['What rate do I start the Blue Trainer drill at with an order on file?', 'Not known']);
    assert.deepEqual([asked.protocol.status, asked.protocol.asking, asked.title], ['asking', 'age', 'Is the manikin adult or pediatric?']);
    assert.deepEqual(asked.next, ['Adult (18 years and over)', 'Pediatric (under 18 years)', 'Not known']);
    assert.deepEqual([asked.items, asked.protocol.sections], [[], []], 'no rule is given before the age band is known');
    assert.ok(!/mk\/min/.test(everyWord(asked)));
    assert.equal(unknown.protocol.status, 'unresolved');
    assert.deepEqual(unknown.protocol.unresolved, ['age']);
    assert.equal(unknown.title, 'This depends on the age band, which is not known');
    assert.deepEqual(unknown.protocol.branches.map(branch => branch.bundle), ['start-adult', 'start-pediatric'], 'both possibilities, neither assumed');
    for (const branch of unknown.protocol.branches) assert.deepEqual(branch.sections.map(entry => entry.role), ['rule', 'order', 'qualification', 'exception', 'stop', 'escalation'], 'each possibility is whole');
    assert.ok(unknown.items.some(item => item.text === 'If Adult (18 years and over): Start an adult drill at 12 mk/min.') && unknown.items.some(item => item.text === 'If Pediatric (under 18 years): Start a pediatric drill at 6 mk/min, with the small cuff fitted.'));
    const [, picked] = talk(library, ['What rate do I start the Blue Trainer drill at with an order on file?', 'Pediatric (under 18 years)']);
    assert.equal(picked.protocol.bundle, 'start-pediatric');
  }],
  ['order: without a written order the answer is do not start, with no rate offered', async () => {
    const { library } = await first(), reply = say(library, 'What rate do I start an adult bellows drill at? There is no order, just a verbal request.');
    assert.equal(reply.title, 'Do not start. A written drill order is required first.');
    assert.equal(reply.protocol.bundle, 'start-no-order');
    assert.deepEqual(section(reply, 'order').map(passage => [passage.anchor, passage.text]), [['p1.b9', 'A written drill order from the Simulation Lead is required before the drill is started. A verbal request is not a drill order.']]);
    assert.ok(!/\d+ mk\/min/.test(everyWord(reply)), 'a rate was shown to someone with no order');
  }],
  ['order: the order requirement travels with the rate, and Ask asks when it is not known', async () => {
    const { library } = await first(), full = say(library, ADULT);
    assert.deepEqual(section(full, 'order').map(passage => passage.anchor), ['p1.b9'], 'the adult answer carries no order requirement');
    assert.ok(full.items.some(item => item.anchor === 'p1.b9' && /^Order required first · /.test(item.sub)));
    const [asked, unknown] = talk(library, ['What rate do I start an adult Blue Trainer drill at?', 'not sure']);
    assert.deepEqual([asked.protocol.status, asked.protocol.asking, asked.title], ['asking', 'order', 'Is a written drill order on file?']);
    assert.deepEqual(asked.next, ['A written order is on file', 'No written order', 'Not known']);
    assert.ok(!/mk\/min/.test(everyWord(asked)), 'a rate was given before the order was established');
    assert.deepEqual([unknown.protocol.status, unknown.protocol.unresolved], ['unresolved', ['order']]);
    assert.deepEqual(unknown.protocol.branches.map(branch => branch.bundle).sort(), ['start-adult', 'start-no-order']);
    assert.ok(unknown.items.some(item => item.text === 'If No written order: Do not start. A written drill order is required first.'), 'the no-order possibility is not dropped when the order is unknown');
  }],
  ['qualification: who may run the drill travels with the rate and answers on its own', async () => {
    const { library } = await first();
    assert.deepEqual(section(say(library, ADULT), 'qualification').map(passage => passage.anchor), ['p1.b7']);
    const reply = say(library, 'Can a student run the bellows drill?');
    assert.equal(reply.title, 'Only a therapist who holds a current Blue Trainer card.');
    assert.equal(section(reply, 'qualification')[0].text, 'Only a therapist who holds a current Blue Trainer card may run the drill. A student may run the drill only while a card holder is present in the room.');
  }],
  ['stop and escalation: the stop condition and the named person to call are both returned', async () => {
    const { library } = await first(), reply = say(library, 'When do I stop the Blue Trainer drill, and who do I call?');
    assert.equal(reply.title, 'Stop at once if the red lamp lights or the gauge reads above 30 marks.');
    assert.deepEqual(section(reply, 'stop').map(passage => [passage.anchor, passage.text]), [['p3.b5', 'Stop the drill at once if the red lamp lights or the gauge reads above 30 marks.']]);
    assert.deepEqual(section(reply, 'escalation').map(passage => [passage.anchor, passage.text]), [['p3.b7', 'After stopping, call the Simulation Lead. If the Simulation Lead does not answer within 5 minutes, call the Education Supervisor.']]);
    const full = say(library, ADULT);
    assert.deepEqual([section(full, 'stop')[0]?.anchor, section(full, 'escalation')[0]?.anchor], ['p3.b5', 'p3.b7'], 'the starting answer carries them too');
  }],
  ['misspelling: near-miss words are read as the protocol\'s words, and the change is shown', async () => {
    const { library } = await first(), reply = say(library, 'what rate do i start a pediatrc bellos drill at with an order on file');
    assert.equal(reply.protocol.bundle, 'start-pediatric');
    assert.deepEqual(reply.changes, [['pediatrc', 'pediatric'], ['bellos', 'bellows']]);
    assert.equal(reply.read, 'what rate do i start a pediatric bellows drill at with an order on file');
    assert.equal(say(library, 'contraindcations for the bellows drill').protocol.bundle, 'not-start');
    assert.equal(say(library, 'when do i stop the drill and who do i call if it goes wrong').protocol.bundle, 'stop');
    assert.equal(say(library, 'starting rate for an adlut drill with an order on file').protocol.bundle, 'start-adult');
  }],
  ['follow-up: a changed fact keeps the topic and what was already said, and a new topic keeps the protocol', async () => {
    const { library } = await first(), [adult, child, noOrder, call, work] = talk(library, [ADULT, 'and for a child?', 'what if there is no order', 'who do I call?', 'When do I work next?']);
    assert.equal(adult.protocol.bundle, 'start-adult');
    assert.deepEqual([child.protocol.bundle, child.protocol.facts], ['start-pediatric', { age: 'pediatric', order: 'yes' }]);
    assert.equal(noOrder.protocol.bundle, 'start-no-order');
    assert.equal(call.protocol.bundle, 'stop');
    assert.notEqual(work.kind, 'protocol', 'a schedule question after a protocol answer goes to the schedule');
  }],
  ['out of scope: an uncovered question gets no rule, and other questions are left to the rest of Ask', async () => {
    const { library } = await first(), reply = say(library, 'What is the procedure for cleaning the bellows after the drill?');
    assert.deepEqual([reply.kind, reply.protocol.status, reply.protocol.sections], ['protocol', 'uncovered', []]);
    assert.equal(reply.title, 'No reviewed answer covers that. Which of these did you mean?');
    assert.ok(reply.items.length && reply.items.every(item => /^Page \d · /.test(item.text) && /not quoted here, open it to read$/.test(item.sub)), 'outside a reviewed answer a place is pointed to and the protocol is not quoted');
    assert.ok(!/manikin|mk\/min|lamp/.test(everyWord(reply)), 'protocol text was quoted outside a reviewed answer');
    assert.deepEqual(reply.next, ['Starting the drill', 'When the drill must not be started', 'Stopping the drill and who to call', 'Who may run the drill']);
    for (const question of ['When do I work next?', 'Who is on tonight?', 'What is the dose of albuterol?', 'Who has worked the most weekends?', 'thanks']) {
      const other = say(library, question);
      assert.notEqual(other.kind, 'protocol', question);
      assert.deepEqual({ ...other, context: null }, { ...ask(question, { ...department, today: TODAY, last: null }), context: null }, question + ' answers exactly as it does with no protocol held');
    }
  }],
  ['replacement: once revision 2 is active the answer comes from revision 2 only', async () => {
    const { library, id } = await second(), reply = say(library, ADULT);
    assert.equal(reply.title, 'Start an adult drill at 14 mk/min.');
    assert.deepEqual(reply.protocol.revision, { id, label: '2', digest: TWO, effective: '2026-11-01', state: 'active' });
    assert.ok(reply.items.length === 7 && reply.items.every(item => item.go.startsWith('protocol|' + id + '|')), 'a citation points at the superseded file');
    assert.ok(reply.protocol.sections.every(entry => entry.passages.every(passage => passage.digest === TWO)));
    assert.ok(!/12 mk\/min|20 mk\/min|24 hours|Simulation Lead/.test(everyWord(reply)), 'a revision 1 value appeared in a revision 2 answer');
    assert.match(section(reply, 'exception')[0].text, /serviced within the last 48 hours/);
    assert.match(section(reply, 'escalation')[0].text, /^After stopping, call the Charge Educator\./);
    assert.match(reply.source, /^RT-TRAIN-014 revision 2, effective 2026-11-01, file 7cce7d9d091e,/);
    const child = say(library, PEDIATRIC);
    assert.deepEqual(section(child, 'exception').map(passage => passage.text)[0], 'Do not run a pediatric drill with the large cuff fitted.', 'the exception added in revision 2 is carried');
    assert.match(child.protocol.explanation, /^Recheck after 4 minutes\./);
  }],
  ['replacement: until revision 2 is reviewed there is no answer, and revision 1 is not used', async () => {
    for (const upTo of ['added', 'checked', 'mapped', 'reviewed']) {
      const { library, id } = await second(upTo), reply = say(library, ADULT);
      assert.deepEqual([reply.kind, reply.protocol.status, reply.protocol.revision.id, reply.protocol.sections], ['protocol', 'pending', id, []], upTo);
      assert.equal(reply.title, 'No reviewed answer yet for the revision now in effect');
      assert.match(reply.lines[0], /^Revision 2 of RT-TRAIN-014 has been in effect since 2026-11-01, and its review here is not finished .*Earlier revisions are history and are not used to answer\.$/);
      assert.ok(!/mk\/min|manikin/.test(everyWord(reply)), upTo + ': protocol text was quoted with no reviewed answer behind it');
      assert.ok(reply.items.every(item => item.go.startsWith('protocol|' + id + '|')), upTo + ': the superseded revision supplied part of the reply');
      assert.equal(reply.items[0].go, 'protocol|' + id + '|', 'the original of the revision in effect is one tap away');
      assert.match(reply.items[0].sub, upTo === 'added' ? /^Added · reading not checked · file 7cce7d9d091e · open the original$/ : /· file 7cce7d9d091e · open the original$/);
    }
  }],
  ['replacement: an answer mapped to revision 1 cannot be attached to revision 2', async () => {
    const { library, id } = await second('checked'), result = addMapping(library, id, mappingFor(1), 'Avery Stone', '2026-11-10T12:00:00.000Z');
    assert.equal(result.ok, false);
    assert.match(result.why, /This mapping was written for file d09ae851f3b2\. This revision is file 7cce7d9d091e\. Mapped answers do not carry from one revision to another/);
    const relabelled = { ...mappingFor(1), revision: TWO }, problems = validateMapping(library.revisions.find(revision => revision.id === id), relabelled);
    assert.ok(problems.length >= 10 && problems.every(problem => /which is not this revision|does not read the way it did|not a passage/.test(problem) || /The summary says/.test(problem)), 'relabelling the file does not move its links: ' + problems[0]);
  }],
  ['future date: a revision made active ahead of time does not answer before its date', async () => {
    const { library, id } = await second('active', '2026-12-01');
    const before = say(library, ADULT, null, '2026-11-30'), after = say(library, ADULT, null, '2026-12-01');
    assert.equal(before.title, 'Start an adult drill at 12 mk/min.');
    assert.equal(before.protocol.revision.digest, ONE);
    assert.ok(before.lines.includes('Revision 2 takes effect on 2026-12-01. Until then this is from revision 1.'));
    assert.deepEqual(before.protocol.upcoming, { label: '2', effective: '2026-12-01' });
    assert.equal(after.title, 'Start an adult drill at 14 mk/min.');
    assert.equal(after.protocol.revision.id, id);
  }],
  ['absence: withdrawn, not yet in effect, and two revisions on one date each give no rule and say why', async () => {
    const { library, id } = await first();
    const gone = say(ok(withdraw(library, id, 'Retired', 'Avery Stone', '2026-11-10T12:00:00.000Z')).library, ADULT);
    assert.deepEqual([gone.protocol.status, gone.title, gone.lines, gone.protocol.sections], ['none', 'No revision is held', ['Every revision held of RT-TRAIN-014 has been withdrawn.'], []]);
    const early = say(library, ADULT, null, '2026-05-31');
    assert.deepEqual([early.protocol.status, early.lines], ['not-yet', ['No revision of RT-TRAIN-014 is in effect yet. Revision 1 takes effect on 2026-06-01.']]);
    const clash = say((await second('added', '2026-06-01')).library, ADULT);
    assert.deepEqual([clash.protocol.status, clash.title, clash.protocol.conflict.sort()], ['conflict', 'Two revisions claim the same date', [TWO, ONE].sort()]);
    assert.match(clash.lines[0], /Department Hub does not choose between them/);
    assert.equal(clash.items.filter(item => /open the original$/.test(item.sub)).length, 2, 'both sources are shown');
    for (const reply of [gone, early, clash]) assert.ok(!/\d+ mk\/min/.test(everyWord(reply)), reply.protocol.status + ' still produced a rate');
  }],
  ['review: an answer stops answering the moment it no longer matches what was reviewed', async () => {
    const { library } = await first();
    // The stored mapping is edited after review, as a damaged or hand-edited workspace might be.
    const edited = structuredClone(library), target = edited.revisions[0].topics.find(topic => topic.id === 'start').bundles.find(bundle => bundle.id === 'start-adult');
    target.links = target.links.filter(link => link.role !== 'exception'); target.requires = target.requires.filter(role => role !== 'exception');
    const reply = say(edited, ADULT);
    assert.deepEqual([reply.protocol.status, reply.title, reply.protocol.sections], ['unreviewed', 'An answer is mapped for this and has not been reviewed', []]);
    assert.ok(!/mk\/min/.test(everyWord(reply)));
    // The reading is edited instead: the link no longer points at the words it was written against.
    const reread = structuredClone(library);
    reread.revisions[0].extraction.pages[1].blocks.find(block => block.anchor === 'p2.b3').rows[0].hash = 'changed';
    assert.equal(say(reread, ADULT).protocol.status, 'unreviewed');
    // A new answer added to an active revision does not answer until someone reviews it.
    const extra = mappingFor(1); extra.topics = [{ ...extra.topics.find(topic => topic.id === 'who'), id: 'who-2', title: 'Running the drill unsupervised', said: ['unsupervised'] }]; extra.topics[0].bundles[0].id = 'who-2';
    const added = ok(addMapping(library, library.revisions[0].id, extra, 'Avery Stone', '2026-11-10T12:00:00.000Z')).library;
    assert.equal(say(added, 'Can the bellows drill be run unsupervised?').protocol.status, 'unreviewed');
    const claimed = mappingFor(1); for (const topic of claimed.topics) for (const bundle of topic.bundles) bundle.review = { by: 'The file itself', at: '2026-01-01T00:00:00.000Z', seal: 'anything' };
    const { library: fresh } = await carryThrough(emptyLibrary(), 1, { upTo: 'checked' });
    const taken = ok(addMapping(fresh, fresh.revisions[0].id, claimed, 'Avery Stone', '2026-11-10T12:00:00.000Z')).library;
    assert.ok(taken.revisions[0].topics.every(topic => topic.bundles.every(bundle => !bundle.review)), 'a file cannot arrive already reviewed');
  }],
  ['learning: "Yes", repeated use and taught wording change nothing about a protocol answer', async () => {
    const { library } = await first(), before = JSON.stringify(library), plain = say(library, ADULT);
    for (let turn = 0; turn < 25; turn++) say(library, ADULT);
    // Feedback and taught answers of the kind the document search learns from, aimed at promoting the wrong passage.
    const swayed = say(library, ADULT, null, TODAY, { learned: [{ words: ['adult', 'drill', 'start', 'rate'], documentId: 'thin', offset: 0, sourceHash: 'x', count: 99 }],
      answers: [{ id: 't1', question: ADULT, answer: 'Start at 99 mk/min.', by: 'Someone', at: '2026-11-01T00:00:00.000Z' }], corrections: [{ id: 'c1', question: ADULT, kind: 'answer', answer: 'Start at 99 mk/min.', by: 'Someone', at: '2026-11-01T00:00:00.000Z' }] });
    assert.deepEqual(swayed.protocol, plain.protocol);
    assert.deepEqual(swayed.items, plain.items);
    assert.equal(JSON.stringify(library), before, 'answering wrote something into the library');
  }],
  ['privacy: a conversation carries general conditions only, and nothing typed is kept', async () => {
    const { library } = await first(), [asked, reply] = talk(library, ['What rate do I start an adult Blue Trainer drill at?', 'A written order is on file']);
    assert.deepEqual(Object.keys(asked.context.protocol).sort(), ['facts', 'family', 'pending', 'revision', 'topic']);
    assert.deepEqual(reply.context, { kind: 'protocol', protocol: { family: 'pf-rt-train-014', revision: ONE, topic: 'start', facts: { age: 'adult', order: 'yes' } } });
    assert.ok(!JSON.stringify(reply.context).includes('What rate'), 'the question text was carried forward');
    assert.ok(!JSON.stringify(library).includes('What rate'));
  }]
];

export async function runContract() {
  const results = [];
  for (const [name, check] of CHECKS) {
    try { await check(); results.push({ name, ok: true }); }
    catch (error) { results.push({ name, ok: false, why: String(error?.message || error).split('\n')[0].slice(0, 300) }); }
  }
  return results;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = await runContract(), failed = results.filter(result => !result.ok);
  if (process.argv.includes('--json')) console.log(JSON.stringify(results));
  else { for (const result of results) console.log((result.ok ? 'PASS  ' : 'FAIL  ') + result.name + (result.ok ? '' : '\n        ' + result.why)); console.log(failed.length ? failed.length + ' of ' + results.length + ' contract checks failed.' : 'All ' + results.length + ' contract checks pass.'); }
  process.exit(failed.length ? 1 : 0);
}
