import test from 'node:test';
import assert from 'node:assert/strict';
import { ask } from '../src/ask.js';
import { describePlan, readPlan, repairPlan } from '../src/plan.js';
import { measure, runPlan, weekendOf } from '../src/measure.js';
import { isWeekendTurn } from '../src/fairness.js';

// The question this exists for: "Who has the most weekends on day shift, other than Avery?" — which used to be
// answered with who is on today, because the ranking, the shift filter and the exclusion were all dropped.
//
// The fixture is built so that every part of the question changes the answer. Different people lead on day and on
// night. Excluding the leader changes who wins. December changes who wins again. Weekend shifts and distinct
// weekends rank differently, and so does a fair share, because the weekday filler differs. A test that passes with
// the shift filter ignored, or the exclusion ignored, would be no test at all.
//
// November 2026: Sat 7 14 21 28, Sun 1 8 15 22 29, Fri 6 13 20 27. December: Sat 5 12 19 26, Sun 6 13 20 27.
const row = (date, shift, person, extra = {}) => ({ date, shift, person, ...extra });
const assignments = [];
const put = (dates, shift, person, extra) => { for (const date of dates) assignments.push(row(date, shift, person, extra)); };

put(['2026-11-08', '2026-11-14', '2026-11-15', '2026-11-21', '2026-11-22', '2026-11-28'], 'D', 'Avery');   // 6 weekend day shifts
put(['2026-11-07', '2026-11-08', '2026-11-14', '2026-11-21', '2026-12-05'], 'D', 'Blair');                  // 5
put(['2026-11-07', '2026-11-08', '2026-11-14', '2026-11-21', '2026-12-05'], 'D', 'Jamie');                  // 5, tied with Blair
put(['2026-11-07', '2026-11-15', '2026-12-12', '2026-12-13'], 'D', 'Casey');                                // 4
put(['2026-12-19', '2026-12-20'], 'D', 'Emery');                                                            // 2
put(['2026-11-10', '2026-11-11', '2026-11-17', '2026-11-18', '2026-11-24'], 'D', 'Indigo');                 // 0
// Weekday filler. Blair works many more shifts than Avery, so Blair's fair share of weekends is larger and the
// fair-share ranking is not the raw-count ranking.
put(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30',
  '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-07', '2026-12-08'], 'D', 'Blair');
put(['2026-11-02', '2026-11-06'], 'D', 'Casey');
put(['2026-12-09', '2026-12-10', '2026-12-11'], 'D', 'Emery');

put(['2026-11-06', '2026-11-07', '2026-11-13', '2026-11-14', '2026-11-20', '2026-11-21'], 'N', 'Morgan');   // 6 weekend night shifts
put(['2026-11-08', '2026-11-15', '2026-11-22'], 'N', 'Jordan');                                             // 3
put(['2026-12-04', '2026-12-05', '2026-12-06'], 'N', 'Parker');                                             // 3
put(['2026-11-03', '2026-11-04', '2026-11-10'], 'N', 'Jordan');
put(['2026-11-17', '2026-11-18'], 'N', 'Parker', { role: 'charge' });

const names = [...new Set(assignments.map(entry => entry.person))];
const world = { today: '2026-11-12', now: '2026-11-12T15:00:00-05:00', actor: 'Riley', assignments, posts: [], documents: [],
  directory: {}, people: [], links: {}, releases: [], requests: [], rules: {}, answers: [], learned: [], corrections: [],
  versions: {}, keeper: true };

// The expected figures, counted here rather than copied out of the answer, so a wrong count in the engine and a
// wrong count in the test cannot agree with each other.
function expected({ shift = null, from = null, to = null, distinct = false, role = null } = {}) {
  const tally = new Map();
  for (const entry of assignments) {
    if (shift && entry.shift !== shift) continue;
    if (role && entry.role !== role) continue;
    if (from && (entry.date < from || entry.date > to)) continue;
    if (!tally.has(entry.person)) tally.set(entry.person, new Set());
    if (!isWeekendTurn(entry)) continue;
    tally.get(entry.person).add(distinct ? weekendOf(entry) : entry.date + entry.shift);
  }
  return [...tally].map(([person, set]) => ({ person, value: set.size })).sort((a, b) => b.value - a.value || a.person.localeCompare(b.person));
}

const talk = (questions, start = world) => {
  const turns = [];
  let last = null;
  for (const question of questions) { const found = ask(question, { ...start, last }); turns.push(found); last = found.context; }
  return turns;
};
const people = found => found.items.map(item => item.text).join(' | ');

test('the fixture really distinguishes the answers it is used to test', () => {
  assert.deepEqual(expected({ shift: 'D' }).slice(0, 4), [{ person: 'Avery', value: 6 }, { person: 'Blair', value: 5 }, { person: 'Jamie', value: 5 }, { person: 'Casey', value: 4 }]);
  assert.deepEqual(expected({ shift: 'N' })[0], { person: 'Morgan', value: 6 });
  assert.notDeepEqual(expected({ shift: 'D' }), expected({ shift: 'N' }));
  assert.notDeepEqual(expected({ shift: 'D' }), expected({ shift: 'D', from: '2026-12-01', to: '2026-12-31' }));
  // Weekend shifts and distinct weekends differ where it matters: Blair is a shift behind Avery and level with
  // Avery on weekends, because two of Avery's are a Saturday and the Sunday after it.
  const shifts = expected({ shift: 'D' }), weekends = expected({ shift: 'D', distinct: true });
  const of = (table, person) => table.find(entry => entry.person === person).value;
  assert.ok(of(shifts, 'Avery') > of(shifts, 'Blair'));
  assert.equal(of(weekends, 'Avery'), of(weekends, 'Blair'));
});

test('the plan carries every part of the question, and nothing is dropped', () => {
  const plan = readPlan({ text: 'who has the most weekends on day shift, other than avery', names, people: ['Avery'], when: null, actor: 'Riley' });
  assert.equal(plan.op, 'rank');
  assert.equal(plan.metric, 'weekend-shifts');
  assert.equal(plan.direction, 'highest');
  assert.equal(plan.shift, 'D');
  assert.deepEqual(plan.exclude, ['Avery']);
  assert.equal(plan.limit, null);
  assert.equal(plan.when, null);
  assert.deepEqual(plan.unsupported, []);
  assert.deepEqual(plan.unresolved, []);
  assert.equal(describePlan(plan), 'Highest weekend shifts on day shift, excluding Avery');
});

test('the question that started this is answered, with the ranking, the shift and the exclusion all applied', () => {
  const found = ask('Who has the most weekends on day shift, other than Avery?', world);
  const best = expected({ shift: 'D' }).filter(entry => entry.person !== 'Avery');
  const leaders = best.filter(entry => entry.value === best[0].value).map(entry => entry.person);
  assert.equal(found.kind, 'rank');
  assert.equal(found.understood, 'Highest weekend shifts on day shift, excluding Avery');
  for (const name of leaders) assert.match(found.title, new RegExp(name));
  assert.match(found.title, new RegExp(best[0].value + ' weekend shifts'));
  assert.doesNotMatch(found.title, /Avery/);                             // the exclusion holds in the answer too
  assert.doesNotMatch(people(found), /Avery/);
  assert.doesNotMatch(people(found), /Morgan/);                          // nights are not counted on a day question
  assert.match(found.lines.join(' '), /Avery left out/);
  assert.match(found.source, /^Weekend shifts, /);
  assert.match(found.source, /Counted from the schedule as imported/);
});

test('the shift filter changes who wins', () => {
  const day = ask('Who has the most weekends on day shift?', world);
  const night = ask('Who has the most weekends on night shift?', world);
  assert.match(day.title, new RegExp(expected({ shift: 'D' })[0].person));
  assert.match(night.title, new RegExp(expected({ shift: 'N' })[0].person));
  assert.notEqual(day.title, night.title);
  assert.doesNotMatch(night.title, new RegExp(expected({ shift: 'D' })[0].person));
});

test('fewest is not most, and an exclusion in front of the question still counts', () => {
  const found = ask('Excluding Avery, which day staff have the fewest weekend shifts?', world);
  assert.equal(found.understood, 'Lowest weekend shifts on day shift, excluding Avery');
  const worst = expected({ shift: 'D' }).filter(entry => entry.person !== 'Avery').at(-1);
  assert.match(found.title, new RegExp('^' + worst.person + ' has the fewest'));
  assert.match(found.title, new RegExp(worst.value + ' weekend shift'));
});

test('two named people are compared, and the one with more is named', () => {
  const found = ask('Who has more weekend day shifts, Blair or Casey?', world);
  assert.equal(found.kind, 'compare');
  assert.equal(found.understood, 'Blair and Casey compared by weekend shifts on day shift');
  const figures = expected({ shift: 'D' });
  const blair = figures.find(entry => entry.person === 'Blair').value, casey = figures.find(entry => entry.person === 'Casey').value;
  assert.notEqual(blair, casey, 'the fixture must not make this a tie');
  assert.match(found.title, new RegExp('^' + (blair > casey ? 'Blair' : 'Casey') + ' has more: ' + Math.max(blair, casey)));
  assert.match(people(found), /Blair/);
  assert.match(people(found), /Casey/);
  assert.doesNotMatch(people(found), /Avery|Jamie/);                     // only the two the question named
});

test('a tie at the top names everybody in it', () => {
  const found = ask('Who has the most weekends on day shift, other than Avery?', world);
  const best = expected({ shift: 'D' }).filter(entry => entry.person !== 'Avery');
  const tied = best.filter(entry => entry.value === best[0].value);
  assert.equal(tied.length, 2, 'the fixture must have a tie here');
  assert.match(found.title, /are tied for the most/);
  for (const entry of tied) assert.match(found.title, new RegExp(entry.person));
});

test('weekend shifts and distinct weekends are different questions with different answers', () => {
  const shifts = ask('Who has the most weekend shifts on day shift?', world);
  const weekends = ask('Who has the most distinct weekends on day shift?', world);
  assert.equal(shifts.understood, 'Highest weekend shifts on day shift');
  assert.equal(weekends.understood, 'Highest distinct weekends worked on day shift');
  assert.match(shifts.lines.join(' '), /Weekend shifts, not distinct weekends/);
  assert.match(weekends.lines.join(' '), /Distinct weekends, not weekend shifts/);
  const byShift = expected({ shift: 'D' }), byWeekend = expected({ shift: 'D', distinct: true });
  assert.equal(byShift[0].value, 6);
  assert.equal(byWeekend[0].value, 4);
  assert.match(shifts.title, /6 weekend shifts/);
  assert.match(weekends.title, /4 weekends/);
  // Blair is behind Avery on weekend shifts and level with Avery on distinct weekends.
  assert.equal(byWeekend.find(entry => entry.person === 'Blair').value, byWeekend.find(entry => entry.person === 'Avery').value);
  assert.match(weekends.title, /Avery/);
  assert.match(weekends.title, /Blair/);
});

test('a fair share is a different metric again, and says so', () => {
  const found = ask('Who is most above their fair share on day shift?', world);
  assert.equal(found.understood, 'Highest weekend turns above or below a fair share on day shift');
  assert.match(found.title, /above a fair share/);
  // Not the same as the raw count: Blair works far more shifts, so Blair's share is larger.
  const raw = ask('Who has the most weekend shifts on day shift?', world);
  assert.notEqual(found.items.map(item => item.text).join('|'), raw.items.map(item => item.text).join('|'));
  assert.match(found.items[0].sub, /a fair share here is/);
});

test('a fair share without a shift asks which one rather than mixing the pools', () => {
  const found = ask('Who is most above their fair share?', world);
  assert.match(found.title, /A fair share is worked out within one shift/);
  assert.deepEqual(found.next, ['Day shift', 'Night shift']);
  assert.equal(found.items.length, 0, 'no figures are given for a question it has not settled');
});

test('a follow-up edits the plan instead of starting again', () => {
  const [, nights] = talk(['Who has the most weekends on day shift, other than Avery?', 'Same thing for nights.']);
  assert.equal(nights.understood, 'Highest weekend shifts on night shift, excluding Avery');
  assert.match(nights.title, new RegExp(expected({ shift: 'N' })[0].person));

  const [, back] = talk(['Who has the most weekends on day shift, other than Avery?', 'No, include Avery this time.']);
  assert.equal(back.understood, 'Highest weekend shifts on day shift');
  assert.match(back.title, new RegExp('^' + expected({ shift: 'D' })[0].person + ' has the most'));

  const [, december] = talk(['Who has the most weekends on day shift, other than Avery?', 'Only in December.']);
  assert.equal(december.understood, 'Highest weekend shifts on day shift in December, excluding Avery');
  const inDecember = expected({ shift: 'D', from: '2026-12-01', to: '2026-12-31' }).filter(entry => entry.person !== 'Avery');
  const leaders = inDecember.filter(entry => entry.value === inDecember[0].value).map(entry => entry.person);
  for (const name of leaders) assert.match(december.title, new RegExp(name));
  assert.notEqual(december.title, talk(['Who has the most weekends on day shift, other than Avery?'])[0].title);

  const [, three] = talk(['Who has the most weekends on day shift, other than Avery?', 'Show the top three, except Avery and Jamie.']);
  assert.equal(three.understood, 'Highest weekend shifts on day shift, the highest 3, excluding Avery and Jamie');
  assert.equal(three.items.length, 3);
  assert.doesNotMatch(people(three), /Avery|Jamie/);
});

test('a follow-up does not swallow a new question', () => {
  const [, fresh] = talk(['Who has the most weekends on day shift, other than Avery?', 'Who is on tonight?']);
  assert.equal(fresh.kind, 'who');
  assert.equal(fresh.understood, 'who is on, tonight');
  const [, hours] = talk(['Who has the most weekends on day shift, other than Avery?', 'When do I work next?']);
  assert.equal(hours.kind, 'when');
});

test('a modifier it can read but not work out produces a clarification, not a plausible answer', () => {
  for (const [question, what] of [
    ['Who has the most weekends on day shift per month?', /a rate per month/],
    ['Who has the most weekend day shifts on average?', /an average/],
    ['Who has the most weekends on day shift last year?', /a period outside the schedule/],
    ['Who deserves the most weekends off?', /a judgement about what should happen/]
  ]) {
    const found = ask(question, world);
    assert.match(found.title, /I can read that question but I cannot work out/, question);
    assert.match(found.title, what, question);
    assert.equal(found.items.length, 0, question);
    assert.ok(found.understood.length > 3, question);
    assert.match(found.lines.join(' '), /What I can count/, question);
  }
});

test('a name it does not have is reported, not quietly ignored', () => {
  const found = ask('Who has the most weekends on day shift, other than Zephyrine?', world);
  assert.match(found.title, /I do not have anybody on the schedule called Zephyrine/);
  assert.equal(found.items.length, 0);
  assert.match(found.understood, /leaving out zephyrine/);
  assert.match(found.lines.join(' '), /The people on this schedule are/);
});

test('an empty group and a period with nothing in it are told apart', () => {
  const nobody = ask('Who has the most weekends on day shift, other than Avery, Blair, Jamie, Casey, Emery and Indigo?', world);
  assert.match(nobody.title, /leaves nobody to compare/);
  const nothing = ask('Who has the most weekends on day shift in March 2028?', world);
  assert.match(nothing.title, /Nothing on the schedule gives a figure/);
  assert.match(nothing.understood, /in March 2028/);
  assert.notEqual(nobody.title, nothing.title);
});

test('paraphrases, filler, poor grammar and misspellings reach the same answer', () => {
  const plain = ask('Who has the most weekends on day shift, other than Avery?', world);
  for (const question of [
    'whos got the most weekends on day shift other than avery',
    'other than avery who has the most weekends on days',
    'so um who has the most weekend day shifts apart from avery',
    'on day shift, excluding avery, who has the most weekends',
    'who worked the most weekends on dayshift besides avery',
    'most weekends on day shift not counting avery'
  ]) {
    const found = ask(question, world);
    assert.equal(found.kind, 'rank', question);
    assert.equal(found.understood, plain.understood, question);
    assert.equal(found.title, plain.title, question);
  }
});

test('other people’s figures stay with the record keeper, however well the question is read', () => {
  const found = ask('Who has the most weekends on day shift, other than Avery?', { ...world, keeper: false });
  assert.match(found.title, /kept by whoever keeps the record/);
  assert.equal(found.items.length, 0);
  // Reading it correctly is not permission to answer it, and the person can see it was understood.
  assert.equal(found.understood, 'Highest weekend shifts on day shift, excluding Avery');
  assert.match(found.lines.join(' '), /I understood the question/);
});

test('the questions the ordinary lookups already answer are left alone', () => {
  assert.equal(ask('How many weekends have I worked?', world).kind, 'fair');
  assert.equal(ask('Who is on tonight?', world).kind, 'who');
  assert.equal(ask('When do I work next?', world).kind, 'when');
  assert.equal(ask('which shifts are understaffed', world).kind, 'staffing');
  assert.equal(ask('are we short this weekend', world).kind, 'staffing');
  assert.equal(readPlan({ text: 'how many weekends have i worked', names, people: [], when: null, actor: 'Riley' }), null);
  assert.equal(readPlan({ text: 'who is on tonight', names, people: [], when: null, actor: 'Riley' }), null);
});

test('a role filter and a role metric are both carried', () => {
  const found = ask('Who has the most charge turns on night shift?', world);
  assert.equal(found.understood, 'Highest charge turns on night shift');
  const charge = assignments.filter(entry => entry.shift === 'N' && entry.role === 'charge');
  assert.ok(charge.length, 'the fixture has charge turns');
  assert.match(found.title, new RegExp('^' + charge[0].person + ' has the most charge turns'));
});

test('the executor is driven by the plan and nothing else', () => {
  // measure() never sees the question, so the only thing that can decide what is counted is the plan.
  const plan = { op: 'rank', metric: 'weekend-shifts', direction: 'highest', limit: null, shift: 'N', role: null,
    people: [], exclude: [], when: null, ties: true, unsupported: [], unresolved: [], asked: '' };
  assert.deepEqual(measure(plan, world).map(entry => ({ person: entry.person, value: entry.value })), expected({ shift: 'N' }));
  const ranked = runPlan({ ...plan, exclude: ['Morgan'] }, world);
  assert.equal(ranked.status, 'ok');
  assert.equal(ranked.winners.some(entry => entry.person === 'Morgan'), false);
  assert.equal(ranked.period.from, '2026-11-03');
  assert.equal(ranked.period.to, '2026-12-06');
});

test('repairPlan refuses anything that is not a continuation', () => {
  const plan = readPlan({ text: 'who has the most weekends on day shift', names, people: [], when: null, actor: 'Riley' });
  for (const text of ['who has the most weekends on night shift', 'when do i work next', 'what is the leave policy',
    'who is on friday and what time does it start and who else is with me on it'])
    assert.equal(repairPlan(plan, { text, said: text, names, when: null }), null, text);
  assert.ok(repairPlan(plan, { text: 'same thing for nights', said: 'same thing for nights', names, when: null }));
});
