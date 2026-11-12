import test from 'node:test';
import assert from 'node:assert/strict';
import { ask } from '../src/ask.js';
import { isThanks, readWorkPhrases } from '../src/words.js';
import { POLICY, projectRoster } from '../src/model.js';

// The clock starts fixed and the fixtures are built so a wrong answer cannot look right: the two Fridays have
// different people, the day and night teams of one Friday share nobody, and another person works days the actor
// never works. A reply naming the wrong date, person or shift fails on its content, not on its wording.
const today = '2026-11-11';                                   // a Wednesday
const row = (date, shift, person, extra = {}) => ({ date, shift, person, ...extra });
const assignments = [
  row('2026-11-12', 'D', 'Avery'), row('2026-11-12', 'D', 'Blair', { role: 'charge' }),
  row('2026-11-13', 'N', 'Morgan', { role: 'icu' }), row('2026-11-13', 'N', 'Parker', { role: 'charge' }),
  row('2026-11-13', 'D', 'Avery'), row('2026-11-13', 'D', 'Casey', { role: 'charge' }),
  row('2026-11-14', 'N', 'Jordan'), row('2026-11-14', 'N', 'Riley'),
  row('2026-11-18', 'D', 'Jordan', { hours: '7-3' }),
  row('2026-11-20', 'N', 'Jordan'), row('2026-11-20', 'N', 'Drew', { role: 'icu' }),
  row('2026-11-20', 'D', 'Emery'),
  row('2026-11-26', 'N', 'Morgan')
];
const documents = [{ id: 'leave', title: 'Time off requests', kind: 'Policy', effective: '2026-01-01',
  text: 'Purpose\n\nThis document describes how staff ask for time off.\n\nRequesting leave\n\nA request for leave is entered at least four weeks before the schedule is posted.' }];
const world = { today, now: today + 'T15:00:00-05:00', actor: 'Jordan', assignments, posts: [], documents, directory: {}, people: [], links: {},
  releases: [], requests: [], rules: {}, answers: [], learned: [], corrections: [], versions: {}, keeper: false };
const traded = { ...world, trade: { roster: projectRoster(assignments, []), directory: {}, policy: POLICY, committed: [], today, offers: [] } };

// Each turn is answered with the previous turn's context, exactly as the app threads it.
function talk(questions, start = world) {
  const turns = [];
  let last = null;
  for (const question of questions) { const found = ask(question, { ...start, last }); turns.push(found); last = found.context; }
  return turns;
}
const people = found => found.items.map(item => item.text).join(' | ');

test('a shift correction keeps the date and the question that was asked', () => {
  const [, fixed] = talk(['Who is on Friday night?', 'No, I meant day shift.']);
  assert.equal(fixed.kind, 'who');
  assert.equal(fixed.understood, 'who is on, Fri, Nov 13, days');
  assert.match(people(fixed), /Avery/);
  assert.match(people(fixed), /Casey/);
  assert.doesNotMatch(people(fixed), /Morgan|Parker/);              // the night team of the same Friday
  assert.doesNotMatch(people(fixed), /Nov 20/);                     // and not the other Friday
});

test('an ambiguous date correction asks which day and then keeps the rest of the question', () => {
  const [, asked, answered] = talk(['Who is on Friday night?', 'No, the other Friday.', 'Fri, Nov 20']);
  assert.match(asked.title, /^Which Friday do you mean, Fri, Nov 20 or Fri, Nov 27\?$/);
  assert.equal(asked.empty, false);
  assert.deepEqual(asked.items, []);                                 // offered as questions to ask, not as links out of Ask
  assert.deepEqual(asked.next, ['Fri, Nov 20', 'Fri, Nov 27']);
  assert.equal(answered.understood, 'who is on, Fri, Nov 20, nights');
  assert.match(people(answered), /Jordan/);
  assert.match(people(answered), /Drew/);
  assert.doesNotMatch(people(answered), /Morgan|Parker/);            // the Friday that was corrected away from
  assert.doesNotMatch(people(answered), /Emery/);                    // and not that Friday's day team
});

test('a date correction keeps the subject it was asked about', () => {
  const [, asked] = talk(['Do I work Friday?', 'No, the other Friday.']);
  assert.match(asked.title, /Which Friday/);
  const [, , answered] = talk(['Do I work Friday?', 'No, the other Friday.', 'Nov 20']);
  assert.equal(answered.understood, 'when you work, Fri, Nov 20');   // still the asker's own shifts
  assert.match(answered.title, /^You are on Fri, Nov 20:/);
});

test('a correction beginning with no is not read as a question about who is absent', () => {
  const [, fixed] = talk(['Who is on Friday night?', 'No, I meant day shift.']);
  assert.doesNotMatch(fixed.title, /clarify who you want listed/);
  assert.notEqual(fixed.kind, 'offlist');
});

test('a genuine negative question still asks who is not working', () => {
  const plain = ask('Who is not working Friday?', world);
  assert.equal(plain.kind, 'offlist');
  assert.equal(plain.understood, 'who has no shift listed, Fri, Nov 13');
  const afterwards = talk(['Who is on Friday night?', 'Who is not working Friday?'])[1];
  assert.equal(afterwards.kind, 'offlist');                          // a prior question does not turn it into a repair
});

test('a correction with no prior question does not invent one', () => {
  const alone = ask('No, I meant day shift.', world);
  assert.equal(alone.context.kind === 'who', false);
  assert.notEqual(alone.title, 'Please clarify who you want listed.');
});

test('a person correction and a plain follow-up both still work', () => {
  const [, swapped] = talk(['Is Morgan on Friday night?', 'Parker, not Morgan']);
  assert.equal(swapped.understood, 'when Parker works, Fri, Nov 13, nights');
  const [, next] = talk(['Who is on Friday night?', 'and Saturday?']);
  assert.equal(next.understood, 'who is on, Sat, Nov 14, nights');   // the night scope is retained
  assert.doesNotMatch(people(next), /Sat, Nov 14 day/);
});

test('the hours question refers to the shift already shown, and says where the times come from', () => {
  const [, recorded] = talk(['Do I work on the 18th?', 'What time should I be there?']);
  assert.equal(recorded.kind, 'time');
  assert.match(recorded.title, /Wed, Nov 18 day shift is listed as 7-3/);
  assert.match(recorded.source, /hours come from the schedule as imported/);
  const [, standard] = talk(['When do I work next?', 'What time should I be there?']);
  assert.match(standard.title, /Sat, Nov 14 night shift has no hours written on the schedule/);
  assert.match(standard.title, /19:00 to 07:00/);
  assert.match(standard.source, /not a time the department wrote down/);
  assert.equal(ask('What time should I be there?', world).kind === 'time', false);   // nothing in focus yet
});

test('ordinary ways of saying a work question reach the same lookups', () => {
  for (const question of ['Do I have to come in tomorrow?', 'i gotta come in tmrw or nah']) {
    const found = ask(question, world);
    assert.equal(found.kind, 'when', question);
    assert.equal(found.understood, 'when you work, tomorrow', question);
    assert.match(found.read, /work/, question);
  }
  const thin = ask('Are we thin this weekend?', world);
  assert.equal(thin.kind, 'staffing');
  assert.match(thin.read, /short/);
});

test('the same words in their other meanings are left alone', () => {
  const policy = [{ id: 'thin', title: 'Thin liquids', kind: 'Protocol', effective: '2026-01-01',
    text: 'Thin liquids\n\nThin liquids are withheld until the swallow study is read. This policy comes into effect on review.' }];
  const found = ask('What does the thin liquids protocol say?', { ...world, documents: policy });
  assert.equal(found.kind, 'look');
  assert.match(found.items[0].text, /Thin liquids are withheld/);
  assert.equal(readWorkPhrases('when does this policy come into effect').changes.length, 0);
  assert.equal(readWorkPhrases('thin liquids protocol').changes.length, 0);
});

test('a thank-you is answered as one instead of searching the documents', () => {
  for (const words of ['thanks', 'ok thanks', 'thank you so much', 'thx', 'appreciate it']) {
    const found = ask(words, world);
    assert.equal(found.kind, 'ack', words);
    assert.equal(found.empty, false, words);
    assert.doesNotMatch(found.source, /Searched the board/, words);
  }
  assert.equal(isThanks('no thanks, I need Friday off'), false);
  assert.notEqual(ask('thanks but when do I work next', world).kind, 'ack');
});

test('a misread question is not reported as an absent record', () => {
  const unknown = ask('zxqw blorp', world);
  assert.equal(unknown.kind, 'unknown');
  assert.match(unknown.title, /did not understand/);
  assert.match(unknown.source, /not a statement that the answer is not on record/);
  assert.ok(unknown.next.length, 'an unrecognised question offers something it can do');
  const absent = ask('Where is the linen cart?', world);
  assert.equal(absent.kind, 'look');                                  // a real question the records do not answer
  assert.match(absent.title, /Nothing on record answers that/);
});

test('shifts of another kind are offered as alternatives, not as matching results', () => {
  const found = ask('Do I work days?', { ...world, actor: 'Morgan' });    // Morgan is on the schedule for nights only
  assert.match(found.title, /^You have no day shifts from today on\.$/);
  assert.match(found.lines.join(' '), /These are not day shifts/);
});

test('a date the roster does not cover is told apart from a date the person does not work', () => {
  const outside = ask('Who is on December 20?', world);
  assert.match(outside.title, /No schedule entries are on record for Sun, Dec 20/);
  const recorded = ask('Do I work Friday?', world);
  assert.match(recorded.title, /You are not on the schedule Fri, Nov 13\./);   // the date is on file; the person is not
});

test('spelling, shorthand, filler and word order still arrive at the same answer', () => {
  const plain = ask('When do I work next?', world).title;
  for (const question of ['wen do i wrk nxt', 'next shift for me?', 'so um when is my next shift', 'my next shift when'])
    assert.equal(ask(question, world).title, plain, question);
});

test('context does not leak between conversations or across a change of viewer', () => {
  const fresh = ask('No, I meant day shift.', world);                 // no prior turn at all
  assert.notEqual(fresh.understood, 'who is on, Fri, Nov 13, days');
  const [, topic] = talk(['Who is on Friday night?', 'How do I request leave?']);
  assert.equal(topic.kind, 'look');                                   // an explicit new topic is not a repair
  assert.match(topic.items[0].text, /four weeks/);
  const [first] = talk(['Who is on Friday night?']);
  const otherViewer = ask('No, I meant day shift.', { ...world, actor: 'Avery', last: null });
  assert.notEqual(otherViewer.understood, first.understood);          // the app clears context when the viewer changes
});

test('the repaired answer still reports how it was understood', () => {
  const expected = [
    [['Who is on Friday night?', 'No, I meant day shift.'], 'who is on, Fri, Nov 13, days'],
    [['Do I work Friday?', 'No, the other Friday.'], 'a correction to the date, which could mean more than one day'],
    [['When do I work next?', 'What time should I be there?'], 'the hours of the Sat, Nov 14 night shift already shown'],
    [['thanks'], 'a thank-you, with no question in it'],
    [['zxqw blorp'], 'nothing I recognised']
  ];
  for (const [turns, line] of expected) assert.equal(talk(turns).at(-1).understood, line, turns.join(' / '));
});

// The refusal of a shift that has already started is proved against the trade rules in tests/trades.test.js; what is
// checked here is that the repair handling does not divert a trade question, before or after a correction.
test('trade questions are unchanged by the repair handling', () => {
  const alone = ask('Who can I trade my next shift with?', traded);
  assert.equal(alone.kind, 'trade');
  assert.equal(alone.understood, 'ways off one of your shifts, Sat, Nov 14, nights');
  const after = talk(['Who is on Friday night?', 'No, I meant day shift.', 'Who can I trade my next shift with?'], traded).at(-1);
  assert.equal(after.kind, 'trade');
  assert.equal(after.understood, alone.understood);
  assert.equal(after.title, alone.title);
});

test('a correction to a range offers whole weeks and keeps the range when one is chosen', () => {
  const [, asked, answered] = talk(['Who is on this weekend?', 'No, the other weekend.', 'Fri, Nov 20 to Sun, Nov 22']);
  assert.equal(asked.title, 'Which week do you mean, Fri, Nov 20 to Sun, Nov 22 or Fri, Nov 27 to Sun, Nov 29?');
  assert.deepEqual(asked.next, ['Fri, Nov 20 to Sun, Nov 22', 'Fri, Nov 27 to Sun, Nov 29']);
  assert.equal(answered.understood, 'who is on, Fri, Nov 20 to Sun, Nov 22');       // not collapsed to the first day
  assert.match(people(answered), /Emery/);                                          // Fri, Nov 20 day
  assert.doesNotMatch(people(answered), /Nov 13|Nov 14|Nov 15/);                    // not the weekend corrected away from
});

test('a date outside the roster is still reported as such after a correction', () => {
  const answered = talk(['Who is on Friday night?', 'No, the other Friday.', 'Fri, Nov 27']).at(-1);
  assert.equal(answered.understood, 'who is on, Fri, Nov 27, nights');
  assert.match(answered.title, /No schedule entries are on record for Fri, Nov 27/);
});
